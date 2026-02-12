import os
import secrets
from functools import lru_cache
from typing import Optional, List, Dict, Any
import json
from pathlib import Path
from cryptography.fernet import Fernet
import base64
from datetime import timedelta

class SecurityConfig:
    """Advanced security configuration with encryption"""
    
    def __init__(self):
        self._cipher = None
        self._init_encryption()
    
    def _init_encryption(self):
        """Initialize encryption for sensitive data"""
        key = os.getenv('ENCRYPTION_KEY')
        if not key:
            # Generate and save new key in production
            key = Fernet.generate_key()
            # In production, save this securely and load from secure vault
        else:
            key = key.encode()
        self._cipher = Fernet(key)
    
    def encrypt_data(self, data: str) -> str:
        """Encrypt sensitive data"""
        return self._cipher.encrypt(data.encode()).decode()
    
    def decrypt_data(self, encrypted_data: str) -> str:
        """Decrypt sensitive data"""
        return self._cipher.decrypt(encrypted_data.encode()).decode()
    
    @property
    def jwt_secret_key(self) -> str:
        """Generate or retrieve JWT secret"""
        key = os.getenv('JWT_SECRET_KEY')
        if not key:
            # Generate cryptographically secure key
            key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
        return key
    
    @property
    def api_keys(self) -> Dict[str, str]:
        """Encrypted API keys storage"""
        return {
            'openai': self._get_encrypted_key('OPENAI_API_KEY'),
            'claude': self._get_encrypted_key('CLAUDE_API_KEY'),
            'instagram': self._get_encrypted_key('INSTAGRAM_API_KEY'),
            'tiktok': self._get_encrypted_key('TIKTOK_API_KEY'),
            'twitter': self._get_encrypted_key('TWITTER_API_KEY'),
            'facebook': self._get_encrypted_key('FACEBOOK_API_KEY'),
            'stripe': self._get_encrypted_key('STRIPE_SECRET_KEY'),
            'paddle': self._get_encrypted_key('PADDLE_API_KEY'),
            'firebase': self._get_encrypted_key('FIREBASE_ADMIN_KEY'),
        }
    
    def _get_encrypted_key(self, env_var: str) -> str:
        """Get and decrypt API key"""
        encrypted_key = os.getenv(env_var)
        if encrypted_key:
            try:
                return self.decrypt_data(encrypted_key)
            except:
                # Fallback to plain text in development
                return encrypted_key
        return ""

class DatabaseConfig:
    """Database configuration with connection pooling"""
    
    @property
    def url(self) -> str:
        """Database URL with failover support"""
        primary_db = os.getenv('DATABASE_URL')
        if primary_db:
            return primary_db
        
        # Construct from components
        user = os.getenv('DB_USER', 'postgres')
        password = os.getenv('DB_PASSWORD', '')
        host = os.getenv('DB_HOST', 'localhost')
        port = os.getenv('DB_PORT', '5432')
        name = os.getenv('DB_NAME', 'onxlink')
        
        return f"postgresql://{user}:{password}@{host}:{port}/{name}"
    
    @property
    def pool_settings(self) -> Dict[str, Any]:
        """Connection pool configuration"""
        return {
            'pool_size': int(os.getenv('DB_POOL_SIZE', '10')),
            'max_overflow': int(os.getenv('DB_MAX_OVERFLOW', '20')),
            'pool_timeout': int(os.getenv('DB_POOL_TIMEOUT', '30')),
            'pool_recycle': int(os.getenv('DB_POOL_RECYCLE', '3600')),
            'pool_pre_ping': True,
            'echo': os.getenv('ENV') == 'development'
        }
    
    @property
    def redis_url(self) -> str:
        """Redis configuration for caching and sessions"""
        return os.getenv('REDIS_URL', 'redis://localhost:6379/0')
    
    @property
    def redis_settings(self) -> Dict[str, Any]:
        """Redis connection settings"""
        return {
            'decode_responses': True,
            'health_check_interval': 30,
            'socket_keepalive': True,
            'socket_keepalive_options': {},
            'retry_on_timeout': True,
            'max_connections': int(os.getenv('REDIS_MAX_CONNECTIONS', '20'))
        }

