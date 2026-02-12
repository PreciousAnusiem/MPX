// ONXLink App Constants - Production Ready
// src/utils/constants.ts

export const APP_CONFIG = {
  NAME: 'ONXLink',
  VERSION: '1.0.0',
  BUILD_NUMBER: 1,
  BUNDLE_ID: 'com.onxlink.app',
  DEEP_LINK_SCHEME: 'onxlink://',
  WEB_URL: 'https://onxlink.com',
  SUPPORT_EMAIL: 'support@onxlink.com',
  TERMS_URL: 'https://onxlink.com/terms',
  PRIVACY_URL: 'https://onxlink.com/privacy'
} as const;

export const API_CONFIG = {
  BASE_URL: __DEV__ ? 'https://dev-api.onxlink.com' : 'https://api.onxlink.com',
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  RATE_LIMIT: {
    REQUESTS_PER_MINUTE: 100,
    BURST_LIMIT: 10
  }
} as const;

export const ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    LOGOUT: '/auth/logout',
    REFRESH: '/auth/refresh',
    FORGOT_PASSWORD: '/auth/forgot-password',
    RESET_PASSWORD: '/auth/reset-password',
    VERIFY_EMAIL: '/auth/verify-email',
    MFA_SETUP: '/auth/mfa/setup',
    MFA_VERIFY: '/auth/mfa/verify'
  },
  USER: {
    PROFILE: '/user/profile',
    UPDATE_PROFILE: '/user/update',
    DELETE_ACCOUNT: '/user/delete',
    PREFERENCES: '/user/preferences',
    ACTIVITY_LOG: '/user/activity'
  },
  SUBSCRIPTION: {
    PLANS: '/subscription/plans',
    CURRENT: '/subscription/current',
    PURCHASE: '/subscription/purchase',
    CANCEL: '/subscription/cancel',
    RESTORE: '/subscription/restore',
    WEBHOOK: '/subscription/webhook'
  },
  CONTENT: {
    GENERATE: '/content/generate',
    TEMPLATES: '/content/templates',
    HISTORY: '/content/history',
    VARIATIONS: '/content/variations',
    BULK_DELETE: '/content/bulk-delete'
  },
  SOCIAL: {
    PLATFORMS: '/social/platforms',
    CONNECT: '/social/connect',
    DISCONNECT: '/social/disconnect',
    POST: '/social/post',
    SCHEDULE: '/social/schedule',
    ANALYTICS: '/social/analytics'
  },
  AI_INFLUENCER: {
    CREATE: '/ai-influencer/create',
    LIST: '/ai-influencer/list',
    UPDATE: '/ai-influencer/update',
    DELETE: '/ai-influencer/delete',
    CLONE_VOICE: '/ai-influencer/clone-voice'
  },
  ANALYTICS: {
    DASHBOARD: '/analytics/dashboard',
    ENGAGEMENT: '/analytics/engagement',
    REVENUE: '/analytics/revenue',
    EXPORT: '/analytics/export'
  }
} as const;

