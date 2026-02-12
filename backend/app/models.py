from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
import uuid
import json
from enum import Enum
from decimal import Decimal

from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, Text, JSON, 
    ForeignKey, Enum as SQLEnum, Index, UniqueConstraint, CheckConstraint,
    DECIMAL, LargeBinary, event
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, validates
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from werkzeug.security import generate_password_hash, check_password_hash
import secrets
from cryptography.fernet import Fernet
import base64

Base = declarative_base()

# Enums for better type safety
class SubscriptionTier(str, Enum):
    FREEMIUM = "freemium"
    PREMIUM = "premium"
    ENTERPRISE = "enterprise"

class PlatformType(str, Enum):
    TIKTOK = "tiktok"
    INSTAGRAM = "instagram"
    TWITTER = "twitter"
    FACEBOOK = "facebook"
    LINKEDIN = "linkedin"
    YOUTUBE = "youtube"
    AMAZON_LIVE = "amazon_live"
    PINTEREST = "pinterest"
    SNAPCHAT = "snapchat"
    TWITCH = "twitch"

class ContentStatus(str, Enum):
    DRAFT = "draft"
    SCHEDULED = "scheduled"
    PUBLISHED = "published"
    FAILED = "failed"
    ARCHIVED = "archived"

class AIInfluencerStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    TRAINING = "training"
    SUSPENDED = "suspended"

class PaymentStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    REFUNDED = "refunded"
    CANCELLED = "cancelled"

class CulturalRegion(str, Enum):
    NORTH_AMERICA = "north_america"
    EUROPE = "europe"
    ASIA_PACIFIC = "asia_pacific"
    LATIN_AMERICA = "latin_america"
    MIDDLE_EAST = "middle_east"
    AFRICA = "africa"

# Encryption utility for sensitive data
class DataEncryption:
    @staticmethod
    def generate_key():
        return Fernet.generate_key()
    
    @staticmethod
    def encrypt_data(data: str, key: bytes) -> str:
        f = Fernet(key)
        encrypted = f.encrypt(data.encode())
        return base64.urlsafe_b64encode(encrypted).decode()
    
    @staticmethod
    def decrypt_data(encrypted_data: str, key: bytes) -> str:
        f = Fernet(key)
        decoded = base64.urlsafe_b64decode(encrypted_data.encode())
        return f.decrypt(decoded).decode()