class AIServiceConfig:
    """AI service configurations with rate limiting"""
    
    @property
    def openai_config(self) -> Dict[str, Any]:
        """OpenAI service configuration"""
        return {
            'api_key': SecurityConfig().api_keys['openai'],
            'model': os.getenv('OPENAI_MODEL', 'gpt-4-turbo-preview'),
            'max_tokens': int(os.getenv('OPENAI_MAX_TOKENS', '4000')),
            'temperature': float(os.getenv('OPENAI_TEMPERATURE', '0.7')),
            'rate_limit': {
                'requests_per_minute': int(os.getenv('OPENAI_RPM', '50')),
                'tokens_per_minute': int(os.getenv('OPENAI_TPM', '40000'))
            },
            'timeout': int(os.getenv('OPENAI_TIMEOUT', '60')),
            'retry_attempts': int(os.getenv('OPENAI_RETRY', '3'))
        }
    
    @property
    def claude_config(self) -> Dict[str, Any]:
        """Claude service configuration"""
        return {
            'api_key': SecurityConfig().api_keys['claude'],
            'model': os.getenv('CLAUDE_MODEL', 'claude-3-sonnet-20240229'),
            'max_tokens': int(os.getenv('CLAUDE_MAX_TOKENS', '4000')),
            'temperature': float(os.getenv('CLAUDE_TEMPERATURE', '0.7')),
            'rate_limit': {
                'requests_per_minute': int(os.getenv('CLAUDE_RPM', '50')),
                'tokens_per_minute': int(os.getenv('CLAUDE_TPM', '40000'))
            },
            'timeout': int(os.getenv('CLAUDE_TIMEOUT', '60')),
            'retry_attempts': int(os.getenv('CLAUDE_RETRY', '3'))
        }
    
    @property
    def content_generation_defaults(self) -> Dict[str, Any]:
        """Default settings for content generation"""
        return {
            'max_variations': int(os.getenv('MAX_CONTENT_VARIATIONS', '100')),
            'supported_platforms': [
                'instagram', 'tiktok', 'twitter', 'facebook', 'linkedin',
                'youtube', 'pinterest', 'snapchat', 'reddit', 'discord',
                'telegram', 'whatsapp', 'wechat', 'amazon_live', 'shopify'
            ],
            'cache_duration': int(os.getenv('CONTENT_CACHE_DURATION', '3600')),
            'batch_size': int(os.getenv('AI_BATCH_SIZE', '10')),
            'quality_threshold': float(os.getenv('CONTENT_QUALITY_THRESHOLD', '0.8'))
        }

class SocialPlatformConfig:
    """Social media platform API configurations"""
    
    @property
    def instagram_config(self) -> Dict[str, Any]:
        """Instagram Graph API configuration"""
        return {
            'api_key': SecurityConfig().api_keys['instagram'],
            'api_version': os.getenv('INSTAGRAM_API_VERSION', 'v18.0'),
            'base_url': 'https://graph.facebook.com',
            'rate_limit': {
                'requests_per_hour': int(os.getenv('INSTAGRAM_RPH', '200')),
                'burst_limit': int(os.getenv('INSTAGRAM_BURST', '20'))
            },
            'media_upload_timeout': int(os.getenv('INSTAGRAM_UPLOAD_TIMEOUT', '300')),
            'supported_formats': ['jpg', 'jpeg', 'png', 'mp4', 'mov'],
            'max_file_size': int(os.getenv('INSTAGRAM_MAX_SIZE', '100')) * 1024 * 1024  # MB to bytes
        }
    
    @property
    def tiktok_config(self) -> Dict[str, Any]:
        """TikTok Business API configuration"""
        return {
            'api_key': SecurityConfig().api_keys['tiktok'],
            'api_version': os.getenv('TIKTOK_API_VERSION', 'v1.3'),
            'base_url': 'https://business-api.tiktok.com',
            'rate_limit': {
                'requests_per_minute': int(os.getenv('TIKTOK_RPM', '100')),
                'daily_limit': int(os.getenv('TIKTOK_DAILY', '10000'))
            },
            'video_upload_timeout': int(os.getenv('TIKTOK_UPLOAD_TIMEOUT', '600')),
            'supported_formats': ['mp4', 'mov', 'avi', 'webm'],
            'max_file_size': int(os.getenv('TIKTOK_MAX_SIZE', '500')) * 1024 * 1024
        }
    
    @property
    def twitter_config(self) -> Dict[str, Any]:
        """Twitter API v2 configuration"""
        return {
            'api_key': SecurityConfig().api_keys['twitter'],
            'api_version': os.getenv('TWITTER_API_VERSION', '2'),
            'base_url': 'https://api.twitter.com',
            'rate_limit': {
                'tweets_per_24h': int(os.getenv('TWITTER_DAILY_TWEETS', '300')),
                'requests_per_15min': int(os.getenv('TWITTER_RPM', '300'))
            },
            'character_limit': int(os.getenv('TWITTER_CHAR_LIMIT', '280')),
            'thread_support': True,
            'media_timeout': int(os.getenv('TWITTER_MEDIA_TIMEOUT', '180'))
        }
    
    @property
    def platform_posting_config(self) -> Dict[str, Any]:
        """Cross-platform posting configuration"""
        return {
            'max_simultaneous_posts': int(os.getenv('MAX_SIMULTANEOUS_POSTS', '5')),
            'post_queue_size': int(os.getenv('POST_QUEUE_SIZE', '1000')),
            'retry_attempts': int(os.getenv('POST_RETRY_ATTEMPTS', '3')),
            'retry_delay': int(os.getenv('POST_RETRY_DELAY', '60')),  # seconds
            'batch_processing': True,
            'scheduling_precision': int(os.getenv('SCHEDULE_PRECISION', '60')),  # seconds
            'failure_notification': True
        }