export const SUBSCRIPTION_TIERS = {
  FREEMIUM: {
    id: 'freemium',
    name: 'Freemium',
    price: 0,
    currency: 'USD',
    features: {
      platforms: 5,
      ai_influencers: 1,
      content_variations: 10,
      monthly_posts: 50,
      analytics: 'basic',
      support: 'community',
      languages: 3,
      storage_gb: 1,
      ai_generations: 20
    },
    limits: {
      daily_posts: 5,
      api_calls: 100,
      file_uploads: 10,
      team_members: 1
    }
  },
  PREMIUM: {
    id: 'premium',
    name: 'Premium',
    price: 77,
    currency: 'USD',
    period: 'month',
    product_ids: {
      ios: 'com.onxlink.premium.monthly',
      android: 'premium_monthly',
      web: 'premium_plan_monthly'
    },
    features: {
      platforms: 50,
      ai_influencers: 3,
      content_variations: 100,
      monthly_posts: 1000,
      analytics: 'advanced',
      support: 'priority',
      languages: 15,
      storage_gb: 50,
      ai_generations: 500,
      predictive_inventory: true,
      cultural_adaptation: true,
      voice_cloning: false,
      anticipatory_shipping: false
    },
    limits: {
      daily_posts: 50,
      api_calls: 1000,
      file_uploads: 100,
      team_members: 3
    }
  },
  ENTERPRISE: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 777,
    currency: 'USD',
    period: 'year',
    product_ids: {
      ios: 'com.onxlink.enterprise.yearly',
      android: 'enterprise_yearly',
      web: 'enterprise_plan_yearly'
    },
    features: {
      platforms: -1, // unlimited
      ai_influencers: -1, // unlimited
      content_variations: -1, // unlimited
      monthly_posts: -1, // unlimited
      analytics: 'enterprise',
      support: '24/7',
      languages: 15,
      storage_gb: -1, // unlimited
      ai_generations: -1, // unlimited
      predictive_inventory: true,
      cultural_adaptation: true,
      voice_cloning: true,
      anticipatory_shipping: true,
      api_access: true,
      white_label: true,
      custom_integrations: true
    },
    limits: {
      daily_posts: -1, // unlimited
      api_calls: -1, // unlimited
      file_uploads: -1, // unlimited
      team_members: 50
    }
  }
} as const;

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸', rtl: false },
  { code: 'es', name: 'Español', flag: '🇪🇸', rtl: false },
  { code: 'fr', name: 'Français', flag: '🇫🇷', rtl: false },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪', rtl: false },
  { code: 'zh', name: '中文', flag: '🇨🇳', rtl: false },
  { code: 'ja', name: '日本語', flag: '🇯🇵', rtl: false },
  { code: 'ko', name: '한국어', flag: '🇰🇷', rtl: false },
  { code: 'ar', name: 'العربية', flag: '🇸🇦', rtl: true },
  { code: 'ru', name: 'Русский', flag: '🇷🇺', rtl: false },
  { code: 'pt', name: 'Português', flag: '🇧🇷', rtl: false },
  { code: 'it', name: 'Italiano', flag: '🇮🇹', rtl: false },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱', rtl: false },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷', rtl: false },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳', rtl: false },
  { code: 'bn', name: 'বাংলা', flag: '🇧🇩', rtl: false }
] as const;

export const SOCIAL_PLATFORMS = {
  INSTAGRAM: {
    id: 'instagram',
    name: 'Instagram',
    icon: '📷',
    color: '#E4405F',
    maxChars: 2200,
    supportedFormats: ['image', 'video', 'carousel'],
    apiUrl: 'https://graph.instagram.com',
    scopes: ['instagram_basic', 'instagram_content_publish']
  },
  TIKTOK: {
    id: 'tiktok',
    name: 'TikTok',
    icon: '🎵',
    color: '#000000',
    maxChars: 300,
    supportedFormats: ['video'],
    apiUrl: 'https://open-api.tiktok.com',
    scopes: ['video.upload', 'user.info.basic']
  },
  TWITTER: {
    id: 'twitter',
    name: 'Twitter',
    icon: '🐦',
    color: '#1DA1F2',
    maxChars: 280,
    supportedFormats: ['text', 'image', 'video'],
    apiUrl: 'https://api.twitter.com/2',
    scopes: ['tweet.read', 'tweet.write', 'users.read']
  },
  FACEBOOK: {
    id: 'facebook',
    name: 'Facebook',
    icon: '📘',
    color: '#1877F2',
    maxChars: 63206,
    supportedFormats: ['text', 'image', 'video', 'link'],
    apiUrl: 'https://graph.facebook.com',
    scopes: ['pages_manage_posts', 'pages_read_engagement']
  },
  LINKEDIN: {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: '💼',
    color: '#0A66C2',
    maxChars: 3000,
    supportedFormats: ['text', 'image', 'video', 'article'],
    apiUrl: 'https://api.linkedin.com/v2',
    scopes: ['w_member_social', 'r_liteprofile']
  },
  YOUTUBE: {
    id: 'youtube',
    name: 'YouTube',
    icon: '📺',
    color: '#FF0000',
    maxChars: 5000,
    supportedFormats: ['video'],
    apiUrl: 'https://www.googleapis.com/youtube/v3',
    scopes: ['youtube.upload', 'youtube.readonly']
  },
  PINTEREST: {
    id: 'pinterest',
    name: 'Pinterest',
    icon: '📌',
    color: '#BD081C',
    maxChars: 500,
    supportedFormats: ['image'],
    apiUrl: 'https://api.pinterest.com/v5',
    scopes: ['pins:read', 'pins:write']
  }
} as const;