class User(Base):
    __tablename__ = "users"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    email_verified = Column(Boolean, default=False, nullable=False)
    password_hash = Column(String(255), nullable=False)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    
    # Authentication & Security
    phone_number = Column(String(20), nullable=True)
    phone_verified = Column(Boolean, default=False, nullable=False)
    two_factor_enabled = Column(Boolean, default=False, nullable=False)
    two_factor_secret = Column(String(32), nullable=True)
    api_key = Column(String(64), unique=True, index=True)
    refresh_token = Column(String(255), nullable=True)
    last_login = Column(DateTime(timezone=True), nullable=True)
    login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    
    # Profile & Preferences
    profile_image_url = Column(String(500), nullable=True)
    bio = Column(Text, nullable=True)
    timezone = Column(String(50), default="UTC", nullable=False)
    language = Column(String(10), default="en", nullable=False)
    currency = Column(String(3), default="USD", nullable=False)
    cultural_region = Column(SQLEnum(CulturalRegion), default=CulturalRegion.NORTH_AMERICA)
    
    # Business Info
    business_name = Column(String(200), nullable=True)
    business_type = Column(String(100), nullable=True)
    website_url = Column(String(500), nullable=True)
    
    # Subscription & Billing
    subscription_tier = Column(SQLEnum(SubscriptionTier), default=SubscriptionTier.FREEMIUM, nullable=False)
    subscription_expires_at = Column(DateTime(timezone=True), nullable=True)
    trial_ends_at = Column(DateTime(timezone=True), nullable=True)
    billing_customer_id = Column(String(100), nullable=True)  # Stripe/Paddle customer ID
    
    # Usage & Limits
    content_generated_count = Column(Integer, default=0, nullable=False)
    posts_published_count = Column(Integer, default=0, nullable=False)
    ai_influencers_count = Column(Integer, default=0, nullable=False)
    storage_used_mb = Column(Float, default=0.0, nullable=False)
    
    # Offline Capabilities
    offline_content_cache = Column(JSONB, default=dict)  # Cached content for offline use
    last_sync_at = Column(DateTime(timezone=True), default=func.now())
    sync_token = Column(String(100), nullable=True)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    is_active = Column(Boolean, default=True, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    subscriptions = relationship("Subscription", back_populates="user", cascade="all, delete-orphan")
    content_items = relationship("ContentItem", back_populates="user", cascade="all, delete-orphan")
    ai_influencers = relationship("AIInfluencer", back_populates="user", cascade="all, delete-orphan")
    social_accounts = relationship("SocialAccount", back_populates="user", cascade="all, delete-orphan")
    analytics = relationship("UserAnalytics", back_populates="user", cascade="all, delete-orphan")
    payment_methods = relationship("PaymentMethod", back_populates="user", cascade="all, delete-orphan")
    cultural_preferences = relationship("CulturalPreference", back_populates="user", cascade="all, delete-orphan")
    offline_data = relationship("OfflineData", back_populates="user", cascade="all, delete-orphan")
    
    # Indexes
    __table_args__ = (
        Index('idx_user_email_active', 'email', 'is_active'),
        Index('idx_user_subscription_tier', 'subscription_tier'),
        Index('idx_user_created_at', 'created_at'),
        Index('idx_user_last_login', 'last_login'),
        CheckConstraint('login_attempts >= 0', name='check_login_attempts_positive'),
        CheckConstraint('storage_used_mb >= 0', name='check_storage_positive'),
    )
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not self.api_key:
            self.api_key = self.generate_api_key()
    
    def set_password(self, password: str):
        """Hash and set password with salt"""
        self.password_hash = generate_password_hash(password, method='pbkdf2:sha256', salt_length=16)
    
    def check_password(self, password: str) -> bool:
        """Verify password against hash"""
        return check_password_hash(self.password_hash, password)
    
    def generate_api_key(self) -> str:
        """Generate secure API key"""
        return secrets.token_urlsafe(32)
    
    def is_premium_user(self) -> bool:
        """Check if user has premium access"""
        return self.subscription_tier in [SubscriptionTier.PREMIUM, SubscriptionTier.ENTERPRISE]
    
    def is_subscription_active(self) -> bool:
        """Check if subscription is currently active"""
        if not self.subscription_expires_at:
            return self.subscription_tier == SubscriptionTier.FREEMIUM
        return datetime.utcnow() < self.subscription_expires_at
    
    def get_usage_limits(self) -> Dict[str, int]:
        """Get usage limits based on subscription tier"""
        limits = {
            SubscriptionTier.FREEMIUM: {
                'platforms': 5,
                'ai_influencers': 1,
                'content_variations': 10,
                'storage_mb': 100,
                'monthly_posts': 50
            },
            SubscriptionTier.PREMIUM: {
                'platforms': 50,
                'ai_influencers': 3,
                'content_variations': 100,
                'storage_mb': 1000,
                'monthly_posts': 500
            },
            SubscriptionTier.ENTERPRISE: {
                'platforms': -1,  # Unlimited
                'ai_influencers': -1,
                'content_variations': -1,
                'storage_mb': 10000,
                'monthly_posts': -1
            }
        }
        return limits.get(self.subscription_tier, limits[SubscriptionTier.FREEMIUM])
    
    def can_create_ai_influencer(self) -> bool:
        """Check if user can create more AI influencers"""
        limits = self.get_usage_limits()
        max_influencers = limits['ai_influencers']
        return max_influencers == -1 or self.ai_influencers_count < max_influencers
    
    def update_offline_cache(self, cache_data: Dict[str, Any]):
        """Update offline content cache"""
        self.offline_content_cache = cache_data
        self.last_sync_at = datetime.utcnow()
    
    @validates('email')
    def validate_email(self, key, email):
        assert '@' in email and '.' in email.split('@')[1], "Invalid email format"
        return email.lower()
    
    @validates('language')
    def validate_language(self, key, language):
        supported_languages = [
            'en', 'es', 'fr', 'de', 'zh', 'ja', 'ko', 'ar', 
            'ru', 'pt', 'it', 'nl', 'tr', 'hi', 'bn'
        ]
        assert language in supported_languages, f"Unsupported language: {language}"
        return language
    
    def to_dict(self, include_sensitive=False) -> Dict[str, Any]:
        """Convert user to dictionary for API responses"""
        data = {
            'id': str(self.id),
            'email': self.email,
            'first_name': self.first_name,
            'last_name': self.last_name,
            'subscription_tier': self.subscription_tier.value,
            'is_subscription_active': self.is_subscription_active(),
            'language': self.language,
            'timezone': self.timezone,
            'cultural_region': self.cultural_region.value,
            'created_at': self.created_at.isoformat(),
            'usage_limits': self.get_usage_limits(),
            'current_usage': {
                'content_generated': self.content_generated_count,
                'posts_published': self.posts_published_count,
                'ai_influencers': self.ai_influencers_count,
                'storage_mb': self.storage_used_mb
            }
        }
        
        if include_sensitive:
            data.update({
                'api_key': self.api_key,
                'two_factor_enabled': self.two_factor_enabled,
                'email_verified': self.email_verified,
                'phone_verified': self.phone_verified
            })
        
        return data

class Subscription(Base):
    __tablename__ = "subscriptions"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # Subscription Details
    tier = Column(SQLEnum(SubscriptionTier), nullable=False)
    status = Column(String(20), default="active", nullable=False)
    starts_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    renewed_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    
    # Billing
    billing_cycle = Column(String(20), default="monthly", nullable=False)  # monthly, yearly
    price_paid = Column(DECIMAL(10, 2), nullable=False)
    currency = Column(String(3), default="USD", nullable=False)
    payment_processor = Column(String(20), nullable=False)  # stripe, paddle, appstore, playstore
    external_subscription_id = Column(String(100), nullable=True)
    
    # Trial
    is_trial = Column(Boolean, default=False, nullable=False)
    trial_ends_at = Column(DateTime(timezone=True), nullable=True)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="subscriptions")
    
    __table_args__ = (
        Index('idx_subscription_user_status', 'user_id', 'status'),
        Index('idx_subscription_expires_at', 'expires_at'),
        CheckConstraint('price_paid >= 0', name='check_price_positive'),
    )
    
    def is_active(self) -> bool:
        """Check if subscription is currently active"""
        if self.status != "active":
            return False
        if self.expires_at and datetime.utcnow() > self.expires_at:
            return False
        return True
    
    def days_until_expiry(self) -> Optional[int]:
        """Get days until subscription expires"""
        if not self.expires_at:
            return None
        delta = self.expires_at - datetime.utcnow()
        return max(0, delta.days)

