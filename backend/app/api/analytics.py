"""
ONXLink Analytics Service
Advanced user behavior tracking, engagement analytics, and retention optimization
"""

import json
import asyncio
import hashlib
import statistics
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from enum import Enum
from collections import defaultdict, deque
import sqlite3
import aiofiles
import logging
from contextlib import asynccontextmanager

from sqlalchemy import select, func, and_, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, BackgroundTasks
from pydantic import BaseModel, Field, validator
import redis.asyncio as redis
import httpx

from ..database import get_db_session
from ..models import User, Subscription, Content, SocialPost, AIInfluencer
from ..config import settings
from ..auth import get_current_user
from ..services.firebase_service import FirebaseService
from ..utils import encrypt_data, decrypt_data, rate_limit

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class EventType(str, Enum):
    """Analytics event types for comprehensive tracking"""
    USER_LOGIN = "user_login"
    USER_LOGOUT = "user_logout"
    USER_SIGNUP = "user_signup"
    SUBSCRIPTION_UPGRADE = "subscription_upgrade"
    SUBSCRIPTION_DOWNGRADE = "subscription_downgrade"
    CONTENT_GENERATED = "content_generated"
    CONTENT_PUBLISHED = "content_published"
    CONTENT_SCHEDULED = "content_scheduled"
    PLATFORM_CONNECTED = "platform_connected"
    PLATFORM_DISCONNECTED = "platform_disconnected"
    AI_INFLUENCER_CREATED = "ai_influencer_created"
    AI_INFLUENCER_UPDATED = "ai_influencer_updated"
    BULK_DELETE_PERFORMED = "bulk_delete_performed"
    VOICE_COMMAND_USED = "voice_command_used"
    CULTURAL_ADAPTATION_USED = "cultural_adaptation_used"
    PREDICTIVE_INVENTORY_VIEW = "predictive_inventory_view"
    FEATURE_ACCESSED = "feature_accessed"
    FEATURE_BLOCKED = "feature_blocked"
    ERROR_OCCURRED = "error_occurred"
    SESSION_START = "session_start"
    SESSION_END = "session_end"
    PAGE_VIEW = "page_view"
    CLICK_EVENT = "click_event"
    SCROLL_EVENT = "scroll_event"
    SEARCH_PERFORMED = "search_performed"
    EXPORT_DATA = "export_data"
    SETTINGS_CHANGED = "settings_changed"
    TUTORIAL_STARTED = "tutorial_started"
    TUTORIAL_COMPLETED = "tutorial_completed"
    FEEDBACK_SUBMITTED = "feedback_submitted"
    REFERRAL_MADE = "referral_made"
    OFFLINE_ACTION = "offline_action"
    SYNC_COMPLETED = "sync_completed"

class UserSegment(str, Enum):
    """User segmentation for targeted analytics"""
    NEW_USER = "new_user"
    ACTIVE_USER = "active_user"
    POWER_USER = "power_user"
    CHURNED_USER = "churned_user"
    PREMIUM_USER = "premium_user"
    ENTERPRISE_USER = "enterprise_user"
    FREEMIUM_USER = "freemium_user"

@dataclass
class AnalyticsEvent:
    """Structured analytics event with offline support"""
    event_type: EventType
    user_id: str
    session_id: str
    timestamp: datetime
    properties: Dict[str, Any]
    metadata: Dict[str, Any]
    platform: str
    app_version: str
    offline: bool = False
    synced: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            **asdict(self),
            'timestamp': self.timestamp.isoformat(),
            'properties': json.dumps(self.properties),
            'metadata': json.dumps(self.metadata)
        }

@dataclass
class UserEngagementMetrics:
    """Comprehensive user engagement tracking"""
    user_id: str
    session_count: int
    total_session_duration: float
    avg_session_duration: float
    features_used: List[str]
    content_generated: int
    content_published: int
    platforms_connected: int
    ai_influencers_created: int
    last_active: datetime
    engagement_score: float
    retention_risk: float
    segment: UserSegment

@dataclass
class RealtimeMetrics:
    """Real-time analytics dashboard metrics"""
    active_users: int
    current_sessions: int
    events_per_minute: int
    content_generation_rate: float
    error_rate: float
    avg_response_time: float
    platform_distribution: Dict[str, int]
    subscription_conversion_rate: float

class AnalyticsRequest(BaseModel):
    """Request model for analytics events"""
    event_type: EventType
    properties: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    platform: str = "web"
    app_version: str = "1.0.0"
    
    @validator('properties', 'metadata')
    def validate_json_serializable(cls, v):
        try:
            json.dumps(v)
            return v
        except (TypeError, ValueError):
            raise ValueError("Properties and metadata must be JSON serializable")

