"""
ONXLink Pydantic Schemas
Complete backend data validation and serialization models
"""

from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List, Dict, Any, Union, Literal
from enum import Enum
from pydantic import (
    BaseModel, 
    EmailStr, 
    Field, 
    validator, 
    root_validator,
    constr,
    conint,
    confloat,
    conlist,
    HttpUrl,
    UUID4
)
import uuid
import re
from urllib.parse import urlparse
from cryptography.fernet import Fernet
import os

# ============================================================================
# ENUMS & CONSTANTS
# ============================================================================

class SubscriptionTier(str, Enum):
    FREEMIUM = "freemium"
    PREMIUM = "premium"
    ENTERPRISE = "enterprise"

class UserStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    PENDING = "pending"

class ContentType(str, Enum):
    TEXT = "text"
    IMAGE = "image"
    VIDEO = "video"
    CAROUSEL = "carousel"
    STORY = "story"
    REEL = "reel"
    TIKTOK = "tiktok"

class PlatformType(str, Enum):
    INSTAGRAM = "instagram"
    TIKTOK = "tiktok"
    TWITTER = "twitter"
    FACEBOOK = "facebook"
    LINKEDIN = "linkedin"
    YOUTUBE = "youtube"
    PINTEREST = "pinterest"
    SNAPCHAT = "snapchat"
    AMAZON_LIVE = "amazon_live"
    SHOPIFY = "shopify"

class PostStatus(str, Enum):
    DRAFT = "draft"
    SCHEDULED = "scheduled"
    PUBLISHED = "published"
    FAILED = "failed"
    DELETED = "deleted"

class AIInfluencerGender(str, Enum):
    MALE = "male"
    FEMALE = "female"
    NON_BINARY = "non_binary"

class PaymentStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    REFUNDED = "refunded"
    CANCELLED = "cancelled"

class AnalyticsMetric(str, Enum):
    IMPRESSIONS = "impressions"
    REACH = "reach"
    ENGAGEMENT = "engagement"
    CLICKS = "clicks"
    CONVERSIONS = "conversions"
    REVENUE = "revenue"

class OfflineOperationStatus(str, Enum):
    PENDING = "pending"
    SYNCED = "synced"
    FAILED = "failed"

# ============================================================================
# BASE SCHEMAS
# ============================================================================

class BaseSchema(BaseModel):
    """Base schema with common configurations"""
    
    class Config:
        use_enum_values = True
        validate_assignment = True
        arbitrary_types_allowed = True
        json_encoders = {
            datetime: lambda v: v.isoformat(),
            date: lambda v: v.isoformat(),
            Decimal: lambda v: float(v),
            UUID4: lambda v: str(v)
        }

class TimestampMixin(BaseSchema):
    """Mixin for timestamp fields"""
    created_at: Optional[datetime] = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = Field(default_factory=datetime.utcnow)

# ============================================================================
# USER SCHEMAS
# ============================================================================

class UserBase(BaseSchema):
    email: EmailStr = Field(..., description="User email address")
    username: constr(min_length=3, max_length=30, regex=r'^[a-zA-Z0-9_]+$') = Field(
        ..., description="Unique username (3-30 chars, alphanumeric + underscore)"
    )
    first_name: constr(min_length=1, max_length=50) = Field(..., description="First name")
    last_name: constr(min_length=1, max_length=50) = Field(..., description="Last name")
    phone: Optional[constr(regex=r'^\+?1?\d{9,15}$')] = Field(None, description="Phone number")
    timezone: str = Field(default="UTC", description="User timezone")
    language: str = Field(default="en", description="Preferred language")
    country: Optional[str] = Field(None, description="Country code (ISO 3166-1)")
    
    @validator('language')
    def validate_language(cls, v):
        supported_languages = [
            'en', 'es', 'fr', 'de', 'zh', 'ja', 'ko', 'ar', 
            'ru', 'pt', 'it', 'nl', 'tr', 'hi', 'bn'
        ]
        if v not in supported_languages:
            raise ValueError(f'Language must be one of: {supported_languages}')
        return v