class ContentItem(Base):
    __tablename__ = "content_items"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # Content Details
    title = Column(String(200), nullable=False)
    content_type = Column(String(50), nullable=False)  # post, story, video, image
    status = Column(SQLEnum(ContentStatus), default=ContentStatus.DRAFT, nullable=False)
    
    # AI Generation Data
    original_prompt = Column(Text, nullable=False)
    ai_model_used = Column(String(50), nullable=True)
    generation_parameters = Column(JSONB, default=dict)
    
    # Content Variations (Platform-specific)
    variations = Column(JSONB, default=dict)  # {platform: {caption, hashtags, media_urls}}
    
    # Scheduling
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    target_platforms = Column(JSONB, default=list)  # List of platform names
    
    # Media
    media_urls = Column(JSONB, default=list)  # List of media file URLs
    media_metadata = Column(JSONB, default=dict)  # File sizes, dimensions, etc.
    
    # Performance & Analytics
    engagement_score = Column(Float, default=0.0)
    reach_count = Column(Integer, default=0)
    like_count = Column(Integer, default=0)
    share_count = Column(Integer, default=0)
    comment_count = Column(Integer, default=0)
    
    # Cultural Adaptation
    cultural_adaptations = Column(JSONB, default=dict)  # {region: adapted_content}
    sensitive_content_flags = Column(JSONB, default=list)
    
    # Offline Support
    is_cached_offline = Column(Boolean, default=False)
    offline_media_paths = Column(JSONB, default=list)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="content_items")
    posts = relationship("SocialPost", back_populates="content_item", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index('idx_content_user_status', 'user_id', 'status'),
        Index('idx_content_scheduled_at', 'scheduled_at'),
        Index('idx_content_created_at', 'created_at'),
        CheckConstraint('engagement_score >= 0', name='check_engagement_positive'),
    )
    
    def get_variation_for_platform(self, platform: str) -> Optional[Dict[str, Any]]:
        """Get content variation for specific platform"""
        return self.variations.get(platform)
    
    def add_variation(self, platform: str, variation_data: Dict[str, Any]):
        """Add platform-specific content variation"""
        if not self.variations:
            self.variations = {}
        self.variations[platform] = variation_data
    
    def is_ready_for_publishing(self) -> bool:
        """Check if content is ready to be published"""
        return (
            self.status == ContentStatus.SCHEDULED and
            self.scheduled_at and
            datetime.utcnow() >= self.scheduled_at and
            len(self.target_platforms) > 0
        )
    
    def calculate_engagement_rate(self) -> float:
        """Calculate engagement rate percentage"""
        if self.reach_count == 0:
            return 0.0
        total_engagement = self.like_count + self.share_count + self.comment_count
        return (total_engagement / self.reach_count) * 100