class PaymentConfig:
    """Payment processing configuration"""
    
    @property
    def stripe_config(self) -> Dict[str, Any]:
        """Stripe payment configuration"""
        return {
            'secret_key': SecurityConfig().api_keys['stripe'],
            'publishable_key': os.getenv('STRIPE_PUBLISHABLE_KEY', ''),
            'webhook_secret': os.getenv('STRIPE_WEBHOOK_SECRET', ''),
            'api_version': os.getenv('STRIPE_API_VERSION', '2023-10-16'),
            'currency': os.getenv('DEFAULT_CURRENCY', 'usd'),
            'capture_method': 'automatic',
            'payment_methods': ['card', 'apple_pay', 'google_pay'],
            'retry_attempts': int(os.getenv('STRIPE_RETRY', '3'))
        }
    
    @property
    def paddle_config(self) -> Dict[str, Any]:
        """Paddle payment configuration"""
        return {
            'vendor_id': os.getenv('PADDLE_VENDOR_ID', ''),
            'api_key': SecurityConfig().api_keys['paddle'],
            'public_key': os.getenv('PADDLE_PUBLIC_KEY', ''),
            'environment': os.getenv('PADDLE_ENV', 'sandbox'),
            'webhook_secret': os.getenv('PADDLE_WEBHOOK_SECRET', ''),
            'supported_currencies': ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],
            'tax_handling': 'automatic'
        }
    
    @property
    def subscription_tiers(self) -> Dict[str, Dict[str, Any]]:
        """Subscription tier configuration"""
        return {
            'freemium': {
                'name': 'Freemium',
                'price': 0,
                'features': {
                    'platforms': 5,
                    'ai_influencers': 1,
                    'content_variations': 10,
                    'analytics': 'basic',
                    'support': 'community',
                    'api_calls_per_day': 50,
                    'storage_gb': 1
                },
                'limits': {
                    'posts_per_day': 10,
                    'ai_generations_per_day': 20,
                    'bulk_operations': False
                }
            },
            'premium': {
                'name': 'Premium',
                'price': 77,
                'billing_cycle': 'monthly',
                'features': {
                    'platforms': 50,
                    'ai_influencers': 3,
                    'content_variations': 100,
                    'analytics': 'advanced',
                    'support': 'priority',
                    'api_calls_per_day': 1000,
                    'storage_gb': 50,
                    'cultural_adaptation': True,
                    'predictive_inventory': True
                },
                'limits': {
                    'posts_per_day': 500,
                    'ai_generations_per_day': 1000,
                    'bulk_operations': True
                }
            },
            'enterprise': {
                'name': 'Enterprise',
                'price': 777,
                'billing_cycle': 'yearly',
                'features': {
                    'platforms': 'unlimited',
                    'ai_influencers': 'unlimited',
                    'content_variations': 'unlimited',
                    'analytics': 'enterprise',
                    'support': '24/7',
                    'api_calls_per_day': 'unlimited',
                    'storage_gb': 'unlimited',
                    'custom_voice_cloning': True,
                    'anticipatory_shipping': True,
                    'multi_user_management': True,
                    'api_access': True,
                    'white_label': True
                },
                'limits': {
                    'posts_per_day': 'unlimited',
                    'ai_generations_per_day': 'unlimited',
                    'bulk_operations': True,
                    'custom_integrations': True
                }
            }
        }