export const AI_MODELS = {
  CONTENT_GENERATION: {
    GPT4: 'gpt-4-turbo-preview',
    GPT35: 'gpt-3.5-turbo',
    CLAUDE: 'claude-3-sonnet-20240229'
  },
  IMAGE_GENERATION: {
    DALLE3: 'dall-e-3',
    MIDJOURNEY: 'midjourney-v6',
    STABLE_DIFFUSION: 'stable-diffusion-xl'
  },
  VOICE_CLONING: {
    ELEVENLABS: 'eleven-labs-v2',
    AZURE_NEURAL: 'azure-neural-voice'
  }
} as const;

export const CONTENT_TYPES = {
  POST: 'post',
  STORY: 'story',
  REEL: 'reel',
  VIDEO: 'video',
  CAROUSEL: 'carousel',
  ARTICLE: 'article'
} as const;

export const POST_STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  FAILED: 'failed',
  ARCHIVED: 'archived'
} as const;

export const ANALYTICS_PERIODS = {
  LAST_24H: '24h',
  LAST_7D: '7d',
  LAST_30D: '30d',
  LAST_90D: '90d',
  LAST_YEAR: '1y',
  ALL_TIME: 'all'
} as const;

export const STORAGE_KEYS = {
  // Authentication
  ACCESS_TOKEN: '@onxlink/access_token',
  REFRESH_TOKEN: '@onxlink/refresh_token',
  USER_PROFILE: '@onxlink/user_profile',
  BIOMETRIC_ENABLED: '@onxlink/biometric_enabled',
  
  // App Settings
  THEME_MODE: '@onxlink/theme_mode',
  LANGUAGE: '@onxlink/language',
  NOTIFICATIONS_ENABLED: '@onxlink/notifications',
  ANALYTICS_ENABLED: '@onxlink/analytics',
  
  // Cache
  CACHED_CONTENT: '@onxlink/cached_content',
  DRAFT_POSTS: '@onxlink/draft_posts',
  TEMPLATES: '@onxlink/templates',
  PLATFORM_CONNECTIONS: '@onxlink/platforms',
  
  // Offline Data
  OFFLINE_QUEUE: '@onxlink/offline_queue',
  LAST_SYNC: '@onxlink/last_sync',
  CACHED_ANALYTICS: '@onxlink/cached_analytics'
} as const;

export const THEME_COLORS = {
  // Brand Colors
  PRIMARY: '#6C5CE7',
  PRIMARY_DARK: '#5A4FCF',
  PRIMARY_LIGHT: '#A29BFE',
  
  // Accent Colors
  ELECTRIC_BLUE: '#00CEC9',
  CORAL_PINK: '#FD79A8',
  SUNSET_ORANGE: '#FDCB6E',
  
  // Tier Colors
  FREEMIUM: '#B2BEC3',
  PREMIUM: '#6C5CE7',
  ENTERPRISE: '#2D3436',
  
  // Neutral Colors
  WHITE: '#FFFFFF',
  BLACK: '#000000',
  BACKGROUND_LIGHT: '#F8F9FA',
  BACKGROUND_DARK: '#1A1A1A',
  CARD_LIGHT: '#FFFFFF',
  CARD_DARK: '#2D2D2D',
  BORDER_LIGHT: '#E9ECEF',
  BORDER_DARK: '#404040',
  TEXT_PRIMARY_LIGHT: '#2D3436',
  TEXT_PRIMARY_DARK: '#FFFFFF',
  TEXT_SECONDARY_LIGHT: '#636E72',
  TEXT_SECONDARY_DARK: '#A8A8A8',
  TEXT_MUTED_LIGHT: '#B2BEC3',
  TEXT_MUTED_DARK: '#6C757D',
  
  // Status Colors
  SUCCESS: '#00B894',
  ERROR: '#E17055',
  WARNING: '#FDCB6E',
  INFO: '#74B9FF'
} as const;