class AIInfluencer(Base):
    __tablename__ = "ai_influencers"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # Basic Info
    name = Column(String(100), nullable=False)
    stage_name = Column(String(100), nullable=True)
    bio = Column(Text, nullable=True)
    status = Column(SQLEnum(AIInfluencerStatus), default=AIInfluencerStatus.TRAINING, nullable=False)
    
    # Visual Characteristics
    appearance_data = Column(JSONB, default=dict)  # Gender, age, ethnicity, style preferences
    avatar_url = Column(String(500), nullable=True)
    video_samples = Column(JSONB, default=list)  # List of generated video URLs
    
    # Voice & Personality
    voice_model_id = Column(String(100), nullable=True)
    personality_traits = Column(JSONB, default=dict)  # Personality parameters
    communication_style = Column(String(50), default="casual")  # casual, professional, humorous
    
    # Audience & Targeting
    target_demographics = Column(JSONB, default=dict)  # Age, location, interests
    niche_categories = Column(JSONB, default=list)  # Fashion, tech, lifestyle, etc.
    audience_alignment_score = Column(Float, default=0.0)
    
    # Performance Metrics
    follower_count = Column(Integer, default=0)
    engagement_rate = Column(Float, default=0.0)
    content_posted_count = Column(Integer, default=0)
    revenue_generated = Column(DECIMAL(10, 2), default=0.0)
    
    # Cultural Intelligence
    cultural_context = Column(JSONB, default=dict)  # Cultural adaptation data
    language_capabilities = Column(JSONB, default=list)  # Supported languages
    taboo_awareness = Column(JSONB, default=dict)  # Regional taboos and sensitivities
    
    # AI Training Data
    training_data_sources = Column(JSONB, default=list)
    model_version = Column(String(20), nullable=True)
    last_training_at = Column(DateTime(timezone=True), nullable=True)
    
    # Compliance & Ethics
    disclosure_requirements = Column(JSONB, default=dict)  # FTC, regional compliance
    ethical_guidelines = Column(JSONB, default=dict)
    controversy_score = Column(Float, default=0.0)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="ai_influencers")
    content_generated = relationship("ContentItem", secondary="ai_influencer_content", viewonly=True)
    
    __table_args__ = (
        Index('idx_ai_influencer_user_status', 'user_id', 'status'),
        Index('idx_ai_influencer_niche', 'niche_categories'),
        CheckConstraint('audience_alignment_score >= 0 AND audience_alignment_score <= 100', 
                       name='check_alignment_score_range'),
        CheckConstraint('engagement_rate >= 0', name='check_engagement_rate_positive'),
    )
    
    def is_ready_for_content_creation(self) -> bool:
        """Check if AI influencer is ready to create content"""
        return (
            self.status == AIInfluencerStatus.ACTIVE and
            self.appearance_data and
            self.personality_traits and
            len(self.language_capabilities) > 0
        )
    
    def get_cultural_adaptation_for_region(self, region: str) -> Dict[str, Any]:
        """Get cultural adaptation data for specific region"""
        return self.cultural_context.get(region, {})
    
    def update_performance_metrics(self, followers: int, engagement: float):
        """Update performance metrics"""
        self.follower_count = followers
        self.engagement_rate = engagement
        self.updated_at = datetime.utcnow()