class CacheConfig:
    """Caching configuration with offline support"""
    
    @property
    def redis_cache_config(self) -> Dict[str, Any]:
        """Redis caching configuration"""
        return {
            'default_ttl': int(os.getenv('CACHE_DEFAULT_TTL', '3600')),
            'max_memory': os.getenv('REDIS_MAX_MEMORY', '256mb'),
            'eviction_policy': os.getenv('REDIS_EVICTION', 'allkeys-lru'),
            'key_prefix': os.getenv('CACHE_KEY_PREFIX', 'onxlink:'),
            'serialization': 'json'
        }
    
    @property
    def offline_cache_config(self) -> Dict[str, Any]:
        """Offline caching configuration"""
        return {
            'enabled': True,
            'max_size_mb': int(os.getenv('OFFLINE_CACHE_SIZE', '100')),
            'sync_interval': int(os.getenv('OFFLINE_SYNC_INTERVAL', '300')),  # seconds
            'cached_resources': [
                'user_profile',
                'subscription_data',
                'generated_content',
                'social_accounts',
                'analytics_summary',
                'platform_templates',
                'ai_influencer_data'
            ],
            'priority_sync': [
                'failed_posts',
                'scheduled_content',
                'user_preferences'
            ]
        }

class AnalyticsConfig:
    """Analytics and monitoring configuration"""
    
    @property
    def firebase_config(self) -> Dict[str, Any]:
        """Firebase Analytics configuration"""
        firebase_key = SecurityConfig().api_keys['firebase']
        if firebase_key:
            try:
                return json.loads(firebase_key)
            except json.JSONDecodeError:
                pass
        
        return {
            'project_id': os.getenv('FIREBASE_PROJECT_ID', ''),
            'private_key': os.getenv('FIREBASE_PRIVATE_KEY', ''),
            'client_email': os.getenv('FIREBASE_CLIENT_EMAIL', ''),
            'analytics_enabled': True,
            'crashlytics_enabled': True,
            'performance_monitoring': True
        }
    
    @property
    def monitoring_config(self) -> Dict[str, Any]:
        """Application monitoring configuration"""
        return {
            'error_tracking': True,
            'performance_monitoring': True,
            'user_analytics': True,
            'business_metrics': True,
            'retention_period_days': int(os.getenv('ANALYTICS_RETENTION', '365')),
            'real_time_alerts': True,
            'custom_events': [
                'content_generated',
                'post_scheduled',
                'ai_influencer_created',
                'subscription_upgraded',
                'platform_connected',
                'bulk_operation_completed'
            ]
        }

class InternationalizationConfig:
    """Multi-language support configuration"""
    
    @property
    def supported_languages(self) -> List[Dict[str, str]]:
        """15 supported languages with cultural context"""
        return [
            {'code': 'en', 'name': 'English', 'region': 'US', 'rtl': False},
            {'code': 'es', 'name': 'Español', 'region': 'ES', 'rtl': False},
            {'code': 'fr', 'name': 'Français', 'region': 'FR', 'rtl': False},
            {'code': 'de', 'name': 'Deutsch', 'region': 'DE', 'rtl': False},
            {'code': 'zh', 'name': '中文', 'region': 'CN', 'rtl': False},
            {'code': 'ja', 'name': '日本語', 'region': 'JP', 'rtl': False},
            {'code': 'ko', 'name': '한국어', 'region': 'KR', 'rtl': False},
            {'code': 'ar', 'name': 'العربية', 'region': 'SA', 'rtl': True},
            {'code': 'ru', 'name': 'Русский', 'region': 'RU', 'rtl': False},
            {'code': 'pt', 'name': 'Português', 'region': 'BR', 'rtl': False},
            {'code': 'it', 'name': 'Italiano', 'region': 'IT', 'rtl': False},
            {'code': 'nl', 'name': 'Nederlands', 'region': 'NL', 'rtl': False},
            {'code': 'tr', 'name': 'Türkçe', 'region': 'TR', 'rtl': False},
            {'code': 'hi', 'name': 'हिन्दी', 'region': 'IN', 'rtl': False},
            {'code': 'bn', 'name': 'বাংলা', 'region': 'BD', 'rtl': False}
        ]
    
    @property
    def localization_config(self) -> Dict[str, Any]:
        """Localization settings"""
        return {
            'default_language': os.getenv('DEFAULT_LANGUAGE', 'en'),
            'fallback_language': 'en',
            'auto_detect': True,
            'cache_translations': True,
            'translation_cache_ttl': int(os.getenv('TRANSLATION_CACHE_TTL', '86400')),
            'cultural_adaptation': True,
            'timezone_support': True,
            'currency_localization': True,
            'date_format_localization': True
        }

