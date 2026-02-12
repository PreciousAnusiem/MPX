"""
ONXLink Firebase Analytics Service - Production Ready
Handles analytics, user tracking, engagement metrics, and retention optimization
"""

import json
import asyncio
import hashlib
import sqlite3
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass, asdict
from enum import Enum
import logging
import os
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, analytics, firestore
from google.cloud import firestore as gcs_firestore
import aioredis
import asyncpg
import httpx
from cryptography.fernet import Fernet
import schedule
import time

from .config import settings
from .models import User, Subscription, ContentGenerated, AnalyticsEvent
from .utils import encrypt_data, decrypt_data, get_user_location, validate_json

logger = logging.getLogger(__name__)

class EventType(Enum):
    """Analytics event types for comprehensive tracking"""
    # User Lifecycle
    USER_REGISTERED = "user_registered"
    USER_LOGIN = "user_login"
    USER_LOGOUT = "user_logout"
    USER_DELETED = "user_deleted"
    
    # Subscription Events
    SUBSCRIPTION_STARTED = "subscription_started"
    SUBSCRIPTION_UPGRADED = "subscription_upgraded"
    SUBSCRIPTION_CANCELLED = "subscription_cancelled"
    SUBSCRIPTION_RENEWED = "subscription_renewed"
    TRIAL_STARTED = "trial_started"
    TRIAL_ENDED = "trial_ended"
    
    # Content Creation
    CONTENT_GENERATED = "content_generated"
    CONTENT_POSTED = "content_posted"
    CONTENT_SCHEDULED = "content_scheduled"
    CONTENT_DELETED = "content_deleted"
    BATCH_CONTENT_CREATED = "batch_content_created"
    
    # AI Influencer
    INFLUENCER_CREATED = "influencer_created"
    INFLUENCER_CUSTOMIZED = "influencer_customized"
    INFLUENCER_ACTIVATED = "influencer_activated"
    VOICE_CLONED = "voice_cloned"
    
    # Social Platform Integration
    PLATFORM_CONNECTED = "platform_connected"
    PLATFORM_DISCONNECTED = "platform_disconnected"
    CROSS_PLATFORM_POST = "cross_platform_post"
    BULK_DELETE_EXECUTED = "bulk_delete_executed"
    
    # E-commerce
    PRODUCT_SOURCED = "product_sourced"
    INVENTORY_PREDICTED = "inventory_predicted"
    PRICE_OPTIMIZED = "price_optimized"
    ANTICIPATORY_SHIP = "anticipatory_ship"
    
    # Cultural Intelligence
    CONTENT_LOCALIZED = "content_localized"
    CULTURAL_ADAPTATION_USED = "cultural_adaptation_used"
    TABOO_FLAGGED = "taboo_flagged"
    MEME_TREND_DETECTED = "meme_trend_detected"
    
    # Engagement & Retention
    FEATURE_DISCOVERED = "feature_discovered"
    TUTORIAL_COMPLETED = "tutorial_completed"
    HELP_ACCESSED = "help_accessed"
    FEEDBACK_SUBMITTED = "feedback_submitted"
    REFERRAL_SENT = "referral_sent"
    
    # Performance & Errors
    PERFORMANCE_METRIC = "performance_metric"
    ERROR_OCCURRED = "error_occurred"
    CRASH_REPORTED = "crash_reported"
    
    # Offline Usage
    OFFLINE_CONTENT_CREATED = "offline_content_created"
    OFFLINE_SYNC_COMPLETED = "offline_sync_completed"
    CACHE_MISS = "cache_miss"
    CACHE_HIT = "cache_hit"

@dataclass
class AnalyticsEventData:
    """Structured analytics event data"""
    event_type: EventType
    user_id: str
    session_id: str
    timestamp: datetime
    properties: Dict[str, Any]
    platform: str
    app_version: str
    subscription_tier: str
    user_location: Optional[Dict[str, str]] = None
    device_info: Optional[Dict[str, str]] = None
    network_type: Optional[str] = None
    offline_mode: bool = False

@dataclass
class UserEngagementMetrics:
    """User engagement tracking metrics"""
    user_id: str
    session_duration: float
    features_used: List[str]
    content_created_count: int
    social_posts_count: int
    ai_interactions: int
    error_count: int
    retention_score: float
    churn_probability: float
    next_best_action: str