# Association table for AI Influencer and Content
ai_influencer_content = Table(
    'ai_influencer_content',
    Base.metadata,
    Column('ai_influencer_id', UUID(as_uuid=True), ForeignKey('ai_influencers.id', ondelete="CASCADE")),
    Column('content_item_id', UUID(as_uuid=True), ForeignKey('content_items.id', ondelete="CASCADE")),
    Column('created_at', DateTime(timezone=True), server_default=func.now())
)

class SocialAccount(Base):
    __tablename__ = "social_accounts"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # Platform Details
    platform = Column(SQLEnum(PlatformType), nullable=False)
    platform_user_id = Column(String(100), nullable=False)
    username = Column(String(100), nullable=False)
    display_name = Column(String(200), nullable=True)
    
    # Authentication (Encrypted)
    access_token = Column(Text, nullable=False)  # Encrypted
    refresh_token = Column(Text, nullable=True)  # Encrypted
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    encryption_key = Column(LargeBinary, nullable=False)
    
    # Account Status
    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    connection_status = Column(String(20), default="connected", nullable=False)
    last_successful_post = Column(DateTime(timezone=True), nullable=True)
    
    # Account Metadata
    follower_count = Column(Integer, default=0)
    following_count = Column(Integer, default=0)
    posts_count = Column(Integer, default=0)
    profile_image_url = Column(String(500), nullable=True)
    
    # API Limits & Usage
    api_calls_today = Column(Integer, default=0)
    api_limit_reset_at = Column(DateTime(timezone=True), nullable=True)
    rate_limit_remaining = Column(Integer, default=0)
    
    # Metadata
    connected_at = Column(DateTime(timezone=True), server_default=func.now())
    last_sync_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="social_accounts")
    posts = relationship("SocialPost", back_populates="social_account", cascade="all, delete-orphan")
    
    __table_args__ = (
        UniqueConstraint('user_id', 'platform', 'platform_user_id', name='uq_user_platform_account'),
        Index('idx_social_account_user_platform', 'user_id', 'platform'),
        Index('idx_social_account_status', 'connection_status'),
    )
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not self.encryption_key:
            self.encryption_key = DataEncryption.generate_key()
    
    def set_access_token(self, token: str):
        """Encrypt and store access token"""
        self.access_token = DataEncryption.encrypt_data(token, self.encryption_key)
    
    def get_access_token(self) -> str:
        """Decrypt and return access token"""
        return DataEncryption.decrypt_data(self.access_token, self.encryption_key)
    
    def set_refresh_token(self, token: str):
        """Encrypt and store refresh token"""
        if token:
            self.refresh_token = DataEncryption.encrypt_data(token, self.encryption_key)
    
    def get_refresh_token(self) -> Optional[str]:
        """Decrypt and return refresh token"""
        if self.refresh_token:
            return DataEncryption.decrypt_data(self.refresh_token, self.encryption_key)
        return None
    
    def is_token_expired(self) -> bool:
        """Check if access token is expired"""
        if not self.token_expires_at:
            return False
        return datetime.utcnow() > self.token_expires_at
    
    def can_make_api_call(self) -> bool:
        """Check if account can make API calls within rate limits"""
        return (
            self.is_active and
            self.connection_status == "connected" and
            self.rate_limit_remaining > 0
        )
    
    def update_api_usage(self):
        """Update API usage counters"""
        self.api_calls_today += 1
        self.rate_limit_remaining = max(0, self.rate_limit_remaining - 1)
        self.last_sync_at = datetime.utcnow()