class SecurityConstraints:
    """Advanced security constraints and policies"""
    
    @property
    def authentication_config(self) -> Dict[str, Any]:
        """Authentication security configuration"""
        return {
            'jwt_expiry': timedelta(hours=int(os.getenv('JWT_EXPIRY_HOURS', '24'))),
            'refresh_token_expiry': timedelta(days=int(os.getenv('REFRESH_TOKEN_DAYS', '30'))),
            'mfa_required': os.getenv('MFA_REQUIRED', 'false').lower() == 'true',
            'password_policy': {
                'min_length': int(os.getenv('PASSWORD_MIN_LENGTH', '8')),
                'require_uppercase': True,
                'require_lowercase': True,
                'require_numbers': True,
                'require_special_chars': True,
                'max_age_days': int(os.getenv('PASSWORD_MAX_AGE', '90'))
            },
            'session_config': {
                'max_concurrent_sessions': int(os.getenv('MAX_CONCURRENT_SESSIONS', '5')),
                'idle_timeout': int(os.getenv('SESSION_IDLE_TIMEOUT', '1800')),  # 30 minutes
                'absolute_timeout': int(os.getenv('SESSION_ABSOLUTE_TIMEOUT', '28800'))  # 8 hours
            },
            'rate_limiting': {
                'login_attempts': int(os.getenv('MAX_LOGIN_ATTEMPTS', '5')),
                'lockout_duration': int(os.getenv('LOGIN_LOCKOUT_MINUTES', '15')) * 60,
                'api_requests_per_minute': int(os.getenv('API_RATE_LIMIT', '100'))
            }
        }
    
    @property
    def data_protection_config(self) -> Dict[str, Any]:
        """GDPR and data protection configuration"""
        return {
            'gdpr_compliance': True,
            'data_retention_days': int(os.getenv('DATA_RETENTION_DAYS', '2555')),  # 7 years
            'anonymization_enabled': True,
            'right_to_deletion': True,
            'data_portability': True,
            'consent_management': True,
            'audit_logging': True,
            'encryption_at_rest': True,
            'encryption_in_transit': True,
            'pii_detection': True,
            'automated_data_discovery': True
        }

class PerformanceConfig:
    """Performance optimization configuration"""
    
    @property
    def api_performance_config(self) -> Dict[str, Any]:
        """API performance settings"""
        return {
            'request_timeout': int(os.getenv('API_REQUEST_TIMEOUT', '30')),
            'connection_pool_size': int(os.getenv('CONNECTION_POOL_SIZE', '100')),
            'max_request_size': int(os.getenv('MAX_REQUEST_SIZE', '10')) * 1024 * 1024,  # MB
            'compression_enabled': True,
            'gzip_threshold': 1024,
            'response_caching': True,
            'cdn_enabled': os.getenv('CDN_ENABLED', 'true').lower() == 'true'
        }
    
    @property
    def background_tasks_config(self) -> Dict[str, Any]:
        """Background task processing"""
        return {
            'max_workers': int(os.getenv('MAX_BACKGROUND_WORKERS', '4')),
            'task_timeout': int(os.getenv('TASK_TIMEOUT', '300')),
            'retry_policy': {
                'max_retries': int(os.getenv('TASK_MAX_RETRIES', '3')),
                'retry_delay': int(os.getenv('TASK_RETRY_DELAY', '60')),
                'exponential_backoff': True
            },
            'queue_size': int(os.getenv('TASK_QUEUE_SIZE', '1000')),
            'priority_queues': ['urgent', 'normal', 'low']
        }