class OfflineAnalyticsDB:
    """SQLite database for offline analytics storage"""
    
    def __init__(self, db_path: str = "analytics_offline.db"):
        self.db_path = db_path
        self._init_db()
    
    def _init_db(self):
        """Initialize offline analytics database"""
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS analytics_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                user_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                properties TEXT,
                metadata TEXT,
                platform TEXT,
                app_version TEXT,
                offline BOOLEAN DEFAULT TRUE,
                synced BOOLEAN DEFAULT FALSE,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                session_id TEXT UNIQUE NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT,
                duration REAL,
                events_count INTEGER DEFAULT 0,
                platform TEXT,
                synced BOOLEAN DEFAULT FALSE
            )
        """)
        
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_events_user_id ON analytics_events(user_id);
            CREATE INDEX IF NOT EXISTS idx_events_timestamp ON analytics_events(timestamp);
            CREATE INDEX IF NOT EXISTS idx_events_synced ON analytics_events(synced);
            CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
        """)
        
        conn.commit()
        conn.close()
    
    def store_event(self, event: AnalyticsEvent) -> bool:
        """Store event in offline database"""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute("""
                INSERT INTO analytics_events 
                (event_type, user_id, session_id, timestamp, properties, metadata, platform, app_version, offline, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                event.event_type.value,
                event.user_id,
                event.session_id,
                event.timestamp.isoformat(),
                json.dumps(event.properties),
                json.dumps(event.metadata),
                event.platform,
                event.app_version,
                event.offline,
                event.synced
            ))
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.error(f"Failed to store offline event: {e}")
            return False
    
    def get_unsynced_events(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Get unsynced events for batch upload"""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("""
                SELECT * FROM analytics_events 
                WHERE synced = FALSE 
                ORDER BY timestamp ASC 
                LIMIT ?
            """, (limit,))
            events = [dict(row) for row in cursor.fetchall()]
            conn.close()
            return events
        except Exception as e:
            logger.error(f"Failed to get unsynced events: {e}")
            return []
    
    def mark_events_synced(self, event_ids: List[int]) -> bool:
        """Mark events as synced"""
        try:
            conn = sqlite3.connect(self.db_path)
            placeholders = ','.join('?' * len(event_ids))
            conn.execute(f"""
                UPDATE analytics_events 
                SET synced = TRUE 
                WHERE id IN ({placeholders})
            """, event_ids)
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.error(f"Failed to mark events as synced: {e}")
            return False

class SmartAnalyticsEngine:
    """Intelligent analytics engine with ML-based insights"""
    
    def __init__(self):
        self.user_behavior_patterns = defaultdict(lambda: {
            'session_times': deque(maxlen=50),
            'feature_usage': defaultdict(int),
            'content_creation_times': [],
            'platform_preferences': defaultdict(int),
            'churn_signals': []
        })
        self.engagement_thresholds = {
            'high': 0.8,
            'medium': 0.5,
            'low': 0.2
        }
    
    def calculate_engagement_score(self, metrics: UserEngagementMetrics) -> float:
        """Calculate user engagement score using weighted factors"""
        factors = {
            'session_frequency': min(metrics.session_count / 30, 1.0) * 0.25,
            'session_duration': min(metrics.avg_session_duration / 1800, 1.0) * 0.20,  # 30 min ideal
            'feature_diversity': len(metrics.features_used) / 10 * 0.15,
            'content_activity': min(metrics.content_generated / 50, 1.0) * 0.20,
            'social_connectivity': min(metrics.platforms_connected / 5, 1.0) * 0.10,
            'creative_activity': min(metrics.ai_influencers_created / 3, 1.0) * 0.10
        }
        
        return sum(factors.values())
    
    def predict_churn_risk(self, user_id: str, recent_events: List[AnalyticsEvent]) -> float:
        """Predict user churn risk based on behavior patterns"""
        if not recent_events:
            return 0.8  # High risk if no recent activity
        
        # Analyze behavior patterns
        session_gaps = []
        feature_usage_decline = 0
        error_frequency = 0
        
        for i, event in enumerate(recent_events[1:], 1):
            prev_event = recent_events[i-1]
            gap = (event.timestamp - prev_event.timestamp).total_seconds() / 3600
            session_gaps.append(gap)
            
            if event.event_type == EventType.ERROR_OCCURRED:
                error_frequency += 1
        
        # Calculate risk factors
        avg_gap = statistics.mean(session_gaps) if session_gaps else 0
        gap_risk = min(avg_gap / 168, 1.0)  # 1 week = high risk
        error_risk = min(error_frequency / len(recent_events), 1.0)
        
        # Combine risk factors
        churn_risk = (gap_risk * 0.6 + error_risk * 0.4)
        return min(churn_risk, 1.0)
    
    def generate_user_insights(self, user_id: str, metrics: UserEngagementMetrics) -> Dict[str, Any]:
        """Generate actionable insights for user engagement"""
        insights = {
            'engagement_level': 'high' if metrics.engagement_score > 0.8 else 'medium' if metrics.engagement_score > 0.5 else 'low',
            'churn_risk': metrics.retention_risk,
            'recommendations': [],
            'strengths': [],
            'opportunities': []
        }
        
        # Generate recommendations
        if metrics.platforms_connected < 3:
            insights['recommendations'].append({
                'type': 'platform_integration',
                'message': 'Connect more social platforms to amplify your reach',
                'priority': 'high'
            })
        
        if metrics.ai_influencers_created == 0:
            insights['recommendations'].append({
                'type': 'ai_influencer',
                'message': 'Create your first AI influencer to boost engagement',
                'priority': 'medium'
            })
        
        if metrics.content_published < metrics.content_generated * 0.5:
            insights['recommendations'].append({
                'type': 'content_publishing',
                'message': 'Publish more of your generated content to maximize impact',
                'priority': 'high'
            })
        
        # Identify strengths
        if metrics.session_count > 20:
            insights['strengths'].append('High platform engagement')
        
        if metrics.content_generated > 30:
            insights['strengths'].append('Active content creator')
        
        return insights

class AdvancedAnalyticsService:
    """Comprehensive analytics service with offline support and intelligent insights"""
    
    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self.offline_db = OfflineAnalyticsDB()
        self.analytics_engine = SmartAnalyticsEngine()
        self.firebase_service = FirebaseService()
        self.session_cache = {}
        self.realtime_metrics = RealtimeMetrics(
            active_users=0,
            current_sessions=0,
            events_per_minute=0,
            content_generation_rate=0.0,
            error_rate=0.0,
            avg_response_time=0.0,
            platform_distribution={},
            subscription_conversion_rate=0.0
        )
        self._init_redis()
    
    async def _init_redis(self):
        """Initialize Redis connection for real-time analytics"""
        try:
            self.redis_client = redis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5
            )
            await self.redis_client.ping()
            logger.info("Redis connection established for analytics")
        except Exception as e:
            logger.warning(f"Redis connection failed, using offline mode: {e}")
            self.redis_client = None
    
    async def track_event(
        self,
        user_id: str,
        session_id: str,
        event_request: AnalyticsRequest,
        background_tasks: BackgroundTasks
    ) -> Dict[str, str]:
        """Track analytics event with offline support"""
        try:
            # Create analytics event
            event = AnalyticsEvent(
                event_type=event_request.event_type,
                user_id=user_id,
                session_id=session_id,
                timestamp=datetime.now(timezone.utc),
                properties=event_request.properties,
                metadata=event_request.metadata,
                platform=event_request.platform,
                app_version=event_request.app_version,
                offline=self.redis_client is None
            )
            
            # Store in offline database for reliability
            self.offline_db.store_event(event)
            
            # Store in Redis for real-time analytics if available
            if self.redis_client:
                background_tasks.add_task(self._store_realtime_event, event)
            
            # Update user behavior patterns
            background_tasks.add_task(self._update_user_patterns, user_id, event)
            
            # Store in main database
            background_tasks.add_task(self._store_database_event, event)
            
            # Send to Firebase Analytics
            background_tasks.add_task(self._send_to_firebase, event)
            
            return {"status": "tracked", "event_id": f"{user_id}_{int(event.timestamp.timestamp())}"}
            
        except Exception as e:
            logger.error(f"Error tracking event: {e}")
            # Still store offline even if other services fail
            if hasattr(event, 'event_type'):
                self.offline_db.store_event(event)
            raise HTTPException(status_code=500, detail="Failed to track event")
    
    async def _store_realtime_event(self, event: AnalyticsEvent):
        """Store event in Redis for real-time analytics"""
        try:
            if not self.redis_client:
                return
            
            # Store individual event
            event_key = f"event:{event.user_id}:{int(event.timestamp.timestamp())}"
            await self.redis_client.setex(
                event_key,
                86400,  # 24 hours TTL
                json.dumps(event.to_dict())
            )
            
            # Update real-time counters
            await self._update_realtime_metrics(event)
            
        except Exception as e:
            logger.error(f"Failed to store real-time event: {e}")
    
    async def _update_realtime_metrics(self, event: AnalyticsEvent):
        """Update real-time metrics in Redis"""
        try:
            if not self.redis_client:
                return
            
            current_minute = datetime.now().replace(second=0, microsecond=0)
            minute_key = f"metrics:{current_minute.isoformat()}"
            
            # Increment event counter for this minute
            await self.redis_client.incr(f"{minute_key}:events")
            await self.redis_client.expire(f"{minute_key}:events", 3600)
            
            # Track active users
            user_key = f"active_users:{current_minute.date().isoformat()}"
            await self.redis_client.sadd(user_key, event.user_id)
            await self.redis_client.expire(user_key, 86400)
            
            # Track platform distribution
            platform_key = f"platforms:{current_minute.date().isoformat()}"
            await self.redis_client.hincrby(platform_key, event.platform, 1)
            await self.redis_client.expire(platform_key, 86400)
            
        except Exception as e:
            logger.error(f"Failed to update real-time metrics: {e}")
    
    async def _update_user_patterns(self, user_id: str, event: AnalyticsEvent):
        """Update user behavior patterns for ML insights"""
        try:
            patterns = self.analytics_engine.user_behavior_patterns[user_id]
            
            # Track session timing
            if event.event_type == EventType.SESSION_START:
                patterns['session_times'].append(event.timestamp)
            
            # Track feature usage
            if event.event_type == EventType.FEATURE_ACCESSED:
                feature_name = event.properties.get('feature_name', 'unknown')
                patterns['feature_usage'][feature_name] += 1
            
            # Track content creation patterns
            if event.event_type == EventType.CONTENT_GENERATED:
                patterns['content_creation_times'].append(event.timestamp)
            
            # Track platform preferences
            patterns['platform_preferences'][event.platform] += 1
            
            # Detect churn signals
            if event.event_type in [EventType.ERROR_OCCURRED, EventType.FEATURE_BLOCKED]:
                patterns['churn_signals'].append({
                    'timestamp': event.timestamp,
                    'signal': event.event_type.value,
                    'details': event.properties
                })
                
                # Keep only recent churn signals
                cutoff = datetime.now(timezone.utc) - timedelta(days=30)
                patterns['churn_signals'] = [
                    signal for signal in patterns['churn_signals']
                    if signal['timestamp'] > cutoff
                ]
            
        except Exception as e:
            logger.error(f"Failed to update user patterns: {e}")
    
    async def _store_database_event(self, event: AnalyticsEvent):
        """Store event in main database"""
        try:
            async with get_db_session() as db:
                # This would typically insert into an analytics_events table
                # For now, we'll use the offline database as the primary store
                pass
        except Exception as e:
            logger.error(f"Failed to store database event: {e}")
    
    async def _send_to_firebase(self, event: AnalyticsEvent):
        """Send event to Firebase Analytics"""
        try:
            await self.firebase_service.log_event(
                event.event_type.value,
                {
                    'user_id': event.user_id,
                    'platform': event.platform,
                    'app_version': event.app_version,
                    **event.properties
                }
            )
        except Exception as e:
            logger.error(f"Failed to send to Firebase: {e}")
    
    @rate_limit(max_requests=10, window_seconds=60)
    async def get_user_analytics(self, user_id: str) -> Dict[str, Any]:
        """Get comprehensive user analytics with intelligent insights"""
        try:
            # Get user engagement metrics
            metrics = await self._calculate_user_metrics(user_id)
            
            # Generate AI insights
            insights = self.analytics_engine.generate_user_insights(user_id, metrics)
            
            # Get recent activity
            recent_events = await self._get_recent_user_events(user_id, limit=50)
            
            # Calculate trends
            trends = await self._calculate_user_trends(user_id)
            
            return {
                'user_id': user_id,
                'metrics': asdict(metrics),
                'insights': insights,
                'recent_activity': recent_events,
                'trends': trends,
                'generated_at': datetime.now(timezone.utc).isoformat()
            }
            
        except Exception as e:
            logger.error(f"Failed to get user analytics: {e}")
            # Return cached data if available
            return await self._get_cached_user_analytics(user_id)
    
    async def _calculate_user_metrics(self, user_id: str) -> UserEngagementMetrics:
        """Calculate comprehensive user engagement metrics"""
        try:
            # Get events from offline database
            conn = sqlite3.connect(self.offline_db.db_path)
            conn.row_factory = sqlite3.Row
            
            # Calculate session metrics
            session_cursor = conn.execute("""
                SELECT COUNT(*) as session_count,
                       AVG(duration) as avg_duration,
                       SUM(duration) as total_duration
                FROM user_sessions 
                WHERE user_id = ? AND start_time > datetime('now', '-30 days')
            """, (user_id,))
            session_data = session_cursor.fetchone()
            
            # Calculate feature usage
            feature_cursor = conn.execute("""
                SELECT DISTINCT json_extract(properties, '$.feature_name') as feature
                FROM analytics_events 
                WHERE user_id = ? AND event_type = 'feature_accessed'
                AND timestamp > datetime('now', '-30 days')
            """, (user_id,))
            features_used = [row['feature'] for row in feature_cursor.fetchall() if row['feature']]
            
            # Calculate content metrics
            content_cursor = conn.execute("""
                SELECT 
                    COUNT(CASE WHEN event_type = 'content_generated' THEN 1 END) as generated,
                    COUNT(CASE WHEN event_type = 'content_published' THEN 1 END) as published
                FROM analytics_events 
                WHERE user_id = ? AND timestamp > datetime('now', '-30 days')
            """, (user_id,))
            content_data = content_cursor.fetchone()
            
            # Calculate platform connections
            platform_cursor = conn.execute("""
                SELECT COUNT(DISTINCT json_extract(properties, '$.platform')) as platforms
                FROM analytics_events 
                WHERE user_id = ? AND event_type = 'platform_connected'
            """, (user_id,))
            platform_data = platform_cursor.fetchone()
            
            # Calculate AI influencer count
            ai_cursor = conn.execute("""
                SELECT COUNT(DISTINCT json_extract(properties, '$.influencer_id')) as ai_count
                FROM analytics_events 
                WHERE user_id = ? AND event_type = 'ai_influencer_created'
            """, (user_id,))
            ai_data = ai_cursor.fetchone()
            
            # Get last activity
            last_activity_cursor = conn.execute("""
                SELECT MAX(timestamp) as last_active
                FROM analytics_events 
                WHERE user_id = ?
            """, (user_id,))
            last_activity = last_activity_cursor.fetchone()['last_active']
            
            conn.close()
            
            # Create metrics object
            metrics = UserEngagementMetrics(
                user_id=user_id,
                session_count=session_data['session_count'] or 0,
                total_session_duration=session_data['total_duration'] or 0,
                avg_session_duration=session_data['avg_duration'] or 0,
                features_used=features_used,
                content_generated=content_data['generated'] or 0,
                content_published=content_data['published'] or 0,
                platforms_connected=platform_data['platforms'] or 0,
                ai_influencers_created=ai_data['ai_count'] or 0,
                last_active=datetime.fromisoformat(last_activity) if last_activity else datetime.now(timezone.utc),
                engagement_score=0.0,
                retention_risk=0.0,
                segment=UserSegment.NEW_USER
            )
            
            # Calculate derived metrics
            metrics.engagement_score = self.analytics_engine.calculate_engagement_score(metrics)
            
            # Get recent events for churn prediction
            recent_events = await self._get_recent_user_events(user_id, limit=20)
            metrics.retention_risk = self.analytics_engine.predict_churn_risk(user_id, recent_events)
            
            # Determine user segment
            metrics.segment = self._determine_user_segment(metrics)
            
            return metrics
            
        except Exception as e:
            logger.error(f"Failed to calculate user metrics: {e}")
            # Return default metrics
            return UserEngagementMetrics(
                user_id=user_id,
                session_count=0,
                total_session_duration=0,
                avg_session_duration=0,
                features_used=[],
                content_generated=0,
                content_published=0,
                platforms_connected=0,
                ai_influencers_created=0,
                last_active=datetime.now(timezone.utc),
                engagement_score=0.0,
                retention_risk=0.5,
                segment=UserSegment.NEW_USER
            )
    
    def _determine_user_segment(self, metrics: UserEngagementMetrics) -> UserSegment:
        """Determine user segment based on engagement metrics"""
        days_since_last_active = (datetime.now(timezone.utc) - metrics.last_active).days
        
        if days_since_last_active > 30:
            return UserSegment.CHURNED_USER
        elif metrics.engagement_score > 0.8 and metrics.content_generated > 50:
            return UserSegment.POWER_USER
        elif metrics.engagement_score > 0.6:
            return UserSegment.ACTIVE_USER
        elif days_since_last_active <= 7:
            return UserSegment.NEW_USER
        else:
            return UserSegment.FREEMIUM_USER
    
    async def _get_recent_user_events(self, user_id: str, limit: int = 20) -> List[AnalyticsEvent]:
        """Get recent user events for analysis"""
        try:
            conn = sqlite3.connect(self.offline_db.db_path)
            conn.row_factory = sqlite3.Row
            
            cursor = conn.execute("""
                SELECT * FROM analytics_events 
                WHERE user_id = ? 
                ORDER BY timestamp DESC 
                LIMIT ?
            """, (user_id, limit))
            
            events = []
            for row in cursor.fetchall():
                event = AnalyticsEvent(
                    event_type=EventType(row['event_type']),
                    user_id=row['user_id'],
                    session_id=row['session_id'],
                    timestamp=datetime.fromisoformat(row['timestamp']),
                    properties=json.loads(row['properties']) if row['properties'] else {},
                    metadata=json.loads(row['metadata']) if row['metadata'] else {},
                    platform=row['platform'],
                    app_version=row['app_version'],
                    offline=bool(row['offline']),
                    synced=bool(row['synced'])
                )
                events.append(event)
            
            conn.close()
            return events
            
        except Exception as e:
            logger.error(f"Failed to get recent user events: {e}")
            return []
    
    async def _calculate_user_trends(self, user_id: str) -> Dict[str, Any]:
        """Calculate user activity trends"""
        try:
            conn = sqlite3.connect(self.offline_db.db_path)
            
            # Daily activity trend (last 30 days)
            daily_cursor = conn.execute("""
                SELECT DATE(timestamp) as date, 
                       COUNT(*) as events,
                       COUNT(DISTINCT session_id) as sessions
                FROM analytics_events 
                WHERE user_id = ? 
                AND timestamp > datetime('now', '-30 days')
                GROUP BY DATE(timestamp)
                ORDER BY date
            """, (user_id,))
            
            daily_activity = [dict(row) for row in daily_cursor.fetchall()]
            
            # Feature usage trend
            feature_cursor = conn.execute("""
                SELECT json_extract(properties, '$.feature_name') as feature,
                       COUNT(*) as usage_count
                FROM analytics_events 
                WHERE user_id = ? 
                AND event_type = 'feature_accessed'
                AND timestamp > datetime('now', '-30 days')
                GROUP BY feature
                ORDER BY usage_count DESC
                LIMIT 10
            """, (user_id,))
            
            feature_usage = [dict(row) for row in feature_cursor.fetchall()]
            
            conn.close()
            
            return {
                'daily_activity': daily_activity,
                'feature_usage': feature_usage,
                'trend_direction': self._calculate_trend_direction(daily_activity)
            }
            
        except Exception as e:
                        logger.error(f"Failed to calculate user trends: {e}")
            return {
                'daily_activity': [],
                'feature_usage': [],
                'trend_direction': 'stable'
            }
    
    def _calculate_trend_direction(self, daily_activity: List[Dict]) -> str:
        """Calculate trend direction based on last two weeks of activity"""
        if len(daily_activity) < 2:
            return 'stable'
        
        # Split into two weeks for comparison
        midpoint = len(daily_activity) // 2
        first_half = daily_activity[:midpoint]
        second_half = daily_activity[midpoint:]
        
        # Calculate average events per day
        first_avg = sum(day['events'] for day in first_half) / len(first_half)
        second_avg = sum(day['events'] for day in second_half) / len(second_half)
        
        # Determine trend direction
        if second_avg > first_avg * 1.2:
            return 'increasing'
        elif second_avg < first_avg * 0.8:
            return 'decreasing'
        return 'stable'
    
    async def get_realtime_metrics(self) -> RealtimeMetrics:
        """Get real-time platform metrics"""
        try:
            if not self.redis_client:
                return self.realtime_metrics
                
            current_minute = datetime.now().replace(second=0, microsecond=0)
            minute_key = f"metrics:{current_minute.isoformat()}"
            
            # Get active users
            user_key = f"active_users:{current_minute.date().isoformat()}"
            active_users = await self.redis_client.scard(user_key)
            
            # Get events per minute
            events_per_minute = int(await self.redis_client.get(f"{minute_key}:events") or 0
            
            # Get platform distribution
            platform_key = f"platforms:{current_minute.date().isoformat()}"
            platform_distribution = await self.redis_client.hgetall(platform_key)
            
            # Update realtime metrics
            self.realtime_metrics.active_users = active_users
            self.realtime_metrics.events_per_minute = events_per_minute
            self.realtime_metrics.platform_distribution = {
                k: int(v) for k, v in platform_distribution.items()
            }
            
            return self.realtime_metrics
            
        except Exception as e:
            logger.error(f"Failed to get realtime metrics: {e}")
            return self.realtime_metrics
    
    async def sync_offline_events(self, background_tasks: BackgroundTasks):
        """Synchronize offline events with main database"""
        try:
            unsynced_events = self.offline_db.get_unsynced_events(limit=100)
            if not unsynced_events:
                return {"status": "no_events"}
            
            # Process in background
            background_tasks.add_task(self._process_batch_sync, unsynced_events)
            return {"status": "sync_started", "count": len(unsynced_events)}
            
        except Exception as e:
            logger.error(f"Failed to sync offline events: {e}")
            raise HTTPException(status_code=500, detail="Offline sync failed")
    
    async def _process_batch_sync(self, events: List[Dict[str, Any]]):
        """Process batch synchronization of offline events"""
        try:
            event_ids = [event['id'] for event in events]
            
            # Convert to AnalyticsEvent objects
            parsed_events = []
            for event in events:
                parsed_events.append(AnalyticsEvent(
                    event_type=EventType(event['event_type']),
                    user_id=event['user_id'],
                    session_id=event['session_id'],
                    timestamp=datetime.fromisoformat(event['timestamp']),
                    properties=json.loads(event['properties']),
                    metadata=json.loads(event['metadata']),
                    platform=event['platform'],
                    app_version=event['app_version'],
                    offline=True,
                    synced=False
                ))
            
            # Store in main database
            async with get_db_session() as db:
                # Implementation for bulk insert would go here
                pass
            
            # Send to Firebase
            for event in parsed_events:
                await self._send_to_firebase(event)
            
            # Mark as synced in offline DB
            self.offline_db.mark_events_synced(event_ids)
            
            logger.info(f"Synced {len(events)} offline events")
            
        except Exception as e:
            logger.error(f"Batch sync failed: {e}")
    
    async def generate_retention_report(self, user_id: str) -> Dict[str, Any]:
        """Generate comprehensive retention report with actionable insights"""
        metrics = await self._calculate_user_metrics(user_id)
        insights = self.analytics_engine.generate_user_insights(user_id, metrics)
        trends = await self._calculate_user_trends(user_id)
        
        return {
            "user_id": user_id,
            "engagement_score": metrics.engagement_score,
            "retention_risk": metrics.retention_risk,
            "user_segment": metrics.segment.value,
            "key_metrics": {
                "sessions_last_30d": metrics.session_count,
                "avg_session_duration": f"{metrics.avg_session_duration / 60:.1f} min",
                "content_generated": metrics.content_generated,
                "platforms_connected": metrics.platforms_connected
            },
            "insights": insights,
            "action_plan": self._generate_action_plan(insights),
            "trends": trends,
            "report_generated": datetime.now(timezone.utc).isoformat()
        }
    
    def _generate_action_plan(self, insights: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Generate personalized action plan based on insights"""
        action_plan = []
        
        for rec in insights.get('recommendations', []):
            if rec['priority'] == 'high':
                action_plan.append({
                    "action": rec['type'],
                    "description": rec['message'],
                    "priority": "critical",
                    "resources": self._get_action_resources(rec['type'])
                })
        
        if insights.get('engagement_level') == 'low':
            action_plan.append({
                "action": "engagement_boost",
                "description": "Re-engage with personalized content suggestions",
                "priority": "high",
                "resources": ["/content-suggestions", "/tutorials/engagement"]
            })
        
        if insights.get('churn_risk', 0) > 0.7:
            action_plan.append({
                "action": "retention_intervention",
                "description": "Implement retention strategies for at-risk user",
                "priority": "critical",
                "resources": ["/retention-tools", "/support"]
            })
        
        return action_plan
    
    def _get_action_resources(self, action_type: str) -> List[str]:
        """Get relevant resources for each action type"""
        resources = {
            "platform_integration": ["/platforms", "/tutorials/integration"],
            "ai_influencer": ["/ai-influencers/create", "/tutorials/influencers"],
            "content_publishing": ["/content-scheduler", "/tutorials/publishing"]
        }
        return resources.get(action_type, ["/learn"])
    
    async def get_feature_usage_heatmap(self, user_id: str) -> Dict[str, Any]:
        """Generate feature usage heatmap data"""
        try:
            conn = sqlite3.connect(self.offline_db.db_path)
            conn.row_factory = sqlite3.Row
            
            # Get feature usage by hour of day
            cursor = conn.execute("""
                SELECT 
                    STRFTIME('%H', timestamp) as hour,
                    json_extract(properties, '$.feature_name') as feature,
                    COUNT(*) as usage_count
                FROM analytics_events 
                WHERE user_id = ? 
                AND event_type = 'feature_accessed'
                GROUP BY hour, feature
            """, (user_id,))
            
            heatmap_data = {}
            for row in cursor.fetchall():
                hour = row['hour']
                feature = row['feature'] or 'unknown'
                count = row['usage_count']
                
                if hour not in heatmap_data:
                    heatmap_data[hour] = {}
                heatmap_data[hour][feature] = count
            
            conn.close()
            
            # Normalize data for visualization
            max_count = max(max(values.values()) for values in heatmap_data.values()) if heatmap_data else 1
            normalized_data = {}
            for hour, features in heatmap_data.items():
                normalized_data[hour] = {
                    feature: count / max_count
                    for feature, count in features.items()
                }
            
            return normalized_data
            
        except Exception as e:
            logger.error(f"Failed to generate heatmap: {e}")
            return {}
    
    async def get_platform_performance(self, user_id: str) -> Dict[str, Any]:
        """Get platform performance metrics"""
        try:
            conn = sqlite3.connect(self.offline_db.db_path)
            conn.row_factory = sqlite3.Row
            
            # Get engagement metrics per platform
            cursor = conn.execute("""
                SELECT 
                    json_extract(properties, '$.platform') as platform,
                    COUNT(CASE WHEN event_type = 'content_published' THEN 1 END) as published,
                    COUNT(CASE WHEN event_type = 'click_event' THEN 1 END) as clicks,
                    COUNT(CASE WHEN event_type = 'error_occurred' THEN 1 END) as errors
                FROM analytics_events 
                WHERE user_id = ? 
                AND platform IS NOT NULL
                GROUP BY platform
            """, (user_id,))
            
            platform_data = {}
            for row in cursor.fetchall():
                platform = row['platform']
                platform_data[platform] = {
                    "published": row['published'],
                    "clicks": row['clicks'],
                    "errors": row['errors'],
                    "error_rate": row['errors'] / max(row['published'], 1)
                }
            
            conn.close()
            return platform_data
            
        except Exception as e:
            logger.error(f"Failed to get platform performance: {e}")
            return {}
    
    async def predict_content_performance(self, content_properties: Dict[str, Any]) -> Dict[str, float]:
        """Predict content performance using historical patterns"""
        # In a production system, this would use a trained ML model
        # For MVP, we'll use heuristic-based predictions
        platform = content_properties.get('platform', 'instagram')
        content_type = content_properties.get('content_type', 'image')
        length = content_properties.get('length', 0)
        
        # Base engagement rates by platform (simulated)
        base_rates = {
            'instagram': 0.04,
            'tiktok': 0.08,
            'facebook': 0.02,
            'twitter': 0.01
        }
        
        # Adjustments based on content type
        type_adjustments = {
            'image': 1.0,
            'video': 1.5,
            'carousel': 1.2,
            'reel': 1.8
        }
        
        # Length adjustment (optimal 15-30s for video, 0-100 chars for text)
        length_factor = 1.0
        if content_type == 'video':
            if 15 <= length <= 30:
                length_factor = 1.5
            elif length > 60:
                length_factor = 0.7
        elif content_type == 'text':
            if len(content_properties.get('text', '')) > 100:
                length_factor = 0.8
        
        # Calculate predicted engagement
        base_rate = base_rates.get(platform, 0.03)
        type_factor = type_adjustments.get(content_type, 1.0)
        predicted_engagement = base_rate * type_factor * length_factor
        
        return {
            "predicted_engagement": min(predicted_engagement, 0.15),
            "estimated_reach": content_properties.get('follower_count', 1000) * predicted_engagement,
            "confidence_score": 0.75  # Simulated confidence
        }

class AnalyticsAPI:
    """API endpoints for analytics functionality"""
    
    def __init__(self, analytics_service: AdvancedAnalyticsService):
        self.service = analytics_service
    
    async def track_event_endpoint(
        self,
        event_request: AnalyticsRequest,
        background_tasks: BackgroundTasks,
        current_user: User = Depends(get_current_user)
    ) -> Dict[str, str]:
        """Endpoint for tracking analytics events"""
        session_id = request.cookies.get('session_id', str(uuid.uuid4()))
        return await self.service.track_event(
            current_user.id,
            session_id,
            event_request,
            background_tasks
        )
    
    async def get_user_analytics_endpoint(
        self,
        current_user: User = Depends(get_current_user)
    ) -> Dict[str, Any]:
        """Endpoint for user analytics dashboard"""
        return await self.service.get_user_analytics(current_user.id)
    
    async def get_realtime_metrics_endpoint(
        self,
        current_user: User = Depends(get_current_user)
    ) -> RealtimeMetrics:
        """Endpoint for real-time platform metrics"""
        if current_user.subscription_tier not in ['premium', 'enterprise']:
            raise HTTPException(status_code=403, detail="Premium feature")
        return await self.service.get_realtime_metrics()
    
    async def sync_offline_events_endpoint(
        self,
        background_tasks: BackgroundTasks,
        current_user: User = Depends(get_current_user)
    ) -> Dict[str, Any]:
        """Endpoint for syncing offline events"""
        return await self.service.sync_offline_events(background_tasks)
    
    async def retention_report_endpoint(
        self,
        current_user: User = Depends(get_current_user)
    ) -> Dict[str, Any]:
        """Endpoint for user retention report"""
        if current_user.subscription_tier != 'enterprise':
            raise HTTPException(status_code=403, detail="Enterprise feature")
        return await self.service.generate_retention_report(current_user.id)
    
    async def content_performance_prediction_endpoint(
        self,
        content_properties: Dict[str, Any],
        current_user: User = Depends(get_current_user)
    ) -> Dict[str, float]:
        """Endpoint for content performance prediction"""
        if current_user.subscription_tier not in ['premium', 'enterprise']:
            raise HTTPException(status_code=403, detail="Premium feature")
        return await self.service.predict_content_performance(content_properties)

# Initialize analytics service
analytics_service = AdvancedAnalyticsService()
analytics_api = AnalyticsAPI(analytics_service)

# Background task for periodic sync
async def periodic_offline_sync():
    while True:
        try:
            await asyncio.sleep(300)  # Sync every 5 minutes
            unsynced = analytics_service.offline_db.get_unsynced_events()
            if unsynced:
                await analytics_service._process_batch_sync(unsynced)
        except Exception as e:
            logger.error(f"Periodic sync failed: {e}")

# Start background sync task
asyncio.create_task(periodic_offline_sync())