class SocialPost(Base):
    __tablename__ = "social_posts"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    content_item_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False)
    social_account_id = Column(UUID(as_uuid=True), ForeignKey("social_accounts.id", ondelete="CASCADE"), nullable=False)
    
    # Post Details
    platform_post_id = Column(String(100), nullable=True)  # Platform's post ID
    post_content = Column(Text, nullable=False)
    media_urls = Column(JSONB, default=list)
    hashtags = Column(JSONB, default=list)
    
    # Scheduling & Status
    status = Column(String(20), default="scheduled", nullable=False)  # scheduled, published, failed
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    failed_at = Column(DateTime(timezone=True), nullable=True)
    failure_reason = Column(Text, nullable=True)
    
    # Performance Metrics
    likes_count = Column(Integer, default=0)
    shares_count = Column(Integer, default=0)
    comments_count = Column(Integer, default=0)
    views_count = Column(Integer, default=0)
    reach_count = Column(Integer, default=0)
    clicks_count = Column(Integer, default=0)
    
    # Engagement Tracking
    last_metrics_update = Column(DateTime(timezone=True), nullable=True)
    engagement_rate = Column(Float, default=0.0)
    performance_score = Column(Float, default=0.0)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User")
    content_item = relationship("ContentItem", back_populates="posts")
    social_account = relationship("SocialAccount", back_populates="posts")
    
    __table_args__ = (
        Index('idx_social_post_user_status', 'user_id', 'status'),
        Index('idx_social_post_scheduled_at', 'scheduled_at'),
        Index('idx_social_post_platform_id', 'platform_post_id'),
        CheckConstraint('engagement_rate >= 0', name='check_post_engagement_positive'),
    )
    
    def calculate_engagement_rate(self) -> float:
        """Calculate engagement rate as percentage of engagement vs reach"""
        if self.reach_count == 0:
            return 0.0
        total_engagement = self.likes_count + self.comments_count + self.shares_count
        return (total_engagement / self.reach_count) * 100

    def update_performance_metrics(self):
        """Update performance metrics based on latest data"""
        self.engagement_rate = self.calculate_engagement_rate()
        # Simple performance score calculation (customizable)
        self.performance_score = (
            self.engagement_rate * 0.6 +
            (self.clicks_count / max(1, self.reach_count)) * 0.4
        )
        self.last_metrics_update = datetime.utcnow()

class UserAnalytics(Base):
    __tablename__ = "user_analytics"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # Engagement Metrics
    daily_active_minutes = Column(Integer, default=0, nullable=False)
    weekly_active_days = Column(Integer, default=0, nullable=False)
    monthly_session_count = Column(Integer, default=0, nullable=False)
    
    # Feature Usage
    ai_content_uses = Column(Integer, default=0, nullable=False)
    bulk_post_uses = Column(Integer, default=0, nullable=False)
    cultural_adapt_uses = Column(Integer, default=0, nullable=False)
    voice_command_uses = Column(Integer, default=0, nullable=False)
    
    # Performance Metrics
    avg_post_engagement = Column(Float, default=0.0, nullable=False)
    ai_influencer_performance = Column(JSONB, default=dict)
    content_conversion_rate = Column(Float, default=0.0)
    
    # Retention Metrics
    last_active_date = Column(DateTime(timezone=True), default=func.now())
    streak_days = Column(Integer, default=0, nullable=False)
    feature_adoption_rate = Column(Float, default=0.0)
    
    # Revenue Metrics
    avg_revenue_per_user = Column(DECIMAL(10, 2), default=0.0)
    lifetime_value = Column(DECIMAL(10, 2), default=0.0)
    upgrade_conversion_rate = Column(Float, default=0.0)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="analytics")
    
    __table_args__ = (
        Index('idx_user_analytics_user', 'user_id'),
        CheckConstraint('daily_active_minutes >= 0', name='check_daily_minutes_positive'),
        CheckConstraint('content_conversion_rate >= 0 AND content_conversion_rate <= 100', 
                       name='check_conversion_rate_range'),
    )
    
    def update_engagement(self, session_minutes: int):
        """Update user engagement metrics"""
        self.daily_active_minutes += session_minutes
        self.monthly_session_count += 1
        self.last_active_date = datetime.utcnow()
        
        # Update streak logic
        if self.last_active_date.date() == (datetime.utcnow() - timedelta(days=1)).date():
            self.streak_days += 1
        elif self.last_active_date.date() < (datetime.utcnow() - timedelta(days=1)).date():
            self.streak_days = 1