@lru_cache()
class Settings:
    """Unified application settings with caching"""
    
    def __init__(self):
        self.environment = os.getenv('ENV', 'development')
        self.debug = self.environment == 'development'
        self.testing = os.getenv('TESTING', 'false').lower() == 'true'
        
        # Initialize all configuration modules
        self.security = SecurityConfig()
        self.database = DatabaseConfig()
        self.ai_services = AIServiceConfig()
        self.social_platforms = SocialPlatformConfig()
        self.payments = PaymentConfig()
        self.cache = CacheConfig()
        self.analytics = AnalyticsConfig()
        self.i18n = InternationalizationConfig()
        self.security_constraints = SecurityConstraints()
        self.performance = PerformanceConfig()
    
    @property
    def app_config(self) -> Dict[str, Any]:
        """Core application configuration"""
        return {
            'name': 'ONXLink',
            'version': os.getenv('APP_VERSION', '1.0.0'),
            'environment': self.environment,
            'debug': self.debug,
            'testing': self.testing,
            'host': os.getenv('HOST', '0.0.0.0'),
            'port': int(os.getenv('PORT', '8000')),
            'cors_origins': os.getenv('CORS_ORIGINS', '*').split(','),
            'timezone': os.getenv('TIMEZONE', 'UTC'),
            'log_level': os.getenv('LOG_LEVEL', 'INFO'),
            'workers': int(os.getenv('WORKERS', '1')),
            'max_request_size': 50 * 1024 * 1024,  # 50MB
            'docs_url': '/docs' if self.debug else None,
            'redoc_url': '/redoc' if self.debug else None
        }
    
    @property
    def offline_capabilities(self) -> Dict[str, Any]:
        """Offline functionality configuration"""
        return {
            'enabled': True,
            'sync_strategies': {
                'immediate': ['user_actions', 'critical_data'],
                'batched': ['analytics', 'content_updates'],
                'scheduled': ['bulk_operations', 'reports']
            },
            'conflict_resolution': {
                'strategy': 'last_write_wins',
                'manual_resolution_required': ['subscription_changes', 'payment_updates']
            },
            'storage_quotas': {
                'freemium': 10 * 1024 * 1024,  # 10MB
                'premium': 100 * 1024 * 1024,  # 100MB
                'enterprise': 1024 * 1024 * 1024  # 1GB
            },
            'preload_data': [
                'user_preferences',
                'platform_templates',
                'common_hashtags',
                'content_categories'
            ]
        }
    
    def validate_configuration(self) -> List[str]:
        """Validate all configuration settings"""
        errors = []
        
        # Validate required environment variables
        required_vars = [
            'DATABASE_URL', 'JWT_SECRET_KEY', 'ENCRYPTION_KEY'
        ]
        
        for var in required_vars:
            if not os.getenv(var):
                errors.append(f"Missing required environment variable: {var}")
        
        # Validate API keys for production
        if self.environment == 'production':
            api_keys = self.security.api_keys
            for service, key in api_keys.items():
                if not key and service in ['openai', 'stripe', 'firebase']:
                    errors.append(f"Missing production API key for: {service}")
        
        # Validate database connection
        try:
            # This would be tested in actual implementation
            pass
        except Exception as e:
            errors.append(f"Database connection failed: {str(e)}")
        
        return errors

# Global settings instance
settings = Settings()

# Configuration validation on import
config_errors = settings.validate_configuration()
if config_errors and not settings.testing:
    print("Configuration Errors:")
    for error in config_errors:
        print(f"  - {error}")
    if settings.environment == 'production':
        raise SystemExit("Critical configuration errors in production environment")

# Export commonly used configurations
__all__ = [
    'settings',
    'SecurityConfig',
    'DatabaseConfig', 
    'AIServiceConfig',
    'SocialPlatformConfig',
    'PaymentConfig',
    'CacheConfig',
    'AnalyticsConfig',
    'InternationalizationConfig',
    'SecurityConstraints',
    'PerformanceConfig'
]