export const ANIMATION_CONFIG = {
  DURATION: {
    FAST: 200,
    NORMAL: 300,
    SLOW: 500,
    SPLASH: 2000
  },
  EASING: {
    EASE_IN: 'ease-in',
    EASE_OUT: 'ease-out',
    EASE_IN_OUT: 'ease-in-out',
    SPRING: 'spring'
  }
} as const;

export const TYPOGRAPHY = {
  FONT_SIZES: {
    XXS: 10,
    XS: 12,
    SM: 14,
    MD: 16,
    LG: 18,
    XL: 20,
    XXL: 24,
    XXXL: 32,
    HERO: 48
  },
  FONT_WEIGHTS: {
    LIGHT: '300',
    REGULAR: '400',
    MEDIUM: '500',
    SEMIBOLD: '600',
    BOLD: '700',
    EXTRABOLD: '800'
  },
  LINE_HEIGHTS: {
    TIGHT: 1.2,
    NORMAL: 1.4,
    RELAXED: 1.6,
    LOOSE: 1.8
  }
} as const;

export const SPACING = {
  XS: 4,
  SM: 8,
  MD: 16,
  LG: 24,
  XL: 32,
  XXL: 48,
  XXXL: 64
} as const;

export const BORDER_RADIUS = {
  SM: 4,
  MD: 8,
  LG: 12,
  XL: 16,
  ROUND: 50
} as const;

export const SHADOW_CONFIG = {
  LIGHT: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2
  },
  MEDIUM: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4
  },
  HEAVY: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8
  }
} as const;

export const PERFORMANCE_CONFIG = {
  IMAGE_CACHE_SIZE: 100, // MB
  MAX_CONCURRENT_REQUESTS: 5,
  DEBOUNCE_DELAY: 300,
  PAGINATION_SIZE: 20,
  VIRTUAL_LIST_THRESHOLD: 50,
  MEMORY_WARNING_THRESHOLD: 0.8 // 80%
} as const;

export const SECURITY_CONFIG = {
  SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours
  INACTIVITY_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION: 15 * 60 * 1000, // 15 minutes
  PASSWORD_MIN_LENGTH: 8,
  REQUIRE_SPECIAL_CHARS: true,
  REQUIRE_NUMBERS: true,
  REQUIRE_UPPERCASE: true,
  MFA_BACKUP_CODES: 10,
  BIOMETRIC_FALLBACK_ATTEMPTS: 3
} as const;

export const OFFLINE_CONFIG = {
  MAX_QUEUE_SIZE: 100,
  SYNC_INTERVAL: 5 * 60 * 1000, // 5 minutes
  RETRY_INTERVALS: [1000, 5000, 15000, 30000], // exponential backoff
  CACHE_EXPIRY: 7 * 24 * 60 * 60 * 1000, // 7 days
  CRITICAL_ACTIONS: ['post_publish', 'subscription_change', 'account_delete']
} as const;

export const ERROR_CODES = {
  // Network Errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  
  // Authentication Errors
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  
  // Subscription Errors
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  TIER_LIMIT_EXCEEDED: 'TIER_LIMIT_EXCEEDED',
  
  // Content Errors
  CONTENT_TOO_LONG: 'CONTENT_TOO_LONG',
  INVALID_FORMAT: 'INVALID_FORMAT',
  AI_GENERATION_FAILED: 'AI_GENERATION_FAILED',
  
  // Platform Errors
  PLATFORM_CONNECTION_FAILED: 'PLATFORM_CONNECTION_FAILED',
  POST_FAILED: 'POST_FAILED',
  RATE_LIMITED: 'RATE_LIMITED'
} as const;