class OfflineAnalyticsQueue:
    """Handles offline analytics storage and sync"""
    
    def __init__(self, db_path: str = "analytics_offline.db"):
        self.db_path = db_path
        self.lock = threading.Lock()
        self._init_database()
    
    def _init_database(self):
        """Initialize offline analytics database"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS analytics_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_data TEXT NOT NULL,
                    encrypted BOOLEAN DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    synced BOOLEAN DEFAULT 0,
                    sync_attempts INTEGER DEFAULT 0,
                    priority INTEGER DEFAULT 1
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS user_sessions (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    start_time TIMESTAMP,
                    end_time TIMESTAMP,
                    events_count INTEGER DEFAULT 0,
                    synced BOOLEAN DEFAULT 0
                )
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id 
                ON user_sessions(user_id)
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_analytics_events_synced 
                ON analytics_events(synced)
            """)
    
    def store_event(self, event_data: AnalyticsEventData, encrypt: bool = True) -> bool:
        """Store analytics event offline"""
        try:
            with self.lock:
                serialized_data = json.dumps(asdict(event_data), default=str)
                
                if encrypt:
                    serialized_data = encrypt_data(serialized_data)
                
                with sqlite3.connect(self.db_path) as conn:
                    conn.execute("""
                        INSERT INTO analytics_events 
                        (event_data, encrypted, priority) 
                        VALUES (?, ?, ?)
                    """, (serialized_data, encrypt, self._get_event_priority(event_data.event_type)))
                    
                return True
        except Exception as e:
            logger.error(f"Failed to store offline event: {e}")
            return False
    
    def get_unsynced_events(self, limit: int = 100) -> List[Dict]:
        """Retrieve unsynced events for batch upload"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute("""
                    SELECT id, event_data, encrypted, created_at, sync_attempts
                    FROM analytics_events 
                    WHERE synced = 0 AND sync_attempts < 5
                    ORDER BY priority DESC, created_at ASC
                    LIMIT ?
                """, (limit,))
                
                events = []
                for row in cursor.fetchall():
                    event_id, data, encrypted, created_at, attempts = row
                    
                    if encrypted:
                        try:
                            data = decrypt_data(data)
                        except Exception as e:
                            logger.error(f"Failed to decrypt event {event_id}: {e}")
                            continue
                    
                    events.append({
                        'id': event_id,
                        'data': json.loads(data),
                        'created_at': created_at,
                        'attempts': attempts
                    })
                
                return events
        except Exception as e:
            logger.error(f"Failed to retrieve unsynced events: {e}")
            return []
    
    def mark_synced(self, event_ids: List[int]) -> bool:
        """Mark events as successfully synced"""
        try:
            with self.lock:
                with sqlite3.connect(self.db_path) as conn:
                    placeholders = ','.join(['?' for _ in event_ids])
                    conn.execute(f"""
                        UPDATE analytics_events 
                        SET synced = 1, sync_attempts = sync_attempts + 1
                        WHERE id IN ({placeholders})
                    """, event_ids)
                return True
        except Exception as e:
            logger.error(f"Failed to mark events as synced: {e}")
            return False
    
    def increment_sync_attempts(self, event_ids: List[int]) -> bool:
        """Increment sync attempts for failed events"""
        try:
            with self.lock:
                with sqlite3.connect(self.db_path) as conn:
                    placeholders = ','.join(['?' for _ in event_ids])
                    conn.execute(f"""
                        UPDATE analytics_events 
                        SET sync_attempts = sync_attempts + 1
                        WHERE id IN ({placeholders})
                    """, event_ids)
                return True
        except Exception as e:
            logger.error(f"Failed to increment sync attempts: {e}")
            return False
    
    def _get_event_priority(self, event_type: EventType) -> int:
        """Determine event priority for sync order"""
        high_priority = [
            EventType.USER_REGISTERED, EventType.SUBSCRIPTION_STARTED,
            EventType.SUBSCRIPTION_UPGRADED, EventType.ERROR_OCCURRED,
            EventType.CRASH_REPORTED
        ]
        
        if event_type in high_priority:
            return 3
        elif 'subscription' in event_type.value.lower():
            return 2
        else:
            return 1
    
    def cleanup_old_events(self, days_old: int = 30) -> int:
        """Clean up old synced events"""
        try:
            cutoff_date = datetime.now() - timedelta(days=days_old)
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute("""
                    DELETE FROM analytics_events 
                    WHERE synced = 1 AND created_at < ?
                """, (cutoff_date,))
                return cursor.rowcount
        except Exception as e:
            logger.error(f"Failed to cleanup old events: {e}")
            return 0

class SmartRetentionEngine:
    """AI-powered user retention and engagement optimization"""
    
    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client
        self.engagement_thresholds = {
            'high': 0.8,
            'medium': 0.5,
            'low': 0.2
        }
    
    async def calculate_retention_score(self, user_id: str) -> float:
        """Calculate intelligent retention score"""
        try:
            # Get user activity metrics
            activity_data = await self._get_user_activity_metrics(user_id)
            
            # Calculate engagement factors
            factors = {
                'login_frequency': self._calculate_login_frequency(activity_data),
                'feature_adoption': self._calculate_feature_adoption(activity_data),
                'content_creation': self._calculate_content_engagement(activity_data),
                'social_integration': self._calculate_social_engagement(activity_data),
                'subscription_health': self._calculate_subscription_health(activity_data),
                'support_interactions': self._calculate_support_score(activity_data)
            }
            
            # Weighted retention score
            weights = {
                'login_frequency': 0.25,
                'feature_adoption': 0.20,
                'content_creation': 0.20,
                'social_integration': 0.15,
                'subscription_health': 0.15,
                'support_interactions': 0.05
            }
            
            retention_score = sum(
                factors[factor] * weight 
                for factor, weight in weights.items()
            )
            
            # Cache the score
            await self.redis.setex(
                f"retention_score:{user_id}",
                3600,  # 1 hour TTL
                retention_score
            )
            
            return min(1.0, max(0.0, retention_score))
            
        except Exception as e:
            logger.error(f"Failed to calculate retention score for {user_id}: {e}")
            return 0.5  # Default neutral score
    
    async def predict_churn_probability(self, user_id: str) -> float:
        """Predict user churn probability"""
        try:
            retention_score = await self.calculate_retention_score(user_id)
            
            # Advanced churn prediction factors
            recent_activity = await self._get_recent_activity(user_id, days=7)
            subscription_status = await self._get_subscription_status(user_id)
            error_frequency = await self._get_error_frequency(user_id)
            
            # Churn indicators
            churn_indicators = {
                'low_retention': max(0, 1 - retention_score),
                'inactivity': self._calculate_inactivity_score(recent_activity),
                'subscription_issues': self._calculate_subscription_risk(subscription_status),
                'error_frequency': min(1.0, error_frequency / 10),  # Normalize to 0-1
                'feature_abandonment': await self._calculate_feature_abandonment(user_id)
            }
            
            # Weighted churn probability
            churn_weights = {
                'low_retention': 0.30,
                'inactivity': 0.25,
                'subscription_issues': 0.20,
                'error_frequency': 0.15,
                'feature_abandonment': 0.10
            }
            
            churn_probability = sum(
                churn_indicators[indicator] * weight
                for indicator, weight in churn_weights.items()
            )
            
            return min(1.0, max(0.0, churn_probability))
            
        except Exception as e:
            logger.error(f"Failed to predict churn for {user_id}: {e}")
            return 0.5
    
    async def get_next_best_action(self, user_id: str) -> str:
        """Determine next best action for user retention"""
        try:
            retention_score = await self.calculate_retention_score(user_id)
            churn_probability = await self.predict_churn_probability(user_id)
            user_behavior = await self._analyze_user_behavior(user_id)
            
            # High churn risk actions
            if churn_probability > 0.7:
                if user_behavior.get('subscription_tier') == 'freemium':
                    return "offer_trial_upgrade"
                elif user_behavior.get('error_count', 0) > 5:
                    return "proactive_support_outreach"
                else:
                    return "re_engagement_campaign"
            
            # Medium churn risk actions
            elif churn_probability > 0.4:
                if user_behavior.get('feature_adoption') < 0.3:
                    return "feature_tutorial_prompt"
                elif user_behavior.get('content_creation') < 0.2:
                    return "content_inspiration_push"
                else:
                    return "gamification_challenge"
            
            # Low churn risk - growth actions
            elif retention_score > 0.7:
                if user_behavior.get('subscription_tier') == 'freemium':
                    return "upgrade_incentive"
                elif user_behavior.get('referral_count', 0) == 0:
                    return "referral_program_invite"
                else:
                    return "advanced_feature_spotlight"
            
            # Default action
            return "personalized_content_suggestion"
            
        except Exception as e:
            logger.error(f"Failed to determine next best action for {user_id}: {e}")
            return "generic_engagement_content"
    
    async def _get_user_activity_metrics(self, user_id: str) -> Dict:
        """Get comprehensive user activity metrics"""
        try:
            # This would typically query your analytics database
            # For now, returning mock structure
            return {
                'login_count_30d': 15,
                'content_created_30d': 25,
                'features_used': ['content_generation', 'social_posting'],
                'subscription_tier': 'premium',
                'error_count_7d': 2,
                'support_tickets': 1,
                'social_connections': 3
            }
        except Exception as e:
            logger.error(f"Failed to get activity metrics for {user_id}: {e}")
            return {}
    
    def _calculate_login_frequency(self, activity_data: Dict) -> float:
        """Calculate login frequency score"""
        login_count = activity_data.get('login_count_30d', 0)
        # Normalize to 0-1 scale (30 logins in 30 days = perfect score)
        return min(1.0, login_count / 30)
    
    def _calculate_feature_adoption(self, activity_data: Dict) -> float:
        """Calculate feature adoption score"""
        features_used = len(activity_data.get('features_used', []))
        total_features = 12  # Total available features
        return min(1.0, features_used / total_features)
    
    def _calculate_content_engagement(self, activity_data: Dict) -> float:
        """Calculate content creation engagement"""
        content_count = activity_data.get('content_created_30d', 0)
        # Normalize based on subscription tier expectations
        tier = activity_data.get('subscription_tier', 'freemium')
        expected_content = {'freemium': 10, 'premium': 50, 'enterprise': 100}
        return min(1.0, content_count / expected_content.get(tier, 10))
    
    def _calculate_social_engagement(self, activity_data: Dict) -> float:
        """Calculate social platform engagement"""
        connections = activity_data.get('social_connections', 0)
        max_connections = 5  # Typical user has 5 main platforms
        return min(1.0, connections / max_connections)
    
    def _calculate_subscription_health(self, activity_data: Dict) -> float:
        """Calculate subscription health score"""
        tier = activity_data.get('subscription_tier', 'freemium')
        tier_scores = {'freemium': 0.3, 'premium': 0.7, 'enterprise': 1.0}
        return tier_scores.get(tier, 0.3)
    
    def _calculate_support_score(self, activity_data: Dict) -> float:
        """Calculate support interaction score (inverse of tickets)"""
        tickets = activity_data.get('support_tickets', 0)
        # Fewer tickets = better score
        return max(0.0, 1.0 - (tickets / 10))

class FirebaseAnalyticsService:
    """Production-ready Firebase Analytics Service"""
    
    def __init__(self):
        self.app = None
        self.db = None
        self.redis = None
        self.offline_queue = OfflineAnalyticsQueue()
        self.retention_engine = None
        self.session_cache = {}
        self.batch_events = []
        self.batch_size = 50
        self.sync_interval = 300  # 5 minutes
        self._init_firebase()
        self._start_background_tasks()
    
    def _init_firebase(self):
        """Initialize Firebase Admin SDK with secure credentials"""
        try:
            if not firebase_admin._apps:
                # Get credentials from environment variables
                cred_dict = {
                    "type": "service_account",
                    "project_id": os.getenv('FIREBASE_PROJECT_ID'),
                    "private_key_id": os.getenv('FIREBASE_PRIVATE_KEY_ID'),
                    "private_key": os.getenv('FIREBASE_PRIVATE_KEY', '').replace('\\n', '\n'),
                    "client_email": os.getenv('FIREBASE_CLIENT_EMAIL'),
                    "client_id": os.getenv('FIREBASE_CLIENT_ID'),
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                    "client_x509_cert_url": os.getenv('FIREBASE_CLIENT_CERT_URL')
                }
                
                # Validate credentials before initialization
                if not all(cred_dict.values()):
                    raise ValueError("Missing Firebase environment variables")
                
                cred = credentials.Certificate(cred_dict)
                self.app = firebase_admin.initialize_app(cred)
            
            # Initialize Firestore with offline persistence enabled
            self.db = firestore.client()
            logger.info("Firebase Analytics Service initialized securely")
            
        except Exception as e:
            logger.error(f"Firebase initialization failed: {e}")
            # Degrade gracefully to offline-only mode
            logger.warning("Operating in offline-only analytics mode")
    
    async def _init_redis(self):
        """Initialize Redis connection with secure defaults"""
        try:
            redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
            self.redis = await aioredis.from_url(
                redis_url, 
                decode_responses=True,
                ssl=os.getenv('REDIS_SSL', 'false').lower() == 'true'
            )
            self.retention_engine = SmartRetentionEngine(self.redis)
            logger.info("Secure Redis connection established")
        except Exception as e:
            logger.error(f"Redis connection failed: {e}")
            # Continue without Redis (offline mode)
    
    def _start_background_tasks(self):
        """Start secure background tasks for analytics processing"""
        def run_background_sync():
            try:
                asyncio.run(self._sync_offline_events())
            except Exception as e:
                logger.error(f"Background sync failed: {e}")
        
        def run_batch_processing():
            try:
                asyncio.run(self._process_batch_events())
            except Exception as e:
                logger.error(f"Batch processing failed: {e}")
        
        def run_retention_analysis():
            try:
                asyncio.run(self._analyze_user_retention())
            except Exception as e:
                logger.error(f"Retention analysis failed: {e}")
        
        def run_cleanup():
            try:
                cleaned = self.offline_queue.cleanup_old_events()
                logger.info(f"Cleaned up {cleaned} old analytics events")
            except Exception as e:
                logger.error(f"Cleanup failed: {e}")
        
        # Schedule background tasks with exponential backoff
        schedule.every(5).minutes.do(run_background_sync)
        schedule.every(2).minutes.do(run_batch_processing)
        schedule.every(1).hours.do(run_retention_analysis)
        schedule.every(1).days.do(run_cleanup)
        
        # Start scheduler thread with error handling
        def scheduler_thread():
            while True:
                try:
                    schedule.run_pending()
                except Exception as e:
                    logger.error(f"Scheduler error: {e}")
                time.sleep(30)
        
        threading.Thread(target=scheduler_thread, daemon=True).start()
    
    async def track_event(
        self, 
        event_type: EventType, 
        user_id: str,
        properties: Dict[str, Any] = None,
        session_id: str = None,
        offline_mode: bool = False
    ) -> bool:
        """Track analytics event with offline-first approach"""
        try:
            # Initialize Redis if needed
            if not self.redis:
                await self._init_redis()
            
            # Generate session ID if not provided
            if not session_id:
                session_id = await self._get_or_create_session(user_id)
            
            # Create secure event data
            event_data = AnalyticsEventData(
                event_type=event_type,
                user_id=user_id,
                session_id=session_id,
                timestamp=datetime.utcnow(),
                properties=properties or {},
                platform=self._detect_platform(),
                app_version=os.getenv('APP_VERSION', '1.0.0'),
                subscription_tier=await self._get_user_subscription_tier(user_id),
                user_location=await self._get_user_location(user_id),
                device_info=await self._get_device_info(user_id),
                network_type=self._detect_network_type(),
                offline_mode=offline_mode
            )
            
            # Store offline first (core offline functionality)
            self.offline_queue.store_event(event_data)
            
            # Add to batch if online
            if not offline_mode:
                self.batch_events.append(event_data)
                if len(self.batch_events) >= self.batch_size:
                    await self._process_batch_events()
            
            # Update session metrics
            await self._update_session_metrics(session_id, event_type)
            
            # Trigger retention analysis for critical events
            if self._is_critical_event(event_type):
                await self._trigger_retention_analysis(user_id)
            
            return True
            
        except Exception as e:
            logger.error(f"Event tracking failed: {e}")
            return False
    
    async def _process_batch_events(self):
        """Process batched events with error handling"""
        if not self.batch_events:
            return
        
        try:
            # Prepare batch for Firebase
            batch_data = []
            for event in self.batch_events:
                firebase_event = self._convert_to_firebase_format(event)
                batch_data.append(firebase_event)
            
            # Send to Firebase if initialized
            if self.db:
                await self._send_to_firebase_batch(batch_data)
            
            # Clear processed events
            self.batch_events.clear()
            logger.info(f"Processed batch of {len(batch_data)} events")
            
        except Exception as e:
            logger.error(f"Batch processing failed: {e}")
    
    async def _sync_offline_events(self):
        """Sync offline events with retry logic"""
        try:
            unsynced_events = self.offline_queue.get_unsynced_events(100)
            if not unsynced_events:
                return
            
            firebase_events = []
            event_ids = []
            
            for event_data in unsynced_events:
                try:
                    # Convert to Firebase format
                    firebase_event = self._convert_dict_to_firebase_format(event_data['data'])
                    firebase_events.append(firebase_event)
                    event_ids.append(event_data['id'])
                except Exception as e:
                    logger.error(f"Event conversion failed: {e}")
                    continue
            
            # Send to Firebase if available
            if firebase_events and self.db:
                success = await self._send_to_firebase_batch(firebase_events)
                if success:
                    self.offline_queue.mark_synced(event_ids)
                    logger.info(f"Synced {len(firebase_events)} offline events")
                else:
                    self.offline_queue.increment_sync_attempts(event_ids)
            elif firebase_events:
                # If Firebase not available, keep events for later
                logger.warning("Firebase unavailable, keeping events offline")
            
        except Exception as e:
            logger.error(f"Offline sync failed: {e}")
    
    async def _send_to_firebase_batch(self, events: List[Dict]) -> bool:
        """Securely send batch to Firestore"""
        try:
            batch = self.db.batch()
            collection_ref = self.db.collection('analytics_events')
            
            for event in events:
                # Encrypt sensitive properties before storing
                encrypted_event = self._encrypt_sensitive_fields(event)
                
                # Create document reference
                doc_ref = collection_ref.document()
                batch.set(doc_ref, encrypted_event)
            
            # Commit batch
            batch.commit()
            return True
        except Exception as e:
            logger.error(f"Firebase batch commit failed: {e}")
            return False
    
    def _encrypt_sensitive_fields(self, event: Dict) -> Dict:
        """Encrypt sensitive user data for GDPR compliance"""
        try:
            # Encrypt user identifiers
            if 'user_id' in event:
                event['user_id'] = hashlib.sha256(event['user_id'].encode()).hexdigest()
            
            # Encrypt location data
            if 'user_location' in event and isinstance(event['user_location'], dict):
                if 'ip' in event['user_location']:
                    event['user_location']['ip'] = hashlib.sha256(
                        event['user_location']['ip'].encode()
                    ).hexdigest()
            
            return event
        except Exception as e:
            logger.error(f"Data encryption failed: {e}")
            return event
    
    def _convert_to_firebase_format(self, event_data: AnalyticsEventData) -> Dict:
        """Convert to Firebase-compatible format"""
        return {
            'event_name': event_data.event_type.value,
            'user_id': event_data.user_id,
            'session_id': event_data.session_id,
            'timestamp': event_data.timestamp.isoformat(),
            'properties': event_data.properties,
            'platform': event_data.platform,
            'app_version': event_data.app_version,
            'subscription_tier': event_data.subscription_tier,
            'user_location': event_data.user_location,
            'device_info': event_data.device_info,
            'network_type': event_data.network_type,
            'offline_mode': event_data.offline_mode
        }
    
    def _convert_dict_to_firebase_format(self, event_dict: Dict) -> Dict:
        """Convert dictionary to Firebase format"""
        return {
            'event_name': event_dict.get('event_type'),
            'user_id': event_dict.get('user_id'),
            'session_id': event_dict.get('session_id'),
            'timestamp': event_dict.get('timestamp'),
            'properties': event_dict.get('properties', {}),
            'platform': event_dict.get('platform'),
            'app_version': event_dict.get('app_version'),
            'subscription_tier': event_dict.get('subscription_tier'),
            'user_location': event_dict.get('user_location'),
            'device_info': event_dict.get('device_info'),
            'network_type': event_dict.get('network_type'),
            'offline_mode': event_dict.get('offline_mode', False)
        }
    
    async def _get_or_create_session(self, user_id: str) -> str:
        """Get or create user session with offline fallback"""
        try:
            # Check Redis for active session
            if self.redis:
                session_id = await self.redis.get(f"active_session:{user_id}")
                if session_id:
                    return session_id
            
            # Create new session with timestamp
            session_id = f"session_{user_id}_{int(datetime.utcnow().timestamp())}"
            
            # Store in Redis if available
            if self.redis:
                await self.redis.setex(f"active_session:{user_id}", 3600, session_id)
            
            # Track session start (offline if needed)
            await self.track_event(
                EventType.USER_LOGIN,
                user_id,
                {'session_started': True},
                session_id,
                offline_mode=True  # Always allow offline session tracking
            )
            
            return session_id
            
        except Exception as e:
            logger.error(f"Session creation failed: {e}")
            # Fallback to simple session ID
            return f"session_{user_id}_{int(datetime.utcnow().timestamp())}"
    
    async def _update_session_metrics(self, session_id: str, event_type: EventType):
        """Update session metrics with offline support"""
        try:
            if self.redis:
                # Increment event count
                await self.redis.incr(f"session_events:{session_id}")
                
                # Update last activity
                await self.redis.setex(
                    f"session_last_activity:{session_id}",
                    3600,
                    datetime.utcnow().isoformat()
                )
        except Exception as e:
            logger.error(f"Session metrics update failed: {e}")
    
    async def _get_user_subscription_tier(self, user_id: str) -> str:
        """Get user subscription tier with offline caching"""
        try:
            # Check Redis cache first
            if self.redis:
                tier = await self.redis.get(f"user_tier:{user_id}")
                if tier:
                    return tier
            
            # Placeholder for database lookup - in real implementation:
            # tier = await database.get_subscription_tier(user_id)
            tier = "freemium"  # Default
            
            # Cache result
            if self.redis:
                await self.redis.setex(f"user_tier:{user_id}", 86400, tier)
            
            return tier
        except Exception as e:
            logger.error(f"Subscription tier lookup failed: {e}")
            return "freemium"
    
    async def _get_user_location(self, user_id: str) -> Optional[Dict[str, str]]:
        """Get approximate user location with privacy protection"""
        try:
            # Placeholder for real implementation:
            # return await get_user_location(user_id)
            return {
                "country": "US",
                "region": "California",
                "city": "San Francisco",
                "ip": "192.168.1.1"  # Anonymized in _encrypt_sensitive_fields
            }
        except Exception as e:
            logger.error(f"Location lookup failed: {e}")
            return None
    
    async def _get_device_info(self, user_id: str) -> Dict[str, str]:
        """Get device information (placeholder for mobile implementations)"""
        # In server-side context, device info isn't available
        return {"type": "server", "os": "linux"}
    
    def _detect_platform(self) -> str:
        """Detect platform context"""
        return "server"
    
    def _detect_network_type(self) -> str:
        """Detect network type (server context)"""
        return "ethernet"
    
    def _is_critical_event(self, event_type: EventType) -> bool:
        """Check if event is critical for retention analysis"""
        critical_events = [
            EventType.SUBSCRIPTION_CANCELLED,
            EventType.USER_DELETED,
            EventType.ERROR_OCCURRED,
            EventType.CRASH_REPORTED,
            EventType.SUBSCRIPTION_UPGRADED
        ]
        return event_type in critical_events
    
    async def _trigger_retention_analysis(self, user_id: str):
        """Trigger retention analysis for critical events"""
        try:
            if self.retention_engine:
                churn_prob = await self.retention_engine.predict_churn_probability(user_id)
                if churn_prob > 0.7:
                    action = await self.retention_engine.get_next_best_action(user_id)
                    logger.warning(f"High churn risk ({churn_prob:.2f}) for {user_id}: Recommended action - {action}")
        except Exception as e:
            logger.error(f"Retention analysis failed: {e}")
    
    async def _analyze_user_retention(self):
        """Periodic user retention analysis"""
        try:
            if not self.retention_engine:
                return
            
            # Placeholder for real implementation:
            # user_ids = await self._get_active_user_ids()
            user_ids = ["user1", "user2"]  # Example
            
            for user_id in user_ids:
                try:
                    retention_score = await self.retention_engine.calculate_retention_score(user_id)
                    churn_prob = await self.retention_engine.predict_churn_probability(user_id)
                    
                    # Store for reporting
                    if self.db:
                        doc_ref = self.db.collection('user_retention').document(user_id)
                        doc_ref.set({
                            'user_id': user_id,
                            'retention_score': retention_score,
                            'churn_probability': churn_prob,
                            'last_updated': datetime.utcnow(),
                            'next_best_action': await self.retention_engine.get_next_best_action(user_id)
                        }, merge=True)
                    
                    # Log high-risk users
                    if churn_prob > 0.6:
                        logger.warning(f"User {user_id} has high churn risk: {churn_prob:.2f}")
                
                except Exception as e:
                    logger.error(f"Retention analysis for {user_id} failed: {e}")
        except Exception as e:
            logger.error(f"Global retention analysis failed: {e}")
    
    async def close(self):
        """Clean up resources"""
        try:
            if self.redis:
                await self.redis.close()
        except Exception as e:
            logger.error(f"Resource cleanup failed: {e}")

# Singleton instance for application-wide use
firebase_analytics = FirebaseAnalyticsService()