class UserCreate(UserBase):
    password: constr(min_length=8, max_length=128) = Field(
        ..., description="Password (min 8 chars)"
    )
    
    @validator('password')
    def validate_password(cls, v):
        if not re.search(r'[A-Z]', v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not re.search(r'[a-z]', v):
            raise ValueError('Password must contain at least one lowercase letter')
        if not re.search(r'\d', v):
            raise ValueError('Password must contain at least one digit')
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', v):
            raise ValueError('Password must contain at least one special character')
        return v

class UserUpdate(BaseSchema):
    first_name: Optional[constr(min_length=1, max_length=50)] = None
    last_name: Optional[constr(min_length=1, max_length=50)] = None
    phone: Optional[constr(regex=r'^\+?1?\d{9,15}$')] = None
    timezone: Optional[str] = None
    language: Optional[str] = None
    country: Optional[str] = None
    profile_image_url: Optional[HttpUrl] = None
    bio: Optional[constr(max_length=500)] = None
    
    @validator('language')
    def validate_language(cls, v):
        if v is not None:
            supported_languages = [
                'en', 'es', 'fr', 'de', 'zh', 'ja', 'ko', 'ar', 
                'ru', 'pt', 'it', 'nl', 'tr', 'hi', 'bn'
            ]
            if v not in supported_languages:
                raise ValueError(f'Language must be one of: {supported_languages}')
        return v

class UserInDB(UserBase, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    status: UserStatus = Field(default=UserStatus.ACTIVE)
    subscription_tier: SubscriptionTier = Field(default=SubscriptionTier.FREEMIUM)
    subscription_expires_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None
    login_count: int = Field(default=0)
    profile_image_url: Optional[HttpUrl] = None
    bio: Optional[str] = None
    preferences: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    offline_capabilities: Dict[str, Any] = Field(default_factory=dict)
    
class UserResponse(BaseSchema):
    id: UUID4
    email: EmailStr
    username: str
    first_name: str
    last_name: str
    status: UserStatus
    subscription_tier: SubscriptionTier
    subscription_expires_at: Optional[datetime]
    created_at: datetime
    last_login_at: Optional[datetime]
    profile_image_url: Optional[HttpUrl]
    bio: Optional[str]
    timezone: str
    language: str
    country: Optional[str]

class UserProfile(UserResponse):
    """Extended user profile with additional data"""
    login_count: int
    preferences: Dict[str, Any]
    connected_platforms: List[str] = Field(default_factory=list)
    ai_influencers_count: int = Field(default=0)
    posts_count: int = Field(default=0)
    storage_used_mb: float = Field(default=0.0)
    offline_storage_size: int = Field(default=0)
    last_sync_time: Optional[datetime] = None

# ============================================================================
# AUTHENTICATION SCHEMAS
# ============================================================================

class LoginRequest(BaseSchema):
    email: EmailStr = Field(..., description="User email")
    password: str = Field(..., description="User password")
    remember_me: bool = Field(default=False, description="Remember login")
    device_info: Optional[Dict[str, Any]] = None

class LoginResponse(BaseSchema):
    access_token: str = Field(..., description="JWT access token")
    refresh_token: str = Field(..., description="JWT refresh token")
    token_type: str = Field(default="bearer", description="Token type")
    expires_in: int = Field(..., description="Token expiration time in seconds")
    user: UserResponse = Field(..., description="User information")
    offline_sync_token: str = Field(..., description="Token for offline data sync")

class RefreshTokenRequest(BaseSchema):
    refresh_token: str = Field(..., description="Refresh token")

class PasswordResetRequest(BaseSchema):
    email: EmailStr = Field(..., description="User email")

class PasswordResetConfirm(BaseSchema):
    token: str = Field(..., description="Reset token")
    new_password: constr(min_length=8, max_length=128) = Field(..., description="New password")
    
    @validator('new_password')
    def validate_password(cls, v):
        if not re.search(r'[A-Z]', v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not re.search(r'[a-z]', v):
            raise ValueError('Password must contain at least one lowercase letter')
        if not re.search(r'\d', v):
            raise ValueError('Password must contain at least one digit')
        return v

class EmailVerificationRequest(BaseSchema):
    token: str = Field(..., description="Verification token")

class MFASetupRequest(BaseSchema):
    mfa_type: Literal["totp", "sms", "email"] = Field(..., description="MFA type")

class MFAVerifyRequest(BaseSchema):
    code: str = Field(..., min_length=6, max_length=6, description="MFA code")

# ============================================================================
# SUBSCRIPTION SCHEMAS
# ============================================================================

class SubscriptionPlan(BaseSchema):
    id: str = Field(..., description="Plan ID")
    name: str = Field(..., description="Plan name")
    tier: SubscriptionTier = Field(..., description="Subscription tier")
    price: Decimal = Field(..., description="Price in USD")
    billing_period: Literal["monthly", "yearly"] = Field(..., description="Billing period")
    features: List[str] = Field(..., description="Plan features")
    limits: Dict[str, int] = Field(..., description="Usage limits")
    is_popular: bool = Field(default=False, description="Popular plan flag")
    offline_capabilities: Dict[str, Any] = Field(default_factory=dict, description="Offline features")

class SubscriptionCreate(BaseSchema):
    plan_id: str = Field(..., description="Selected plan ID")
    payment_method_id: str = Field(..., description="Payment method ID")
    billing_address: Dict[str, str] = Field(..., description="Billing address")
    tax_id: Optional[str] = None

class SubscriptionUpdate(BaseSchema):
    plan_id: Optional[str] = None
    payment_method_id: Optional[str] = None
    auto_renew: Optional[bool] = None

class SubscriptionInDB(BaseSchema, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    plan_id: str
    tier: SubscriptionTier
    status: Literal["active", "cancelled", "expired", "pending"] = "active"
    current_period_start: datetime
    current_period_end: datetime
    auto_renew: bool = True
    price: Decimal
    currency: str = "USD"
    payment_provider: Literal["stripe", "paddle", "apple", "google"] = "stripe"
    external_subscription_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class SubscriptionResponse(BaseSchema):
    id: UUID4
    plan_id: str
    tier: SubscriptionTier
    status: str
    current_period_start: datetime
    current_period_end: datetime
    auto_renew: bool
    price: Decimal
    currency: str
    offline_storage_quota: int = Field(default=100, description="MB of offline storage")

# ============================================================================
# PAYMENT SCHEMAS
# ============================================================================

class PaymentMethod(BaseSchema):
    id: str
    type: Literal["card", "paypal", "bank_account", "apple_pay", "google_pay"]
    last_four: Optional[str] = None
    brand: Optional[str] = None
    expires_month: Optional[int] = None
    expires_year: Optional[int] = None
    is_default: bool = False

class PaymentIntent(BaseSchema):
    amount: Decimal = Field(..., gt=0, description="Payment amount")
    currency: str = Field(default="USD", description="Currency code")
    description: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class PaymentRecord(BaseSchema, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    subscription_id: Optional[UUID4] = None
    amount: Decimal
    currency: str
    status: PaymentStatus
    payment_method: str
    external_payment_id: str
    description: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

# ============================================================================
# AI INFLUENCER SCHEMAS
# ============================================================================

class AIInfluencerBase(BaseSchema):
    name: constr(min_length=1, max_length=100) = Field(..., description="Influencer name")
    gender: AIInfluencerGender = Field(..., description="Gender")
    age_range: Literal["18-25", "26-35", "36-45", "46-55", "55+"] = Field(..., description="Age range")
    ethnicity: Optional[str] = Field(None, description="Ethnicity")
    personality_traits: List[str] = Field(..., description="Personality traits")
    niche: List[str] = Field(..., description="Content niches")
    bio: constr(max_length=500) = Field(..., description="Bio description")
    voice_style: Optional[str] = Field(None, description="Voice characteristics")
    content_style: List[str] = Field(..., description="Content style preferences")
    offline_available: bool = Field(default=True, description="Available offline")

class AIInfluencerCreate(AIInfluencerBase):
    pass

class AIInfluencerUpdate(BaseSchema):
    name: Optional[constr(min_length=1, max_length=100)] = None
    personality_traits: Optional[List[str]] = None
    niche: Optional[List[str]] = None
    bio: Optional[constr(max_length=500)] = None
    voice_style: Optional[str] = None
    content_style: Optional[List[str]] = None
    is_active: Optional[bool] = None
    offline_available: Optional[bool] = None

class AIInfluencerInDB(AIInfluencerBase, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    is_active: bool = Field(default=True)
    avatar_url: Optional[HttpUrl] = None
    voice_id: Optional[str] = None
    generation_settings: Dict[str, Any] = Field(default_factory=dict)
    performance_metrics: Dict[str, float] = Field(default_factory=dict)
    total_posts: int = Field(default=0)
    total_engagement: int = Field(default=0)
    offline_data: Dict[str, Any] = Field(default_factory=dict)

class AIInfluencerResponse(BaseSchema):
    id: UUID4
    name: str
    gender: AIInfluencerGender
    age_range: str
    ethnicity: Optional[str]
    personality_traits: List[str]
    niche: List[str]
    bio: str
    is_active: bool
    avatar_url: Optional[HttpUrl]
    created_at: datetime
    total_posts: int
    total_engagement: int
    offline_available: bool

# ============================================================================
# CONTENT SCHEMAS
# ============================================================================

class ContentGenerationRequest(BaseSchema):
    prompt: constr(min_length=10, max_length=1000) = Field(..., description="Content prompt")
    content_type: ContentType = Field(..., description="Type of content")
    platforms: conlist(PlatformType, min_items=1, max_items=50) = Field(..., description="Target platforms")
    ai_influencer_id: Optional[UUID4] = Field(None, description="AI influencer to use")
    target_language: str = Field(default="en", description="Target language")
    tone: Optional[Literal["professional", "casual", "funny", "inspiring", "controversial"]] = Field(None)
    include_hashtags: bool = Field(default=True, description="Include hashtags")
    include_cta: bool = Field(default=True, description="Include call-to-action")
    max_variations: conint(ge=1, le=100) = Field(default=10, description="Number of variations")
    cultural_adaptation: bool = Field(default=False, description="Apply cultural adaptation")
    offline_processing: bool = Field(default=False, description="Process offline when possible")
    
    @validator('target_language')
    def validate_language(cls, v):
        supported_languages = [
            'en', 'es', 'fr', 'de', 'zh', 'ja', 'ko', 'ar', 
            'ru', 'pt', 'it', 'nl', 'tr', 'hi', 'bn'
        ]
        if v not in supported_languages:
            raise ValueError(f'Language must be one of: {supported_languages}')
        return v

class ContentVariation(BaseSchema):
    platform: PlatformType
    text: str
    hashtags: List[str] = Field(default_factory=list)
    mentions: List[str] = Field(default_factory=list)
    media_urls: List[HttpUrl] = Field(default_factory=list)
    cta_text: Optional[str] = None
    cta_url: Optional[HttpUrl] = None
    performance_score: Optional[confloat(ge=0, le=100)] = None
    cultural_notes: Optional[str] = None
    offline_id: Optional[str] = Field(None, description="ID for offline operations")

class ContentGenerationResponse(BaseSchema):
    request_id: UUID4 = Field(default_factory=uuid.uuid4)
    variations: List[ContentVariation]
    generation_time_ms: int
    tokens_used: int
    estimated_reach: Dict[PlatformType, int] = Field(default_factory=dict)
    compliance_flags: List[str] = Field(default_factory=list)
    offline_variations: List[ContentVariation] = Field(default_factory=list, description="Offline-only variations")

class ContentBatch(BaseSchema, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    ai_influencer_id: Optional[UUID4] = None
    original_prompt: str
    content_type: ContentType
    target_platforms: List[PlatformType]
    variations: List[ContentVariation]
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_archived: bool = Field(default=False)
    offline_status: OfflineOperationStatus = Field(default=OfflineOperationStatus.SYNCED)

# ============================================================================
# SOCIAL MEDIA SCHEMAS
# ============================================================================

class SocialPlatformConnection(BaseSchema):
    platform: PlatformType
    account_id: str
    account_name: str
    access_token: str  # Encrypted in storage
    refresh_token: Optional[str] = None
    expires_at: Optional[datetime] = None
    permissions: List[str] = Field(default_factory=list)
    is_active: bool = Field(default=True)

class SocialPlatformConnectionInDB(SocialPlatformConnection, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    encrypted_tokens: str  # Encrypted token storage
    connection_metadata: Dict[str, Any] = Field(default_factory=dict)
    offline_support: bool = Field(default=False, description="Offline posting capability")

class SocialPlatformConnectionResponse(BaseSchema):
    id: UUID4
    platform: PlatformType
    account_name: str
    is_active: bool
    permissions: List[str]
    connected_at: datetime
    offline_support: bool

class PostScheduleRequest(BaseSchema):
    content_variation_id: UUID4 = Field(..., description="Content variation to post")
    platforms: List[PlatformType] = Field(..., description="Platforms to post to")
    scheduled_time: Optional[datetime] = Field(None, description="Schedule time (null for immediate)")
    ai_influencer_id: Optional[UUID4] = Field(None, description="AI influencer to post as")
    custom_text: Optional[str] = Field(None, description="Custom text override")
    media_files: List[str] = Field(default_factory=list, description="Media file URLs")
    offline_fallback: bool = Field(default=True, description="Save for offline if network fails")

class PostInDB(BaseSchema, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    content_batch_id: Optional[UUID4] = None
    ai_influencer_id: Optional[UUID4] = None
    platform: PlatformType
    platform_post_id: Optional[str] = None
    text: str
    media_urls: List[str] = Field(default_factory=list)
    hashtags: List[str] = Field(default_factory=list)
    status: PostStatus
    scheduled_time: Optional[datetime] = None
    published_at: Optional[datetime] = None
    error_message: Optional[str] = None
    engagement_metrics: Dict[str, int] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    offline_operation: bool = Field(default=False, description="Created offline")

class PostResponse(BaseSchema):
    id: UUID4
    platform: PlatformType
    platform_post_id: Optional[str]
    text: str
    status: PostStatus
    scheduled_time: Optional[datetime]
    published_at: Optional[datetime]
    engagement_metrics: Dict[str, int]
    created_at: datetime
    offline_operation: bool

class BulkDeleteRequest(BaseSchema):
    filter_criteria: Dict[str, Any] = Field(..., description="Deletion criteria")
    platforms: Optional[List[PlatformType]] = None
    date_range: Optional[Dict[str, datetime]] = None
    hashtags: Optional[List[str]] = None
    ai_influencer_id: Optional[UUID4] = None
    confirm_deletion: bool = Field(..., description="Confirmation flag")
    offline_sync: bool = Field(default=True, description="Sync offline changes")

# ============================================================================
# ANALYTICS SCHEMAS
# ============================================================================

class AnalyticsQuery(BaseSchema):
    user_id: UUID4
    metrics: List[AnalyticsMetric] = Field(..., description="Metrics to retrieve")
    platforms: Optional[List[PlatformType]] = None
    ai_influencer_id: Optional[UUID4] = None
    date_from: datetime = Field(..., description="Start date")
    date_to: datetime = Field(..., description="End date")
    granularity: Literal["hour", "day", "week", "month"] = Field(default="day")
    offline_cache: bool = Field(default=True, description="Allow offline cache")
    
    @validator('date_to')
    def validate_date_range(cls, v, values):
        if 'date_from' in values and v <= values['date_from']:
            raise ValueError('date_to must be after date_from')
        return v

class AnalyticsDataPoint(BaseSchema):
    timestamp: datetime
    platform: Optional[PlatformType] = None
    metric: AnalyticsMetric
    value: Union[int, float]
    metadata: Dict[str, Any] = Field(default_factory=dict)
    offline_source: bool = Field(default=False, description="From offline storage")

class AnalyticsResponse(BaseSchema):
    query: AnalyticsQuery
    data_points: List[AnalyticsDataPoint]
    summary: Dict[str, Union[int, float]] = Field(default_factory=dict)
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    offline_data: bool = Field(default=False, description="Contains offline data")

class DashboardMetrics(BaseSchema):
    user_id: UUID4
    total_posts: int = Field(default=0)
    total_impressions: int = Field(default=0)
    total_engagement: int = Field(default=0)
    total_clicks: int = Field(default=0)
    active_platforms: int = Field(default=0)
    ai_influencers_count: int = Field(default=0)
    subscription_tier: SubscriptionTier
    storage_used_mb: float = Field(default=0.0)
    api_calls_remaining: int = Field(default=0)
    last_post_date: Optional[datetime] = None
    top_performing_platform: Optional[PlatformType] = None
    offline_usage: Dict[str, int] = Field(default_factory=dict)

# ============================================================================
# FILE UPLOAD SCHEMAS
# ============================================================================

class FileUploadRequest(BaseSchema):
    filename: str = Field(..., description="Original filename")
    content_type: str = Field(..., description="MIME type")
    size_bytes: int = Field(..., gt=0, description="File size in bytes")
    purpose: Literal["avatar", "media", "document", "backup"] = Field(..., description="Upload purpose")
    offline_storage: bool = Field(default=False, description="Store for offline use")
    
    @validator('content_type')
    def validate_content_type(cls, v):
        allowed_types = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/mov', 'video/avi',
            'application/pdf', 'text/csv', 'application/json'
        ]
        if v not in allowed_types:
            raise ValueError(f'Content type must be one of: {allowed_types}')
        return v
    
    @validator('size_bytes')
    def validate_file_size(cls, v, values):
        max_sizes = {
            'avatar': 5 * 1024 * 1024,      # 5MB
            'media': 100 * 1024 * 1024,     # 100MB
            'document': 10 * 1024 * 1024,   # 10MB
            'backup': 500 * 1024 * 1024     # 500MB
        }
        purpose = values.get('purpose')
        if purpose and v > max_sizes.get(purpose, 10 * 1024 * 1024):
            raise ValueError(f'File size exceeds limit for {purpose}')
        return v

class FileUploadResponse(BaseSchema):
    file_id: UUID4
    upload_url: HttpUrl
    download_url: HttpUrl
    expires_at: datetime
    offline_key: Optional[str] = Field(None, description="Key for offline access")

class FileRecord(BaseSchema, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    filename: str
    content_type: str
    size_bytes: int
    purpose: str
    storage_path: str
    public_url: Optional[HttpUrl] = None
    is_processed: bool = Field(default=False)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    offline_available: bool = Field(default=False)

# ============================================================================
# E-COMMERCE AUTOMATION SCHEMAS
# ============================================================================

class ProductSuggestion(BaseSchema):
    product_id: str
    title: str
    source: Literal["AliExpress", "Shopify", "Internal"]
    trend_score: float
    predicted_demand: float
    price_range: Dict[str, float]
    image_url: HttpUrl
    last_updated: datetime
    offline_available: bool = Field(default=False)

class PricingRule(BaseSchema):
    rule_id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    product_ids: List[str]
    algorithm: Literal["competitor", "demand", "cost_plus"]
    parameters: Dict[str, float]
    last_applied: Optional[datetime] = None
    offline_enabled: bool = Field(default=True)

class ShippingRule(BaseSchema):
    rule_id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    region: str
    lead_time_days: int
    trigger_threshold: int
    products: List[str]
    last_triggered: Optional[datetime] = None
    offline_available: bool = Field(default=True)

# ============================================================================
# CULTURAL INTELLIGENCE SCHEMAS
# ============================================================================

class MemePattern(BaseSchema):
    pattern_id: UUID4 = Field(default_factory=uuid.uuid4)
    region: str
    pattern_type: str
    popularity_score: float
    trend_score: float
    examples: List[str]
    last_detected: datetime
    offline_available: bool = Field(default=True)

class TabooItem(BaseSchema):
    item_id: UUID4 = Field(default_factory=uuid.uuid4)
    region: str
    category: Literal["gesture", "color", "word", "symbol"]
    item: str
    severity: Literal["low", "medium", "high", "extreme"]
    alternatives: List[str]
    last_updated: datetime
    offline_available: bool = Field(default=True)

class LocalizationVariant(BaseSchema):
    variant_id: UUID4 = Field(default_factory=uuid.uuid4)
    content_id: UUID4
    region: str
    text: str
    performance_score: float
    last_used: datetime
    offline_available: bool = Field(default=True)

# ============================================================================
# SYSTEM SCHEMAS
# ============================================================================

class HealthCheck(BaseSchema):
    status: Literal["healthy", "degraded", "unhealthy"] = "healthy"
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    version: str
    uptime_seconds: int
    checks: Dict[str, bool] = Field(default_factory=dict)
    offline_mode: bool = Field(default=False)

class SystemConfiguration(BaseSchema):
    feature_flags: Dict[str, bool] = Field(default_factory=dict)
    rate_limits: Dict[str, int] = Field(default_factory=dict)
    maintenance_mode: bool = Field(default=False)
    api_version: str = "v1"
    supported_platforms: List[PlatformType] = Field(default_factory=lambda: list(PlatformType))
    supported_languages: List[str] = Field(default_factory=lambda: [
        'en', 'es', 'fr', 'de', 'zh', 'ja', 'ko', 'ar', 
        'ru', 'pt', 'it', 'nl', 'tr', 'hi', 'bn'
    ])
    offline_settings: Dict[str, Any] = Field(default_factory=dict)

class ErrorResponse(BaseSchema):
    error: str = Field(..., description="Error type")
    message: str = Field(..., description="Error message")
    details: Optional[Dict[str, Any]] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    request_id: Optional[str] = None
    offline_recoverable: bool = Field(default=False)

class PaginatedResponse(BaseSchema):
    items: List[Any]
    total: int = Field(..., ge=0)
    page: int = Field(..., ge=1)
    per_page: int = Field(..., ge=1, le=100)
    pages: int = Field(..., ge=1)
    has_next: bool = Field(default=False)
    has_prev: bool = Field(default=False)
    offline_items: List[Any] = Field(default_factory=list)
    
    @validator('pages')
    def calculate_pages(cls, v, values):
        if 'total' in values and 'per_page' in values:
            import math
            return math.ceil(values['total'] / values['per_page'])
        return v

# ============================================================================
# WEBHOOK SCHEMAS
# ============================================================================

class WebhookEvent(BaseSchema):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    event_type: str = Field(..., description="Event type")
    source: str = Field(..., description="Event source")
    data: Dict[str, Any] = Field(..., description="Event data")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    signature: Optional[str] = Field(None, description="Event signature")
    offline_triggered: bool = Field(default=False)

class WebhookSubscription(BaseSchema, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    endpoint_url: HttpUrl
    event_types: List[str]
    secret: str  # For signature verification
    is_active: bool = Field(default=True)
    last_delivery_at: Optional[datetime] = None
    failure_count: int = Field(default=0)
    offline_queue: bool = Field(default=True, description="Queue during offline")

# ============================================================================
# OFFLINE SCHEMAS
# ============================================================================

class OfflineCapability(BaseSchema):
    """Schema for offline functionality metadata"""
    can_work_offline: bool = Field(default=False)
    offline_storage_key: Optional[str] = None
    sync_priority: int = Field(default=0)  # 0=lowest, 10=highest
    last_synced: Optional[datetime] = None
    pending_sync: bool = Field(default=False)
    storage_quota_mb: int = Field(default=100)
    storage_used_mb: float = Field(default=0.0)

class OfflineOperation(BaseSchema, TimestampMixin):
    """Individual offline operation"""
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    operation_type: str  # 'create_post', 'update_profile', 'generate_content'
    operation_data: Dict[str, Any]
    status: OfflineOperationStatus = Field(default=OfflineOperationStatus.PENDING)
    retry_count: int = Field(default=0)
    last_attempt: Optional[datetime] = None
    error: Optional[str] = None

class OfflineSyncRequest(BaseSchema):
    operations: List[Dict[str, Any]]
    device_id: str
    sync_token: str

class OfflineSyncResponse(BaseSchema):
    synced_operations: List[UUID4]
    failed_operations: List[Dict[str, Any]]
    new_sync_token: str
    sync_timestamp: datetime = Field(default_factory=datetime.utcnow)

# ============================================================================
# SECURITY SCHEMAS
# ============================================================================

class EncryptedData(BaseSchema):
    encrypted_data: str
    encryption_version: str = "v1"
    key_id: Optional[str] = None

class SecurityAuditLog(BaseSchema, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    action: str
    resource: str
    status: Literal["success", "failure"]
    ip_address: str
    device_info: Dict[str, Any]
    location: Optional[str] = None
    offline: bool = Field(default=False)

class BiometricAuthRequest(BaseSchema):
    device_id: str
    biometric_type: Literal["fingerprint", "face", "iris"]
    auth_data: str  # Encrypted biometric data

# ============================================================================
# VALIDATION HELPERS
# ============================================================================

def validate_url_domain(url: str, allowed_domains: List[str]) -> bool:
    """Validate URL belongs to allowed domains"""
    try:
        parsed = urlparse(url)
        return parsed.netloc in allowed_domains
    except Exception:
        return False

def sanitize_html(content: str) -> str:
    """Basic HTML sanitization"""
    import html
    return html.escape(content)

def validate_cultural_content(content: str, target_culture: str) -> List[str]:
    """Validate content for cultural sensitivity"""
    # This would integrate with the cultural intelligence system
    warnings = []
    
    # Basic checks (would be expanded with ML models)
    sensitive_topics = {
        'general': ['politics', 'religion', 'sensitive_events'],
        'ar': ['alcohol', 'pork', 'religious_imagery'],
        'zh': ['political_references', 'taiwan', 'tibet'],
        'in': ['beef', 'religious_conflicts']
    }
    
    # Implement actual cultural validation logic here
    return warnings

def encrypt_field(value: str) -> str:
    """Encrypt sensitive field values"""
    key = os.getenv("ENCRYPTION_KEY")
    if not key:
        raise ValueError("Encryption key not configured")
    fernet = Fernet(key.encode())
    return fernet.encrypt(value.encode()).decode()

def decrypt_field(encrypted_value: str) -> str:
    """Decrypt sensitive field values"""
    key = os.getenv("ENCRYPTION_KEY")
    if not key:
        raise ValueError("Encryption key not configured")
    fernet = Fernet(key.encode())
    return fernet.decrypt(encrypted_value.encode()).decode()

# ============================================================================
# GDPR COMPLIANCE SCHEMAS
# ============================================================================

class DataSubjectRequest(BaseSchema):
    user_id: UUID4
    request_type: Literal["access", "deletion", "correction"]
    scope: List[str]  # ["profile", "posts", "analytics", "payments"]
    status: Literal["pending", "processing", "completed", "failed"] = "pending"
    requested_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None

class DataExport(BaseSchema):
    export_id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    data_categories: List[str]
    file_url: HttpUrl
    expires_at: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)

# ============================================================================
# THEME CONFIGURATION SCHEMA
# ============================================================================

class ThemeConfiguration(BaseSchema):
    primary_color: str = Field(default="#6C5CE7")
    secondary_color: str = Field(default="#5A4FCF")
    accent_color: str = Field(default="#00CEC9")
    text_primary: str = Field(default="#2D3436")
    background: str = Field(default="#F8F9FA")
    dark_mode: bool = Field(default=False)
    font_family: str = Field(default="Inter")
    font_size: int = Field(default=16)
    user_id: UUID4
    last_updated: datetime = Field(default_factory=datetime.utcnow)

# ============================================================================
# COMPREHENSIVE OFFLINE SUPPORT
# ============================================================================

class OfflineContentPackage(BaseSchema):
    package_id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    content: Dict[str, Any]
    expires_at: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_accessed: Optional[datetime] = None
    access_count: int = Field(default=0)

class OfflineAnalyticsSnapshot(BaseSchema):
    snapshot_id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    period_start: datetime
    period_end: datetime
    metrics: Dict[str, Any]
    created_at: datetime = Field(default_factory=datetime.utcnow)

class OfflineConfiguration(BaseSchema):
    user_id: UUID4
    auto_sync: bool = Field(default=True)
    sync_frequency: Literal["immediate", "hourly", "daily"] = "daily"
    data_retention_days: int = Field(default=7, ge=1, le=30)
    last_sync: Optional[datetime] = None
    next_sync: Optional[datetime] = None
    storage_quota_mb: int = Field(default=100)
    storage_used_mb: float = Field(default=0.0)

# ============================================================================
# REAL-TIME COLLABORATION
# ============================================================================

class CollaborationSession(BaseSchema, TimestampMixin):
    session_id: UUID4 = Field(default_factory=uuid.uuid4)
    owner_id: UUID4
    participants: List[UUID4] = Field(default_factory=list)
    resource_id: UUID4  # Content, campaign, etc.
    resource_type: str
    permissions: Dict[str, List[str]]  # {user_id: [permissions]}
    offline_mode: bool = Field(default=False)

class CollaborationEvent(BaseSchema):
    event_id: UUID4 = Field(default_factory=uuid.uuid4)
    session_id: UUID4
    user_id: UUID4
    action: str
    data: Dict[str, Any]
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    offline_origin: bool = Field(default=False)
    
# ============================================================================
# CONTINUATION OF OFFLINE SCHEMAS
# ============================================================================

class OfflineQueue(BaseSchema, TimestampMixin):
    """Queue for offline operations"""
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    operation_type: str  # 'create_post', 'update_profile', 'generate_content', etc.
    operation_data: Dict[str, Any] = Field(..., description="Serialized operation data")
    status: OfflineOperationStatus = Field(default=OfflineOperationStatus.PENDING)
    retry_count: int = Field(default=0)
    last_attempt: Optional[datetime] = None
    error_message: Optional[str] = None
    priority: conint(ge=1, le=10) = Field(default=5, description="Sync priority")

class OfflineSyncRequest(BaseSchema):
    operations: List[Dict[str, Any]] = Field(..., description="Operations to sync")
    device_id: str = Field(..., description="Unique device identifier")
    sync_token: str = Field(..., description="Synchronization token")
    app_version: str = Field(..., description="Client application version")

class OfflineSyncResponse(BaseSchema):
    synced_operations: List[UUID4] = Field(default_factory=list)
    failed_operations: List[Dict[str, Any]] = Field(default_factory=list)
    new_sync_token: str = Field(..., description="Token for next sync")
    sync_timestamp: datetime = Field(default_factory=datetime.utcnow)
    storage_quota: int = Field(default=100, description="Offline storage quota in MB")
    storage_used: float = Field(default=0.0, description="Storage used in MB")

class OfflineContentPackage(BaseSchema):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    package_type: Literal["ai_influencers", "content_templates", "analytics_data"]
    content: Dict[str, Any] = Field(..., description="Serialized content")
    expires_at: datetime = Field(..., description="Expiration timestamp")
    size_mb: float = Field(..., description="Package size in MB")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_accessed: Optional[datetime] = None

# ============================================================================
# SECURITY & COMPLIANCE SCHEMAS
# ============================================================================

class SecurityAuditLog(BaseSchema, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    action: str = Field(..., description="Audited action")
    resource: str = Field(..., description="Resource affected")
    status: Literal["success", "failure", "warning"] = Field(...)
    ip_address: Optional[str] = None
    device_info: Optional[Dict[str, Any]] = None
    location: Optional[str] = None
    offline: bool = Field(default=False, description="Action performed offline")

class BiometricAuthRequest(BaseSchema):
    device_id: str = Field(..., description="Device identifier")
    biometric_type: Literal["fingerprint", "face", "iris"] = Field(...)
    auth_data: str = Field(..., description="Encrypted biometric data")
    challenge: str = Field(..., description="Security challenge")

class GDPRDataRequest(BaseSchema):
    user_id: UUID4
    request_type: Literal["access", "deletion", "correction", "portability"]
    scope: List[str] = Field(..., description="Data categories to include")
    status: Literal["pending", "processing", "completed", "failed"] = Field(default="pending")
    requested_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    download_url: Optional[HttpUrl] = None

class ComplianceCheck(BaseSchema):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    post_id: Optional[UUID4] = None
    content: str = Field(..., description="Content to check")
    platform: PlatformType
    region: str = Field(..., description="Target region/country")
    violations: List[str] = Field(default_factory=list)
    risk_score: confloat(ge=0, le=100) = Field(default=0.0)
    passed: bool = Field(default=False)
    checked_at: datetime = Field(default_factory=datetime.utcnow)
    offline_checked: bool = Field(default=False)

# ============================================================================
# THEME & UI CONFIGURATION SCHEMAS
# ============================================================================

class ThemeConfiguration(BaseSchema):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    primary_color: str = Field(default="#6C5CE7", description="Main brand color")
    secondary_color: str = Field(default="#5A4FCF", description="Secondary color")
    accent_color: str = Field(default="#00CEC9", description="Accent color")
    text_primary: str = Field(default="#2D3436", description="Primary text color")
    text_secondary: str = Field(default="#636E72", description="Secondary text color")
    background: str = Field(default="#F8F9FA", description="Background color")
    card_background: str = Field(default="#FFFFFF", description="Card background")
    border_color: str = Field(default="#E9ECEF", description="Border color")
    dark_mode: bool = Field(default=False, description="Dark mode enabled")
    font_family: str = Field(default="Inter", description="Primary font")
    font_size: int = Field(default=16, description="Base font size in px")
    spacing_unit: int = Field(default=8, description="Spacing unit in px")
    last_updated: datetime = Field(default_factory=datetime.utcnow)

class UICustomization(BaseSchema):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    layout_preference: Literal["compact", "spacious", "balanced"] = Field(default="balanced")
    animation_level: Literal["minimal", "moderate", "high"] = Field(default="moderate")
    icon_style: Literal["filled", "outlined", "duotone"] = Field(default="filled")
    reduced_motion: bool = Field(default=False, description="Accessibility setting")
    high_contrast: bool = Field(default=False, description="Accessibility setting")
    language: str = Field(default="en", description="UI language")
    last_updated: datetime = Field(default_factory=datetime.utcnow)

# ============================================================================
# E-COMMERCE AUTOMATION SCHEMAS
# ============================================================================

class ProductSuggestion(BaseSchema):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    product_id: str = Field(..., description="Source system product ID")
    title: str = Field(..., description="Product title")
    source: Literal["AliExpress", "Shopify", "Amazon"] = Field(...)
    trend_score: confloat(ge=0, le=100) = Field(...)
    predicted_demand: confloat(ge=0) = Field(...)
    price_range: Dict[str, float] = Field(..., description="Min and max price")
    image_url: HttpUrl
    category: str
    last_updated: datetime
    offline_available: bool = Field(default=False)

class PricingRule(BaseSchema):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    name: str = Field(..., description="Rule name")
    target_products: List[str] = Field(..., description="Affected product IDs")
    algorithm: Literal["competitor_based", "demand_based", "cost_plus"] = Field(...)
    parameters: Dict[str, float] = Field(..., description="Algorithm parameters")
    enabled: bool = Field(default=True)
    last_applied: Optional[datetime] = None
    offline_enabled: bool = Field(default=True)

class ShippingRule(BaseSchema):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    name: str = Field(..., description="Rule name")
    region: str = Field(..., description="Target region")
    lead_time_days: conint(ge=1) = Field(...)
    trigger_threshold: conint(ge=1) = Field(..., description="Demand trigger level")
    products: List[str] = Field(..., description="Product IDs")
    warehouse_location: str
    last_triggered: Optional[datetime] = None
    offline_available: bool = Field(default=True)

# ============================================================================
# AI MODEL CONFIGURATION SCHEMAS
# ============================================================================

class AIModelConfig(BaseSchema):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    model_name: str = Field(..., description="Model identifier")
    provider: Literal["OpenAI", "HuggingFace", "Custom"] = Field(...)
    parameters: Dict[str, Any] = Field(..., description="Model parameters")
    content_style: str = Field(..., description="Content generation style")
    temperature: confloat(ge=0, le=1) = Field(default=0.7)
    max_length: conint(ge=50, le=1000) = Field(default=200)
    cultural_adjustments: Dict[str, Any] = Field(default_factory=dict)
    last_updated: datetime = Field(default_factory=datetime.utcnow)
    offline_compatible: bool = Field(default=False)

class ModelTrainingData(BaseSchema):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    model_id: UUID4
    data_type: Literal["text", "image", "video"] = Field(...)
    content: str = Field(..., description="Training content")
    annotations: Dict[str, Any] = Field(default_factory=dict)
    source: str = Field(..., description="Data source")
    added_at: datetime = Field(default_factory=datetime.utcnow)

# ============================================================================
# TEAM & COLLABORATION SCHEMAS
# ============================================================================

class TeamMember(BaseSchema):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    team_id: UUID4
    role: Literal["owner", "admin", "editor", "viewer"] = Field(...)
    joined_at: datetime = Field(default_factory=datetime.utcnow)
    last_active: Optional[datetime] = None
    permissions: Dict[str, List[str]] = Field(default_factory=dict)

class Team(BaseSchema, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    name: str = Field(..., description="Team name")
    owner_id: UUID4
    subscription_tier: SubscriptionTier = Field(...)
    members: List[TeamMember] = Field(default_factory=list)
    projects: List[UUID4] = Field(default_factory=list)
    storage_quota_mb: int = Field(default=1024)
    storage_used_mb: float = Field(default=0.0)

class CollaborationSession(BaseSchema, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    resource_id: UUID4 = Field(..., description="Content, campaign, etc.")
    resource_type: str = Field(..., description="Type of resource")
    initiator_id: UUID4
    participants: List[UUID4] = Field(default_factory=list)
    active: bool = Field(default=True)
    last_activity: datetime = Field(default_factory=datetime.utcnow)
    offline_participants: List[UUID4] = Field(default_factory=list)

# ============================================================================
# NOTIFICATION SCHEMAS
# ============================================================================

class Notification(BaseSchema, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    type: Literal["system", "alert", "update", "social", "analytics"] = Field(...)
    title: str = Field(..., description="Notification title")
    message: str = Field(..., description="Notification content")
    read: bool = Field(default=False)
    action_url: Optional[HttpUrl] = None
    priority: conint(ge=1, le=3) = Field(default=2)
    offline_delivered: bool = Field(default=False)

class NotificationPreferences(BaseSchema):
    user_id: UUID4
    email_enabled: bool = Field(default=True)
    push_enabled: bool = Field(default=True)
    in_app_enabled: bool = Field(default=True)
    digest_frequency: Literal["immediate", "hourly", "daily"] = Field(default="immediate")
    categories: Dict[str, bool] = Field(default_factory=lambda: {
        "system": True,
        "alerts": True,
        "updates": True,
        "social": True,
        "analytics": True
    })
    last_updated: datetime = Field(default_factory=datetime.utcnow)

# ============================================================================
# API USAGE & LIMITS SCHEMAS
# ============================================================================

class APIUsageRecord(BaseSchema, TimestampMixin):
    id: UUID4 = Field(default_factory=uuid.uuid4)
    user_id: UUID4
    endpoint: str = Field(..., description="API endpoint")
    method: str = Field(..., description="HTTP method")
    duration_ms: int = Field(..., description="Processing time")
    status_code: int = Field(..., description="HTTP status code")
    credits_used: int = Field(default=0)
    offline: bool = Field(default=False)

class UsageLimits(BaseSchema):
    user_id: UUID4
    tier: SubscriptionTier
    monthly_api_calls: int
    monthly_ai_generations: int
    storage_mb: int
    ai_influencers: int
    team_members: int
    current_usage: Dict[str, int] = Field(default_factory=dict)
    reset_date: date = Field(..., description="Usage reset date")
    last_updated: datetime = Field(default_factory=datetime.utcnow)

# ============================================================================
# FINAL COMPREHENSIVE SCHEMAS
# ============================================================================

class AppConfiguration(BaseSchema):
    """Centralized application configuration schema"""
    id: UUID4 = Field(default_factory=uuid.uuid4)
    version: str = Field(..., description="Configuration version")
    effective_date: datetime = Field(default_factory=datetime.utcnow)
    themes: Dict[SubscriptionTier, ThemeConfiguration] = Field(default_factory=dict)
    feature_flags: Dict[str, bool] = Field(default_factory=dict)
    rate_limits: Dict[str, int] = Field(default_factory=dict)
    security_settings: Dict[str, Any] = Field(default_factory=dict)
    ai_models: List[AIModelConfig] = Field(default_factory=list)
    offline_settings: Dict[str, Any] = Field(default_factory=dict)
    compliance_rules: Dict[str, Any] = Field(default_factory=dict)

class SystemStatus(BaseSchema):
    """Comprehensive system status report"""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    api_status: Literal["operational", "degraded", "maintenance"] = "operational"
    database_status: Literal["online", "offline", "replicating"] = "online"
    ai_services: Dict[str, str] = Field(default_factory=dict)
    queue_status: Dict[str, int] = Field(default_factory=dict)
    active_users: int = Field(default=0)
    system_load: float = Field(default=0.0)
    offline_operations: int = Field(default=0)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def generate_encryption_key() -> str:
    """Generate a secure encryption key"""
    from cryptography.fernet import Fernet
    return Fernet.generate_key().decode()

def encrypt_field(value: str, encryption_key: str) -> str:
    """Encrypt sensitive field values"""
    from cryptography.fernet import Fernet
    fernet = Fernet(encryption_key.encode())
    return fernet.encrypt(value.encode()).decode()

def decrypt_field(encrypted_value: str, encryption_key: str) -> str:
    """Decrypt sensitive field values"""
    from cryptography.fernet import Fernet
    fernet = Fernet(encryption_key.encode())
    return fernet.decrypt(encrypted_value.encode()).decode()

def validate_hex_color(value: str) -> bool:
    """Validate hex color format"""
    pattern = r'^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$'
    return re.match(pattern, value) is not None

def generate_offline_id() -> str:
    """Generate unique offline identifier"""
    import shortuuid
    return f"off_{shortuuid.ShortUUID().random(length=12)}"

# ============================================================================
# SCHEMA VALIDATORS
# ============================================================================

@validator('primary_color', 'secondary_color', 'accent_color', pre=True)
def validate_hex_colors(cls, value):
    if not validate_hex_color(value):
        raise ValueError(f"Invalid hex color: {value}")
    return value

@validator('platforms', pre=True)
def validate_platforms(cls, value):
    if not value:
        raise ValueError("At least one platform must be specified")
    return value

@root_validator
def validate_offline_storage_size(cls, values):
    if 'offline_storage_size' in values and 'storage_quota' in values:
        if values['offline_storage_size'] > values['storage_quota']:
            raise ValueError("Offline storage exceeds quota")
    return values

# ============================================================================
# END OF SCHEMAS
# ============================================================================