export const NOTIFICATION_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
  MARKETING: 'marketing',
  SYSTEM: 'system',
  SOCIAL: 'social'
} as const;

export const COMPLIANCE_CONFIG = {
  GDPR_ENABLED: true,
  CCPA_ENABLED: true,
  DATA_RETENTION_DAYS: 365,
  AUDIT_LOG_RETENTION_DAYS: 2555, // 7 years
  COOKIE_CONSENT_REQUIRED: true,
  ANALYTICS_OPT_OUT: true,
  RIGHT_TO_DELETE: true,
  DATA_PORTABILITY: true
} as const;

export const FEATURE_FLAGS = {
  VOICE_CLONING: true,
  PREDICTIVE_INVENTORY: true,
  CULTURAL_ADAPTATION: true,
  ANTICIPATORY_SHIPPING: false, // Beta feature
  API_ACCESS: true,
  WHITE_LABEL: false, // Enterprise only
  ADVANCED_ANALYTICS: true,
  BULK_OPERATIONS: true,
  TEAM_COLLABORATION: true,
  CUSTOM_BRANDING: true
} as const;

// Export types for TypeScript
export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;
export type SocialPlatform = keyof typeof SOCIAL_PLATFORMS;
export type ContentType = typeof CONTENT_TYPES[keyof typeof CONTENT_TYPES];
export type PostStatus = typeof POST_STATUS[keyof typeof POST_STATUS];
export type ThemeColor = typeof THEME_COLORS[keyof typeof THEME_COLORS];
export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
export type NotificationType = typeof NOTIFICATION_TYPES[keyof typeof NOTIFICATION_TYPES];

// Helper functions
export const getSubscriptionFeature = (tier: SubscriptionTier, feature: string): any => {
  return SUBSCRIPTION_TIERS[tier]?.features?.[feature as keyof typeof SUBSCRIPTION_TIERS[typeof tier]['features']];
};

export const isFeatureAvailable = (tier: SubscriptionTier, feature: string): boolean => {
  const featureValue = getSubscriptionFeature(tier, feature);
  return featureValue === true || (typeof featureValue === 'number' && featureValue > 0);
};

export const getPlatformConfig = (platformId: string) => {
  return Object.values(SOCIAL_PLATFORMS).find(platform => platform.id === platformId);
};

export const getLanguageByCode = (code: string) => {
  return SUPPORTED_LANGUAGES.find(lang => lang.code === code);
};

export const formatCurrency = (amount: number, currency: string = 'USD'): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2
  }).format(amount);
};

export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
};

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePassword = (password: string): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (password.length < SECURITY_CONFIG.PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${SECURITY_CONFIG.PASSWORD_MIN_LENGTH} characters long`);
  }
  
  if (SECURITY_CONFIG.REQUIRE_UPPERCASE && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (SECURITY_CONFIG.REQUIRE_NUMBERS && !/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (SECURITY_CONFIG.REQUIRE_SPECIAL_CHARS && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

export default {
  APP_CONFIG,
  API_CONFIG,
  ENDPOINTS,
  SUBSCRIPTION_TIERS,
  SUPPORTED_LANGUAGES,
  SOCIAL_PLATFORMS,
  AI_MODELS,
  CONTENT_TYPES,
  POST_STATUS,
  ANALYTICS_PERIODS,
  STORAGE_KEYS,
  THEME_COLORS,
  ANIMATION_CONFIG,
  TYPOGRAPHY,
  SPACING,
  BORDER_RADIUS,
  SHADOW_CONFIG,
  PERFORMANCE_CONFIG,
  SECURITY_CONFIG,
  OFFLINE_CONFIG,
  ERROR_CODES,
  NOTIFICATION_TYPES,
  COMPLIANCE_CONFIG,
  FEATURE_FLAGS
};