class PaymentMethod(Base):
    __tablename__ = "payment_methods"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # Payment Details
    processor = Column(String(20), nullable=False)  # stripe, paddle, apple, google
    method_type = Column(String(20), nullable=False)  # card, paypal, apple_pay, google_pay
    is_default = Column(Boolean, default=False, nullable=False)
    
    # Encrypted Payment Data
    token = Column(Text, nullable=False)  # Payment processor token
    last_four = Column(String(4), nullable=True)
    expiry_month = Column(Integer, nullable=True)
    expiry_year = Column(Integer, nullable=True)
    encryption_key = Column(LargeBinary, nullable=False)
    
    # Verification
    is_verified = Column(Boolean, default=False, nullable=False)
    verification_attempts = Column(Integer, default=0, nullable=False)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    is_active = Column(Boolean, default=True, nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="payment_methods")
    
    __table_args__ = (
        Index('idx_payment_method_user', 'user_id'),
        CheckConstraint('verification_attempts >= 0', name='check_verification_attempts'),
        CheckConstraint('expiry_month >= 1 AND expiry_month <= 12', name='check_expiry_month'),
    )
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not self.encryption_key:
            self.encryption_key = DataEncryption.generate_key()
    
    def set_token(self, token: str):
        """Encrypt and store payment token"""
        self.token = DataEncryption.encrypt_data(token, self.encryption_key)
    
    def get_token(self) -> str:
        """Decrypt and return payment token"""
        return DataEncryption.decrypt_data(self.token, self.encryption_key)
    
    def mask_card_number(self) -> str:
        """Return masked card number for display"""
        if self.last_four:
            return f"**** **** **** {self.last_four}"
        return "Card not available"
    
    def is_expired(self) -> bool:
        """Check if payment method is expired"""
        if not self.expiry_month or not self.expiry_year:
            return False
        current_year = datetime.utcnow().year
        current_month = datetime.utcnow().month
        return (current_year > self.expiry_year) or \
               (current_year == self.expiry_year and current_month > self.expiry_month)

class CulturalPreference(Base):
    __tablename__ = "cultural_preferences"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    region = Column(SQLEnum(CulturalRegion), nullable=False)
    
    # Content Preferences
    humor_style = Column(String(50), default="universal")  # sarcastic, slapstick, dark
    formality_level = Column(String(20), default="neutral")  # casual, formal
    color_preferences = Column(JSONB, default=list)
    symbol_sensitivities = Column(JSONB, default=dict)
    
    # Cultural Norms
    greeting_style = Column(String(50), default="universal")
    date_format = Column(String(20), default="YYYY-MM-DD")
    time_format = Column(String(10), default="24h")
    measurement_system = Column(String(10), default="metric")
    
    # Taboo Avoidance
    avoided_topics = Column(JSONB, default=list)
    sensitive_gestures = Column(JSONB, default=list)
    restricted_symbols = Column(JSONB, default=list)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="cultural_preferences")
    
    __table_args__ = (
        UniqueConstraint('user_id', 'region', name='uq_user_region_preference'),
        Index('idx_cultural_preference_region', 'region'),
    )
    
    def get_localization_settings(self) -> Dict[str, Any]:
        """Get localization settings for content generation"""
        return {
            "date_format": self.date_format,
            "time_format": self.time_format,
            "measurement_system": self.measurement_system,
            "greeting_style": self.greeting_style
        }
    
    def is_topic_sensitive(self, topic: str) -> bool:
        """Check if topic is sensitive in this region"""
        return topic.lower() in [t.lower() for t in self.avoided_topics]

