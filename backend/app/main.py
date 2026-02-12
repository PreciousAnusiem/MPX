import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, cast

import redis.asyncio as redis
from fastapi import (
    FastAPI, HTTPException, Depends, Request, Response, 
    BackgroundTasks, status, WebSocket, WebSocketDisconnect
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
import uvicorn
from sqlalchemy.orm import Session

# Internal imports
from app.config import settings, get_settings
from app.database import get_db, init_db, SessionLocal
from app.models import User, SubscriptionTier, UserActivity, SystemHealth, GeneratedContent
from app.auth import verify_token, get_current_user, create_access_token
from app.schemas import (
    UserResponse, ErrorResponse, HealthResponse, 
    SystemStatsResponse, OfflineDataResponse
)

# API Routes
from app.api import auth, subscription, content, social, analytics, offline
from app.services.ai_service import AIService
from app.services.social_service import SocialService
from app.services.payment_service import PaymentService
from app.services.firebase_service import FirebaseService
from app.services.cache_service import CacheService
from app.services.notification_service import NotificationService
from app.utils import (
    setup_logging, validate_request, sanitize_input,
    monitor_performance, handle_exceptions
)

# Initialize logging
logger = setup_logging(__name__)

# Rate limiting
limiter = Limiter(key_func=get_remote_address)

# Security
security = HTTPBearer()

# Global connection managers
class ConnectionManager:
    """WebSocket connection manager for real-time features"""
    
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.user_sessions: Dict[str, Dict[str, Any]] = {}
    
    async def connect(self, websocket: WebSocket, user_id: str, session_id: str):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        
        # Store session info
        self.user_sessions[session_id] = {
            "user_id": user_id,
            "connected_at": datetime.utcnow(),
            "last_activity": datetime.utcnow(),
            "websocket": websocket
        }
        
        logger.info(f"WebSocket connected: user_id={user_id}, session_id={session_id}")
    
    def disconnect(self, websocket: WebSocket, user_id: str, session_id: str):
        if user_id in self.active_connections:
            self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        
        if session_id in self.user_sessions:
            del self.user_sessions[session_id]
        
        logger.info(f"WebSocket disconnected: user_id={user_id}, session_id={session_id}")
    
    async def send_personal_message(self, message: Dict[str, Any], user_id: str):
        if user_id in self.active_connections:
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Failed to send message to {user_id}: {e}")
    
    async def broadcast_to_tier(self, message: Dict[str, Any], tier: str):
        """Broadcast messages to all users of specific subscription tier"""
        # Implementation would query users by tier and send messages
        pass

# Initialize connection manager
connection_manager = ConnectionManager()

# Application lifecycle
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown events"""
    
    # Startup
    logger.info("🚀 ONXLink API starting up...")
    
    try:
        # Initialize database
        await init_db()
        logger.info("✅ Database initialized")
        
        # Initialize Redis cache
        app.state.redis = redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=20
        )
        await app.state.redis.ping()
        logger.info("✅ Redis cache connected")
        
        # Initialize services
        app.state.ai_service = AIService()
        app.state.social_service = SocialService()
        app.state.payment_service = PaymentService()
        app.state.firebase_service = FirebaseService()
        app.state.cache_service = CacheService(app.state.redis)
        app.state.notification_service = NotificationService()
        logger.info("✅ Services initialized")
        
        # Background tasks
        asyncio.create_task(cleanup_expired_sessions())
        asyncio.create_task(monitor_system_health())
        asyncio.create_task(process_offline_sync_queue())
        logger.info("✅ Background tasks started")
        
        # System health check
        db = SessionLocal()
        try:
            health_record = SystemHealth(
                status="healthy",
                cpu_usage=0.0,
                memory_usage=0.0,
                active_connections=0,
                last_check=datetime.utcnow()
            )
            db.add(health_record)
            db.commit()
            logger.info("✅ System health initialized")
        finally:
            db.close()
            
        logger.info("🎉 ONXLink API startup completed successfully!")
        
    except Exception as e:
        logger.error(f"❌ Startup failed: {e}")
        raise
    
    yield
    
    # Shutdown
    logger.info("🛑 ONXLink API shutting down...")
    
    try:
        # Close Redis connection
        if hasattr(app.state, 'redis'):
            await app.state.redis.close()
            logger.info("✅ Redis connection closed")
        
        # Cleanup resources
        await cleanup_resources()
        logger.info("✅ Resources cleaned up")
        
        logger.info("👋 ONXLink API shutdown completed")
        
    except Exception as e:
        logger.error(f"❌ Shutdown error: {e}")

# Create FastAPI application
app = FastAPI(
    title="ONXLink API",
    description="AI Social Commerce Platform - Production Backend",
    version="1.0.0",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
    lifespan=lifespan
)

# Middleware setup
app.add_middleware(SlowAPIMiddleware)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.ALLOWED_HOSTS
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining"]
)

# Performance monitoring
if settings.ENVIRONMENT == "production":
    instrumentator = Instrumentator()
    instrumentator.instrument(app).expose(app)

# Static files (for offline resources)
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")

# Custom middleware
@app.middleware("http")
async def performance_middleware(request: Request, call_next):
    """Monitor request performance and add security headers"""
    start_time = time.time()
    
    # Security headers
    response = await call_next(request)
    
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    
    # Performance tracking
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    
    # Log slow requests
    if process_time > 1.0:
        logger.warning(f"Slow request: {request.method} {request.url} took {process_time:.2f}s")
    
    return response

@app.middleware("http")
async def request_validation_middleware(request: Request, call_next):
    """Validate and sanitize incoming requests"""
    try:
        # Validate request size
        if request.headers.get("content-length"):
            content_length = int(request.headers["content-length"])
            if content_length > settings.MAX_REQUEST_SIZE:
                return JSONResponse(
                    status_code=413,
                    content={"error": "Request too large"}
                )
        
        # Rate limiting check
        client_ip = get_remote_address(request)
        cache_key = f"rate_limit:{client_ip}"
        
        if hasattr(app.state, 'redis'):
            current_requests = await app.state.redis.get(cache_key)
            if current_requests and int(current_requests) > settings.RATE_LIMIT_PER_MINUTE:
                return JSONResponse(
                    status_code=429,
                    content={"error": "Rate limit exceeded"}
                )
        
        response = await call_next(request)
        return response
        
    except Exception as e:
        logger.error(f"Request validation error: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error"}
        )

# Health check endpoints
@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """Comprehensive health check endpoint"""
    try:
        # Database check
        db = SessionLocal()
        try:
            db.execute("SELECT 1")
            db_status = "healthy"
        except Exception as e:
            db_status = f"unhealthy: {str(e)}"
        finally:
            db.close()
        
        # Redis check
        redis_status = "healthy"
        if hasattr(app.state, 'redis'):
            try:
                await app.state.redis.ping()
            except Exception as e:
                redis_status = f"unhealthy: {str(e)}"
        
        # Services check
        services_status = {
            "ai_service": "healthy" if hasattr(app.state, 'ai_service') else "not_initialized",
            "social_service": "healthy" if hasattr(app.state, 'social_service') else "not_initialized",
            "payment_service": "healthy" if hasattr(app.state, 'payment_service') else "not_initialized"
        }
        
        overall_status = "healthy" if all([
            db_status == "healthy",
            redis_status == "healthy",
            all(status == "healthy" for status in services_status.values())
        ]) else "degraded"
        
        return HealthResponse(
            status=overall_status,
            timestamp=datetime.utcnow(),
            database=db_status,
            cache=redis_status,
            services=services_status,
            version="1.0.0"
        )
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return HealthResponse(
            status="unhealthy",
            timestamp=datetime.utcnow(),
            database="unknown",
            cache="unknown",
            services={},
            version="1.0.0"
        )

@app.get("/health/detailed", response_model=SystemStatsResponse, tags=["System"])
@limiter.limit("10/minute")
async def detailed_health_check(
    request: Request,
    current_user: User = Depends(get_current_user)
):
    """Detailed system statistics (admin only)"""
    if current_user.subscription_tier != SubscriptionTier.ENTERPRISE:
        raise HTTPException(
            status_code=403,
            detail="Enterprise subscription required"
        )
    
    try:
        import psutil
        
        # System metrics
        cpu_usage = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        
        # Database metrics
        db = SessionLocal()
        try:
            user_count = db.query(User).count()
            active_sessions = len(connection_manager.user_sessions)
        finally:
            db.close()
        
        return SystemStatsResponse(
            cpu_usage=cpu_usage,
            memory_usage={
                "total": memory.total,
                "available": memory.available,
                "percent": memory.percent,
                "used": memory.used
            },
            disk_usage={
                "total": disk.total,
                "used": disk.used,
                "free": disk.free,
                "percent": (disk.used / disk.total) * 100
            },
            database_stats={
                "total_users": user_count,
                "active_sessions": active_sessions
            },
            cache_stats=await get_cache_stats()
        )
        
    except Exception as e:
        logger.error(f"Detailed health check failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to get system stats")

# WebSocket endpoint for real-time features
@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str, session_id: str = None):
    """WebSocket endpoint for real-time communication"""
    if not session_id:
        session_id = f"{user_id}_{int(time.time())}"
    
    await connection_manager.connect(websocket, user_id, session_id)
    
    try:
        # Send welcome message
        await websocket.send_json({
            "type": "connection_established",
            "session_id": session_id,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        # Listen for messages
        while True:
            data = await websocket.receive_json()
            
            # Handle different message types
            message_type = data.get("type")
            
            if message_type == "ping":
                await websocket.send_json({"type": "pong", "timestamp": datetime.utcnow().isoformat()})
            
            elif message_type == "sync_offline_data":
                # Process offline data sync
                await handle_offline_sync(user_id, data.get("data", []))
                await websocket.send_json({"type": "sync_complete"})
            
            elif message_type == "content_generation_status":
                # Real-time content generation updates
                await handle_content_generation_update(user_id, data)
            
            # Update last activity
            if session_id in connection_manager.user_sessions:
                connection_manager.user_sessions[session_id]["last_activity"] = datetime.utcnow()
                
    except WebSocketDisconnect:
        connection_manager.disconnect(websocket, user_id, session_id)
    except Exception as e:
        logger.error(f"WebSocket error for user {user_id}: {e}")
        connection_manager.disconnect(websocket, user_id, session_id)

# Offline data endpoints
@app.post("/api/v1/offline/sync", response_model=OfflineDataResponse, tags=["Offline"])
@limiter.limit("30/minute")
async def sync_offline_data(
    request: Request,
    offline_data: Dict[str, Any],
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user)
):
    """Sync offline generated content and activities"""
    try:
        # Validate offline data structure
        if not isinstance(offline_data, dict) or "items" not in offline_data:
            raise HTTPException(status_code=400, detail="Invalid offline data format")
        
        # Process sync in background
        background_tasks.add_task(
            process_offline_data_sync,
            current_user.id,
            offline_data["items"]
        )
        
        # Return immediate response
        return OfflineDataResponse(
            sync_id=f"sync_{current_user.id}_{int(time.time())}",
            status="processing",
            items_received=len(offline_data["items"]),
            timestamp=datetime.utcnow()
        )
        
    except Exception as e:
        logger.error(f"Offline sync error for user {current_user.id}: {e}")
        raise HTTPException(status_code=500, detail="Sync failed")

@app.get("/api/v1/offline/cache/{cache_type}", tags=["Offline"])
@limiter.limit("100/minute")
async def get_offline_cache(
    request: Request,
    cache_type: str,
    current_user: User = Depends(get_current_user)
):
    """Get cached data for offline usage"""
    try:
        cache_key = f"offline_cache:{current_user.id}:{cache_type}"
        
        if hasattr(app.state, 'cache_service'):
            cached_data = await app.state.cache_service.get(cache_key)
            if cached_data:
                return {"data": cached_data, "cached_at": datetime.utcnow()}
        
        # Generate fresh cache data based on type
        if cache_type == "templates":
            data = await generate_content_templates_cache(current_user)
        elif cache_type == "platforms":
            data = await generate_platforms_cache(current_user)
        elif cache_type == "analytics":
            data = await generate_analytics_cache(current_user)
        else:
            raise HTTPException(status_code=400, detail="Invalid cache type")
        
        # Cache for future requests
        if hasattr(app.state, 'cache_service'):
            await app.state.cache_service.set(cache_key, data, expire=3600)  # 1 hour
        
        return {"data": data, "generated_at": datetime.utcnow()}
        
    except Exception as e:
        logger.error(f"Offline cache error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get cache data")

# API Routes
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(subscription.router, prefix="/api/v1/subscription", tags=["Subscription"])
app.include_router(content.router, prefix="/api/v1/content", tags=["Content"])
app.include_router(social.router, prefix="/api/v1/social", tags=["Social"])
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["Analytics"])
app.include_router(offline.router, prefix="/api/v1/offline", tags=["Offline"])

# Root endpoint
@app.get("/", tags=["Root"])
async def root():
    """API root endpoint"""
    return {
        "message": "ONXLink AI Social Commerce Platform API",
        "version": "1.0.0",
        "status": "operational",
        "timestamp": datetime.utcnow(),
        "docs": "/docs" if settings.DEBUG else "Documentation disabled in production"
    }

# Error handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Custom HTTP exception handler"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail,
            "status_code": exc.status_code,
            "timestamp": datetime.utcnow().isoformat(),
            "path": str(request.url)
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """General exception handler"""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "status_code": 500,
            "timestamp": datetime.utcnow().isoformat(),
            "path": str(request.url)
        }
    )

# Background tasks
async def cleanup_expired_sessions():
    """Clean up expired WebSocket sessions"""
    while True:
        try:
            await asyncio.sleep(300)  # Run every 5 minutes
            
            current_time = datetime.utcnow()
            expired_sessions = []
            
            for session_id, session_data in connection_manager.user_sessions.items():
                last_activity = session_data["last_activity"]
                if (current_time - last_activity).total_seconds() > 1800:  # 30 minutes
                    expired_sessions.append(session_id)
            
            for session_id in expired_sessions:
                session_data = connection_manager.user_sessions[session_id]
                connection_manager.disconnect(
                    session_data["websocket"],
                    session_data["user_id"],
                    session_id
                )
            
            if expired_sessions:
                logger.info(f"Cleaned up {len(expired_sessions)} expired sessions")
                
        except Exception as e:
            logger.error(f"Session cleanup error: {e}")

async def monitor_system_health():
    """Monitor system health and send alerts"""
    while True:
        try:
            await asyncio.sleep(60)  # Check every minute
            
            # Check system resources
            import psutil
            cpu_usage = psutil.cpu_percent(interval=1)
            memory_usage = psutil.virtual_memory().percent
            
            # Log warnings for high resource usage
            if cpu_usage > 80:
                logger.warning(f"High CPU usage: {cpu_usage}%")
            
            if memory_usage > 85:
                logger.warning(f"High memory usage: {memory_usage}%")
            
            # Update system health in database
            db = SessionLocal()
            try:
                health_record = SystemHealth(
                    status="healthy" if cpu_usage < 80 and memory_usage < 85 else "warning",
                    cpu_usage=cpu_usage,
                    memory_usage=memory_usage,
                    active_connections=len(connection_manager.user_sessions),
                    last_check=datetime.utcnow()
                )
                db.add(health_record)
                db.commit()
            finally:
                db.close()
                
        except Exception as e:
            logger.error(f"Health monitoring error: {e}")

async def process_offline_sync_queue():
    """Process offline data synchronization queue"""
    while True:
        try:
            await asyncio.sleep(30)  # Process every 30 seconds
            
            if hasattr(app.state, 'redis'):
                # Get pending sync items from Redis queue
                sync_items = await app.state.redis.lrange("offline_sync_queue", 0, -1)
                
                for item_data in sync_items:
                    try:
                        # Process sync item
                        await process_sync_item(item_data)
                        # Remove from queue
                        await app.state.redis.lrem("offline_sync_queue", 1, item_data)
                    except Exception as e:
                        logger.error(f"Failed to process sync item: {e}")
                        
        except Exception as e:
            logger.error(f"Offline sync queue error: {e}")

# Helper functions
async def handle_offline_sync(user_id: str, offline_items: List[Dict[str, Any]]):
    """Handle offline data synchronization"""
    try:
        # Add items to sync queue
        if hasattr(app.state, 'redis'):
            for item in offline_items:
                item["user_id"] = user_id
                item["sync_timestamp"] = datetime.utcnow().isoformat()
                await app.state.redis.lpush("offline_sync_queue", json.dumps(item))
        
        # Send real-time update
        await connection_manager.send_personal_message({
            "type": "sync_progress",
            "items_queued": len(offline_items),
            "timestamp": datetime.utcnow().isoformat()
        }, user_id)
        
    except Exception as e:
        logger.error(f"Offline sync handling error: {e}")

async def handle_content_generation_update(user_id: str, data: Dict[str, Any]):
    """Handle content generation status updates"""
    try:
        # Process content generation request
        if hasattr(app.state, 'ai_service'):
            result = await app.state.ai_service.generate_content_async(data)
            
            # Send result via WebSocket
            await connection_manager.send_personal_message({
                "type": "content_generated",
                "content": result,
                "timestamp": datetime.utcnow().isoformat()
            }, user_id)
        
    except Exception as e:
        logger.error(f"Content generation update error: {e}")

async def process_offline_data_sync(user_id: str, offline_items: List[Dict[str, Any]]):
    """Process offline data synchronization"""
    db = SessionLocal()
    try:
        for item in offline_items:
            # Process different types of offline data
            item_type = item.get("type")
            
            if item_type == "content":
                # Save offline generated content
                await save_offline_content(db, user_id, item)
            elif item_type == "activity":
                # Log user activity
                await save_user_activity(db, user_id, item)
            elif item_type == "analytics":
                # Update analytics data
                await update_analytics_data(db, user_id, item)
        
        db.commit()
        
        # Notify user of completion
        await connection_manager.send_personal_message({
            "type": "sync_completed",
            "items_processed": len(offline_items),
            "timestamp": datetime.utcnow().isoformat()
        }, user_id)
        
    except Exception as e:
        logger.error(f"Offline data sync processing error: {e}")
        db.rollback()
    finally:
        db.close()

async def generate_content_templates_cache(user: User) -> Dict[str, Any]:
    """Generate content templates for offline usage"""
    try:
        # Generate templates based on user's subscription tier
        templates = {
            "basic_templates": [
                {"id": "post_1", "template": "Check out this amazing {product}! #trending"},
                {"id": "post_2", "template": "Just discovered {product} and I'm loving it! 💝"},
                {"id": "post_3", "template": "{product} is exactly what I needed! Highly recommend ⭐️"}
            ]
        }
        
        if user.subscription_tier in [SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE]:
            templates["premium_templates"] = [
                {"id": "premium_1", "template": "Transform your {category} game with {product}! Here's why it's perfect: {benefits}"},
                {"id": "premium_2", "template": "Before vs After using {product}: {comparison} #transformation"},
            ]
        
        if user.subscription_tier == SubscriptionTier.ENTERPRISE:
            templates["enterprise_templates"] = [
                {"id": "enterprise_1", "template": "Industry insights: {product} is revolutionizing {industry}. Data shows {statistics}"},
            ]
        
        return templates
        
    except Exception as e:
        logger.error(f"Template cache generation error: {e}")
        return {"error": "Failed to generate templates"}

async def generate_platforms_cache(user: User) -> Dict[str, Any]:
    """Generate platform configurations for offline usage"""
    platforms = {
        "freemium": ["instagram", "twitter", "facebook", "tiktok", "linkedin"],
        "premium": ["instagram", "twitter", "facebook", "tiktok", "linkedin", "youtube", "pinterest", "snapchat", "reddit", "discord"],
        "enterprise": "all"  # All 50+ platforms
    }
    
    user_platforms = platforms.get(user.subscription_tier.value, platforms["freemium"])
    
    return {
        "available_platforms": user_platforms,
        "posting_limits": {
            "freemium": 5,
            "premium": 50,
            "enterprise": -1  # Unlimited
        }.get(user.subscription_tier.value, 5),
        "features": {
            "auto_optimization": user.subscription_tier != SubscriptionTier.FREEMIUM,
            "cultural_adaptation": user.subscription_tier in [SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE],
            "ai_influencers": True
        }
    }

async def generate_analytics_cache(user: User) -> Dict[str, Any]:
    """Generate analytics data for offline usage"""
    # This would typically fetch real analytics data
    return {
        "engagement_summary": {
            "total_posts": 150,
            "total_likes": 1250,
            "total_shares": 89,
            "total_comments": 234
        },
        "top_performing_content": [
            {"id": "post_123", "engagement": 95, "platform": "instagram"},
            {"id": "post_124", "engagement": 87, "platform": "tiktok"}
        ],
        "audience_insights": {
            "demographics": {"18-24": 35, "25-34": 45, "35-44": 20},
            "top_locations": ["US", "UK", "CA", "AU"],
            "peak_times": ["12:00", "18:00", "21:00"]
        }
    }

async def get_cache_stats() -> Dict[str, Any]:
    """Get Redis cache statistics"""
    try:
        if hasattr(app.state, 'redis'):
            info = await app.state.redis.info()
            return {
                "used_memory": info.get("used_memory_human", "0B"),
                "connected_clients": info.get("connected_clients", 0),
                "total_commands_processed": info.get("total_commands_processed", 0),
                "keyspace_hits": info.get("keyspace_hits", 0),
                "keyspace_misses": info.get("keyspace_misses", 0),
                "evicted_keys": info.get("evicted_keys", 0),
                "uptime_in_days": info.get("uptime_in_days", 0)
            }
        return {}
    except Exception as e:
        logger.error(f"Error getting cache stats: {e}")
        return {"error": str(e)}

async def process_sync_item(item_data: str):
    """Process a single sync item from the offline queue"""
    try:
        item = json.loads(item_data)
        logger.info(f"Processing sync item: {item}")
        # Actual implementation would save to database
    except Exception as e:
        logger.error(f"Error processing sync item: {e}")

async def cleanup_resources():
    """Clean up resources during shutdown"""
    # Close any open connections or resources
    pass

async def save_offline_content(db: Session, user_id: str, item: Dict[str, Any]):
    """Save offline generated content to database"""
    try:
        content = GeneratedContent(
            user_id=user_id,
            content=item.get("content", ""),
            platforms=json.dumps(item.get("platforms", [])),
            generated_at=datetime.utcnow(),
            is_draft=True
        )
        db.add(content)
        db.commit()
        logger.info(f"Saved offline content for user {user_id}")
    except Exception as e:
        logger.error(f"Error saving offline content: {e}")
        db.rollback()

async def save_user_activity(db: Session, user_id: str, item: Dict[str, Any]):
    """Save user activity to database"""
    try:
        activity = UserActivity(
            user_id=user_id,
            activity_type=item.get("type", "unknown"),
            details=json.dumps(item.get("details", {})),
            timestamp=datetime.utcnow()
        )
        db.add(activity)
        db.commit()
        logger.info(f"Saved user activity for user {user_id}")
    except Exception as e:
        logger.error(f"Error saving user activity: {e}")
        db.rollback()

async def update_analytics_data(db: Session, user_id: str, item: Dict[str, Any]):
    """Update analytics data from offline usage"""
    try:
        # This would update aggregated analytics data
        logger.info(f"Updated analytics for user {user_id}")
    except Exception as e:
        logger.error(f"Error updating analytics: {e}")

# Run the application
if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        ssl_keyfile=settings.SSL_KEYFILE if settings.ENABLE_SSL else None,
        ssl_certfile=settings.SSL_CERTFILE if settings.ENABLE_SSL else None
    )