class OfflineData(Base):
    __tablename__ = "offline_data"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # Content Data
    cached_content = Column(JSONB, default=dict)  # {content_id: {title, content, media_urls}}
    cached_templates = Column(JSONB, default=list)  # List of template data
    
    # AI Models
    ai_model_snapshots = Column(JSONB, default=dict)  # Lightweight model versions
    
    # Settings & Preferences
    user_settings = Column(JSONB, default=dict)
    cultural_preferences = Column(JSONB, default=dict)
    
    # Operations Queue
    pending_operations = Column(JSONB, default=list)  # Operations to sync when online
    
    # Storage Management
    total_size_mb = Column(Float, default=0.0, nullable=False)
    last_synced_size = Column(Float, default=0.0, nullable=False)
    
    # Metadata
    last_sync_date = Column(DateTime(timezone=True), default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="offline_data")
    
    __table_args__ = (
        Index('idx_offline_data_user', 'user_id'),
        CheckConstraint('total_size_mb >= 0', name='check_offline_size_positive'),
    )
    
    def add_pending_operation(self, operation_type: str, data: Dict[str, Any]):
        """Add operation to sync queue"""
        operation = {
            "type": operation_type,
            "data": data,
            "created_at": datetime.utcnow().isoformat(),
            "attempts": 0
        }
        self.pending_operations.append(operation)
    
    def clear_synced_operations(self):
        """Clear successfully synced operations"""
        self.pending_operations = [op for op in self.pending_operations if op.get("needs_retry", False)]
    
    def cache_content(self, content_id: str, content_data: Dict[str, Any], size_mb: float):
        """Cache content for offline access"""
        if content_id not in self.cached_content:
            self.total_size_mb += size_mb
        self.cached_content[content_id] = content_data
    
    def remove_cached_content(self, content_id: str, size_mb: float):
        """Remove cached content"""
        if content_id in self.cached_content:
            self.total_size_mb = max(0, self.total_size_mb - size_mb)
            del self.cached_content[content_id]

# Event listeners for automatic encryption
@event.listens_for(SocialAccount, 'before_insert')
@event.listens_for(SocialAccount, 'before_update')
def encrypt_social_tokens(mapper, connection, target):
    if target.access_token and not target.access_token.startswith('enc:'):
        target.set_access_token(target.access_token)
    if target.refresh_token and not target.refresh_token.startswith('enc:'):
        target.set_refresh_token(target.refresh_token)

@event.listens_for(PaymentMethod, 'before_insert')
@event.listens_for(PaymentMethod, 'before_update')
def encrypt_payment_token(mapper, connection, target):
    if target.token and not target.token.startswith('enc:'):
        target.set_token(target.token)

# Event listeners for analytics updates
@event.listens_for(ContentItem, 'after_insert')
def increment_content_count(mapper, connection, target):
    """Update user's content count when new content is created"""
    if target.user:
        target.user.content_generated_count += 1

@event.listens_for(SocialPost, 'after_update')
def update_post_metrics(mapper, connection, target):
    """Update engagement metrics when post stats change"""
    if (target.likes_count > 0 or target.comments_count > 0 or 
        target.shares_count > 0 or target.reach_count > 0):
        target.update_performance_metrics()

# Hybrid properties for calculated fields
from sqlalchemy.ext.hybrid import hybrid_property

class ContentItem(Base):
    # ... (previous fields)
    
    @hybrid_property
    def is_published(self) -> bool:
        return self.status == ContentStatus.PUBLISHED and self.published_at is not None
    
    @hybrid_property
    def needs_cultural_review(self) -> bool:
        return len(self.sensitive_content_flags) > 0 and not self.cultural_adaptations

class User(Base):
    # ... (previous fields)
    
    @hybrid_property
    def days_until_trial_end(self) -> Optional[int]:
        if not self.trial_ends_at:
            return None
        delta = self.trial_ends_at - datetime.utcnow()
        return max(0, delta.days)
    
    @hybrid_property
    def storage_usage_percent(self) -> float:
        limits = self.get_usage_limits()
        max_storage = limits['storage_mb']
        if max_storage <= 0:  # Unlimited
            return 0.0
        return min(100.0, (self.storage_used_mb / max_storage) * 100)

# Index for full-text search
from sqlalchemy import Index, text

Index('idx_content_search', 
      text("to_tsvector('english', title || ' ' || original_prompt)"),
      postgresql_using='gin')