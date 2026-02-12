// ONXLink - Complete TypeScript Type Definitions
// types/index.ts - Real-world production types with offline support

// ========== CORE APPLICATION TYPES ==========

export interface AppConfig {
  readonly version: string;
  readonly buildNumber: string;
  readonly environment: 'development' | 'staging' | 'production';
  readonly apiBaseUrl: string;
  readonly websocketUrl: string;
  readonly supportedLanguages: Language[];
  readonly defaultLanguage: Language;
  readonly features: FeatureFlags;
  readonly thirdPartyKeys: ThirdPartyKeys;
}

export interface FeatureFlags {
  readonly aiInfluencerCreation: boolean;
  readonly predictiveInventory: boolean;
  readonly culturalAdaptation: boolean;
  readonly voiceCloning: boolean;
  readonly anticipatoryShipping: boolean;
  readonly realtimeTrendAnalysis: boolean;
  readonly bulkOperations: boolean;
  readonly advancedAnalytics: boolean;
  readonly enterpriseTeamManagement: boolean;
  readonly apiAccess: boolean;
  readonly whiteLabel: boolean;
  readonly customIntegrations: boolean;
}

export interface ThirdPartyKeys {
  readonly firebase: FirebaseConfig;
  readonly openai: string;
  readonly claude: string;
  readonly huggingface: string;
  readonly paddleVendorId: string;
  readonly stripePublishableKey: string;
  readonly googleAnalytics: string;
  readonly mixpanel: string;
  readonly sentry: string;
}

export interface FirebaseConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly storageBucket: string;
  readonly messagingSenderId: string;
  readonly appId: string;
  readonly measurementId: string;
}

// ========== USER & AUTHENTICATION TYPES ==========

export interface User {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly photoURL?: string;
  readonly phoneNumber?: string;
  readonly emailVerified: boolean;
  readonly createdAt: Date;
  readonly lastLoginAt: Date;
  readonly profile: UserProfile;
  readonly subscription: UserSubscription;
  readonly preferences: UserPreferences;
  readonly security: UserSecurity;
  readonly metadata: UserMetadata;
}

export interface UserProfile {
  readonly firstName: string;
  readonly lastName: string;
  readonly username: string;
  readonly bio?: string;
  readonly website?: string;
  readonly location?: string;
  readonly timezone: string;
  readonly avatarUrl?: string;
  readonly dateOfBirth?: Date;
  readonly gender?: 'male' | 'female' | 'other' | 'prefer-not-to-say';
  readonly profession?: string;
  readonly company?: string;
  readonly industry?: string;
}

export interface UserSubscription {
  readonly tier: SubscriptionTier;
  readonly status: SubscriptionStatus;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly cancelAtPeriodEnd: boolean;
  readonly trialEnd?: Date;
  readonly customerId: string;
  readonly subscriptionId: string;
  readonly paymentMethodId?: string;
  readonly usage: SubscriptionUsage;
  readonly features: SubscriptionFeatures;
  readonly billing: BillingInfo;
}

export interface UserPreferences {
  readonly language: Language;
  readonly theme: ThemeMode;
  readonly notifications: NotificationPreferences;
  readonly privacy: PrivacySettings;
  readonly accessibility: AccessibilitySettings;
  readonly contentFilters: ContentFilterSettings;
  readonly autoSave: boolean;
  readonly offlineMode: boolean;
  readonly dataUsage: DataUsageSettings;
}

export interface UserSecurity {
  readonly mfaEnabled: boolean;
  readonly biometricEnabled: boolean;
  readonly lastPasswordChange: Date;
  readonly trustedDevices: TrustedDevice[];
  readonly loginHistory: LoginHistory[];
  readonly securityQuestions: SecurityQuestion[];
  readonly recoveryEmail?: string;
  readonly recoveryPhone?: string;
}

export interface UserMetadata {
  readonly totalPosts: number;
  readonly totalInfluencers: number;
  readonly totalRevenue: number;
  readonly accountAge: number;
  readonly lastActive: Date;
  readonly deviceInfo: DeviceInfo;
  readonly referralCode: string;
  readonly referredBy?: string;
  readonly achievements: Achievement[];
  readonly badges: Badge[];
}

// ========== SUBSCRIPTION TYPES ==========

export type SubscriptionTier = 'freemium' | 'premium' | 'enterprise';

export type SubscriptionStatus = 
  | 'active' 
  | 'canceled' 
  | 'expired' 
  | 'past_due' 
  | 'unpaid' 
  | 'trialing'
  | 'paused';

export interface SubscriptionUsage {
  readonly platformsUsed: number;
  readonly postsThisMonth: number;
  readonly influencersCreated: number;
  readonly contentVariationsGenerated: number;
  readonly culturalAdaptationsUsed: number;
  readonly apiCallsUsed: number;
  readonly storageUsed: number; // in MB
  readonly bandwidthUsed: number; // in GB
  readonly teamMembers: number;
  readonly limits: SubscriptionLimits;
}

export interface SubscriptionLimits {
  readonly maxPlatforms: number;
  readonly maxPostsPerMonth: number;
  readonly maxInfluencers: number;
  readonly maxContentVariations: number;
  readonly maxCulturalAdaptations: number;
  readonly maxApiCalls: number;
  readonly maxStorage: number; // in MB
  readonly maxBandwidth: number; // in GB
  readonly maxTeamMembers: number;
  readonly maxProjects: number;
}

export interface SubscriptionFeatures {
  readonly autoPosting: boolean;
  readonly aiInfluencers: boolean;
  readonly predictiveInventory: boolean;
  readonly culturalAdaptation: boolean;
  readonly voiceCloning: boolean;
  readonly prioritySupport: boolean;
  readonly advancedAnalytics: boolean;
  readonly teamCollaboration: boolean;
  readonly apiAccess: boolean;
  readonly whiteLabel: boolean;
  readonly customIntegrations: boolean;
  readonly anticipatoryShipping: boolean;
  readonly bulkOperations: boolean;
  readonly realTimeSync: boolean;
  readonly offlineMode: boolean;
}

export interface BillingInfo {
  readonly paymentMethod: PaymentMethod;
  readonly billingAddress: Address;
  readonly taxInfo: TaxInfo;
  readonly invoiceHistory: Invoice[];
  readonly upcomingInvoice?: Invoice;
  readonly paymentHistory: Payment[];
}

// ========== AI & CONTENT TYPES ==========

export interface AIInfluencer {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly bio: string;
  readonly avatar: AIAvatar;
  readonly voice: AIVoice;
  readonly personality: PersonalityProfile;
  readonly demographics: Demographics;
  readonly niche: string[];
  readonly platforms: SocialPlatform[];
  readonly contentStyle: ContentStyle;
  readonly engagement: EngagementMetrics;
  readonly authenticity: AuthenticityScore;
  readonly culturalAdaptation: CulturalProfile;
  readonly compliance: ComplianceProfile;
  readonly createdAt: Date;
  readonly lastUpdated: Date;
  readonly isActive: boolean;
  readonly userId: string;
}

export interface AIAvatar {
  readonly faceModel: FaceModel;
  readonly bodyType: BodyType;
  readonly skinTone: SkinTone;
  readonly hairStyle: HairStyle;
  readonly eyeColor: EyeColor;
  readonly height: number; // in cm
  readonly age: number;
  readonly ethnicity: string;
  readonly style: AvatarStyle;
  readonly accessories: Accessory[];
  readonly variations: AvatarVariation[];
}

export interface AIVoice {
  readonly voiceId: string;
  readonly name: string;
  readonly gender: 'male' | 'female' | 'neutral';
  readonly age: 'child' | 'young' | 'adult' | 'elderly';
  readonly accent: string;
  readonly language: Language;
  readonly pitch: number; // Hz
  readonly speed: number; // words per minute
  readonly emotion: EmotionProfile;
  readonly isCustom: boolean;
  readonly clonedFrom?: string;
  readonly samples: VoiceSample[];
}

export interface ContentGeneration {
  readonly id: string;
  readonly prompt: string;
  readonly platforms: SocialPlatform[];
  readonly contentType: ContentType;
  readonly variations: ContentVariation[];
  readonly culturalAdaptations: CulturalAdaptation[];
  readonly trending: TrendingInsights;
  readonly performance: PerformancePrediction;
  readonly compliance: ComplianceCheck;
  readonly scheduling: SchedulingOptions;
  readonly createdAt: Date;
  readonly userId: string;
  readonly influencerId?: string;
}

export interface ContentVariation {
  readonly id: string;
  readonly platform: SocialPlatform;
  readonly content: Content;
  readonly hashtags: string[];
  readonly mentions: string[];
  readonly media: MediaAsset[];
  readonly optimization: PlatformOptimization;
  readonly culturalAdaptation?: CulturalAdaptation;
  readonly performanceScore: number;
  readonly complianceScore: number;
  readonly engagementPrediction: EngagementPrediction;
}

export interface Content {
  readonly text: string;
  readonly caption?: string;
  readonly title?: string;
  readonly description?: string;
  readonly callToAction?: string;
  readonly link?: string;
  readonly duration?: number; // for video content in seconds
  readonly format: ContentFormat;
  readonly language: Language;
  readonly tone: ContentTone;
  readonly style: ContentStyle;
  readonly wordCount: number;
  readonly readabilityScore: number;
}

// ========== SOCIAL PLATFORM TYPES ==========

export type SocialPlatform = 
  | 'instagram' 
  | 'tiktok' 
  | 'twitter' 
  | 'facebook' 
  | 'youtube' 
  | 'linkedin' 
  | 'pinterest' 
  | 'snapchat'
  | 'reddit'
  | 'discord'
  | 'twitch'
  | 'amazon_live'
  | 'shopify'
  | 'wechat'
  | 'weibo'
  | 'telegram'
  | 'whatsapp'
  | 'clubhouse';

export interface PlatformConnection {
  readonly platform: SocialPlatform;
  readonly accountId: string;
  readonly accountName: string;
  readonly username: string;
  readonly isConnected: boolean;
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenExpiry: Date;
  readonly permissions: PlatformPermission[];
  readonly accountInfo: PlatformAccountInfo;
  readonly lastSync: Date;
  readonly syncStatus: SyncStatus;
  readonly features: PlatformFeatures;
}

export interface PlatformAccountInfo {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly avatar: string;
  readonly followerCount: number;
  readonly followingCount: number;
  readonly postCount: number;
  readonly verified: boolean;
  readonly businessAccount: boolean;
  readonly category?: string;
  readonly website?: string;
  readonly bio?: string;
}

export interface PostingSchedule {
  readonly id: string;
  readonly content: ContentVariation;
  readonly platforms: SocialPlatform[];
  readonly scheduledTime: Date;
  readonly timezone: string;
  readonly status: PostingStatus;
  readonly results: PostingResult[];
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly priority: PostingPriority;
  readonly userId: string;
  readonly createdAt: Date;
}

export type PostingStatus = 
  | 'scheduled' 
  | 'publishing' 
  | 'published' 
  | 'failed' 
  | 'canceled' 
  | 'draft';

export type PostingPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface PostingResult {
  readonly platform: SocialPlatform;
  readonly status: PostingStatus;
  readonly postId?: string;
  readonly postUrl?: string;
  readonly error?: string;
  readonly publishedAt?: Date;
  readonly engagement?: PostEngagement;
}

// ========== E-COMMERCE & INVENTORY TYPES ==========

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly sku: string;
  readonly price: number;
  readonly currency: Currency;
  readonly category: ProductCategory;
  readonly tags: string[];
  readonly images: MediaAsset[];
  readonly variants: ProductVariant[];
  readonly inventory: InventoryInfo;
  readonly seo: SEOInfo;
  readonly shipping: ShippingInfo;
  readonly reviews: ProductReview[];
  readonly analytics: ProductAnalytics;
  readonly source: ProductSource;
  readonly trending: TrendingInfo;
  readonly predictions: InventoryPrediction;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly userId: string;
}

export interface InventoryPrediction {
  readonly demandForecast: DemandForecast;
  readonly trendAnalysis: TrendAnalysis;
  readonly seasonality: SeasonalityData;
  readonly competitorAnalysis: CompetitorAnalysis;
  readonly priceOptimization: PriceOptimization;
  readonly stockRecommendation: StockRecommendation;
  readonly profitabilityScore: number;
  readonly riskAssessment: RiskAssessment;
  readonly lastUpdated: Date;
}

export interface DemandForecast {
  readonly next7Days: number;
  readonly next30Days: number;
  readonly next90Days: number;
  readonly confidence: number;
  readonly factors: DemandFactor[];
  readonly historicalData: HistoricalDemand[];
  readonly socialSignals: SocialDemandSignal[];
  readonly marketTrends: MarketTrend[];
}

// ========== ANALYTICS & PERFORMANCE TYPES ==========

export interface Analytics {
  readonly overview: AnalyticsOverview;
  readonly content: ContentAnalytics;
  readonly social: SocialAnalytics;
  readonly ecommerce: EcommerceAnalytics;
  readonly audience: AudienceAnalytics;
  readonly engagement: EngagementAnalytics;
  readonly conversion: ConversionAnalytics;
  readonly revenue: RevenueAnalytics;
  readonly trends: TrendAnalytics;
  readonly predictions: PredictiveAnalytics;
  readonly period: AnalyticsPeriod;
  readonly lastUpdated: Date;
}

export interface AnalyticsOverview {
  readonly totalPosts: number;
  readonly totalReach: number;
  readonly totalEngagement: number;
  readonly totalRevenue: number;
  readonly growthRate: number;
  readonly topPerformingPlatform: SocialPlatform;
  readonly topPerformingContent: string;
  readonly averageEngagementRate: number;
  readonly conversionRate: number;
  readonly roi: number;
}

export interface EngagementMetrics {
  readonly likes: number;
  readonly comments: number;
  readonly shares: number;
  readonly saves: number;
  readonly clicks: number;
  readonly views: number;
  readonly impressions: number;
  readonly reach: number;
  readonly engagementRate: number;
  readonly viralityScore: number;
  readonly sentiment: SentimentAnalysis;
  readonly demographics: EngagementDemographics;
}

// ========== CULTURAL & LOCALIZATION TYPES ==========

export type Language = 
  | 'en' | 'es' | 'fr' | 'de' | 'zh' | 'ja' | 'ko' 
  | 'ar' | 'ru' | 'pt' | 'it' | 'nl' | 'tr' | 'hi' | 'bn';

export interface CulturalAdaptation {
  readonly language: Language;
  readonly region: string;
  readonly content: Content;
  readonly culturalContext: CulturalContext;
  readonly tabooChecks: TabooCheck[];
  readonly localTrends: LocalTrend[];
  readonly humorStyle: HumorStyle;
  readonly communicationStyle: CommunicationStyle;
  readonly visualAdaptations: VisualAdaptation[];
  readonly complianceChecks: CulturalCompliance[];
  readonly confidenceScore: number;
}

export interface CulturalContext {
  readonly holidays: Holiday[];
  readonly events: CulturalEvent[];
  readonly values: CulturalValue[];
  readonly taboos: Taboo[];
  readonly preferences: CulturalPreference[];
  readonly communicationNorms: CommunicationNorm[];
  readonly visualCues: VisualCue[];
  readonly colorMeanings: ColorMeaning[];
  readonly gestureInterpretations: GestureInterpretation[];
}

// ========== MEDIA & ASSETS TYPES ==========

export interface MediaAsset {
  readonly id: string;
  readonly type: MediaType;
  readonly url: string;
  readonly thumbnailUrl?: string;
  readonly filename: string;
  readonly size: number; // in bytes
  readonly width?: number;
  readonly height?: number;
  readonly duration?: number; // for video/audio in seconds
  readonly format: string;
  readonly quality: MediaQuality;
  readonly metadata: MediaMetadata;
  readonly optimizations: MediaOptimization[];
  readonly watermark?: Watermark;
  readonly uploadedAt: Date;
  readonly userId: string;
}

export type MediaType = 'image' | 'video' | 'audio' | 'gif' | 'document';

export interface MediaOptimization {
  readonly platform: SocialPlatform;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly format: string;
  readonly quality: MediaQuality;
  readonly aspectRatio: string;
  readonly optimizedFor: OptimizationType[];
}

// ========== NOTIFICATION TYPES ==========

export interface NotificationPreferences {
  readonly push: PushNotificationSettings;
  readonly email: EmailNotificationSettings;
  readonly sms: SMSNotificationSettings;
  readonly inApp: InAppNotificationSettings;
  readonly digest: DigestSettings;
  readonly quiet: QuietHoursSettings;
}

export interface Notification {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly message: string;
  readonly data?: Record<string, any>;
  readonly isRead: boolean;
  readonly priority: NotificationPriority;
  readonly category: NotificationCategory;
  readonly actionButtons?: NotificationAction[];
  readonly deliveryChannels: DeliveryChannel[];
  readonly scheduledFor?: Date;
  readonly expiresAt?: Date;
  readonly createdAt: Date;
  readonly userId: string;
}

export type NotificationType = 
  | 'post_published' 
  | 'engagement_milestone' 
  | 'subscription_expiry' 
  | 'payment_failed'
  | 'content_approved'
  | 'trend_alert'
  | 'inventory_low'
  | 'compliance_warning'
  | 'security_alert'
  | 'feature_update'
  | 'maintenance'
  | 'achievement_unlocked';

// ========== OFFLINE & SYNC TYPES ==========

export interface OfflineData {
  readonly lastSync: Date;
  readonly pendingSync: PendingSyncItem[];
  readonly cachedContent: CachedContent[];
  readonly offlineCapabilities: OfflineCapability[];
  readonly syncStatus: SyncStatus;
  readonly conflictResolution: ConflictResolution;
  readonly storageQuota: StorageQuota;
}

export interface PendingSyncItem {
  readonly id: string;
  readonly type: SyncItemType;
  readonly action: SyncAction;
  readonly data: any;
  readonly timestamp: Date;
  readonly retryCount: number;
  readonly priority: SyncPriority;
  readonly dependencies: string[];
}

export type SyncItemType = 
  | 'post' 
  | 'influencer' 
  | 'content' 
  | 'analytics' 
  | 'settings' 
  | 'media'
  | 'schedule'
  | 'connection';

export type SyncAction = 'create' | 'update' | 'delete' | 'sync';

export type SyncPriority = 'low' | 'normal' | 'high' | 'critical';

export interface CachedContent {
  readonly key: string;
  readonly data: any;
  readonly timestamp: Date;
  readonly expiry: Date;
  readonly size: number;
  readonly accessCount: number;
  readonly lastAccessed: Date;
  readonly tags: string[];
  readonly compressed: boolean;
}

// ========== API & REQUEST TYPES ==========

export interface ApiResponse<T = any> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: ApiError;
  readonly message?: string;
  readonly timestamp: Date;
  readonly requestId: string;
  readonly pagination?: PaginationInfo;
  readonly metadata?: ResponseMetadata;
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, any>;
  readonly field?: string;
  readonly timestamp: Date;
  readonly requestId: string;
  readonly retryable: boolean;
  readonly statusCode: number;
}

export interface PaginationInfo {
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly nextCursor?: string;
  readonly previousCursor?: string;
}

export interface RequestConfig {
  readonly timeout: number;
  readonly retries: number;
  readonly retryDelay: number;
  readonly cache: boolean;
  readonly cacheDuration: number;
  readonly offline: boolean;
  readonly priority: RequestPriority;
  readonly compression: boolean;
  readonly authentication: boolean;
  readonly rateLimit: RateLimitConfig;
}

// ========== SECURITY & PRIVACY TYPES ==========

export interface SecuritySettings {
  readonly passwordPolicy: PasswordPolicy;
  readonly sessionTimeout: number;
  readonly ipWhitelist: string[];
  readonly deviceLimit: number;
  readonly encryptionEnabled: boolean;
  readonly auditLogging: boolean;
  readonly failedLoginLimit: number;
  readonly lockoutDuration: number;
  readonly securityNotifications: boolean;
  readonly dataRetention: DataRetentionPolicy;
}

export interface PrivacySettings {
  readonly profileVisibility: VisibilityLevel;
  readonly analyticsOptOut: boolean;
  readonly marketingOptOut: boolean;
  readonly dataSharing: DataSharingSettings;
  readonly cookieConsent: CookieConsentSettings;
  readonly rightToErasure: boolean;
  readonly dataPortability: boolean;
  readonly consentWithdrawal: ConsentSettings;
  readonly thirdPartySharing: ThirdPartySettings;
}

export interface AuditLog {
  readonly id: string;
  readonly userId: string;
  readonly action: AuditAction;
  readonly resource: string;
  readonly resourceId: string;
  readonly details: Record<string, any>;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly location?: GeoLocation;
  readonly success: boolean;
  readonly error?: string;
  readonly timestamp: Date;
  readonly sessionId: string;
}

// ========== HELPER & UTILITY TYPES ==========

export interface ThemeColors {
  readonly primary: string;
  readonly primaryDark: string;
  readonly primaryLight: string;
  readonly secondary: string;
  readonly accent: string;
  readonly background: string;
  readonly surface: string;
  readonly error: string;
  readonly warning: string;
  readonly info: string;
  readonly success: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly border: string;
  readonly disabled: string;
  readonly placeholder: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export interface Address {
  readonly street: string;
  readonly city: string;
  readonly state: string;
  readonly country: string;
  readonly postalCode: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface GeoLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy: number;
  readonly altitude?: number;
  readonly altitudeAccuracy?: number;
  readonly heading?: number;
  readonly speed?: number;
  readonly timestamp: Date;
}

export interface DeviceInfo {
  readonly platform: 'ios' | 'android' | 'web' | 'desktop';
  readonly version: string;
  readonly model: string;
  readonly manufacturer: string;
  readonly osVersion: string;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly userAgent: string;
  readonly language: string;
  readonly timezone: string;
  readonly networkType: NetworkType;
  readonly batteryLevel?: number;
  readonly isCharging?: boolean;
}

export type NetworkType = 
  | 'wifi' 
  | 'cellular' 
  | 'ethernet' 
  | 'unknown' 
  | 'none';

// ========== FORM & VALIDATION TYPES ==========

export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: ValidationError[];
  readonly warnings: ValidationWarning[];
  readonly score?: number;
  readonly suggestions: string[];
}

export interface ValidationError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly context?: Record<string, any>;
}

export interface ValidationWarning {
  readonly field: string;
  readonly code: string;
  readonly message: string;
  readonly suggestion?: string;
  readonly context?: Record<string, any>;
}

export interface FormField<T = any> {
  readonly name: string;
  readonly label: string;
  readonly type: FormFieldType;
  readonly value: T;
  readonly defaultValue: T;
  readonly placeholder?: string;
  readonly helpText?: string;
  readonly required: boolean;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly validation: ValidationRule[];
  readonly options?: FormFieldOption[];
  readonly dependencies?: FormFieldDependency[];
  readonly conditional?: ConditionalLogic;
}

export type FormFieldType = 
  | 'text' 
  | 'email' 
  | 'password' 
  | 'number' 
  | 'tel' 
  | 'url'
  | 'textarea' 
  | 'select' 
  | 'multiselect' 
  | 'radio' 
  | 'checkbox'
  | 'switch' 
  | 'slider' 
  | 'date' 
  | 'time' 
  | 'datetime'
  | 'file' 
  | 'image' 
  | 'color' 
  | 'range';

// ========== SEARCH & FILTER TYPES ==========

export interface SearchQuery {
  readonly query: string;
  readonly filters: SearchFilter[];
  readonly sort: SortOption[];
  readonly pagination: SearchPagination;
  readonly facets: string[];
  readonly highlighting: boolean;
  readonly suggestions: boolean;
  readonly fuzzy: boolean;
  readonly language?: Language;
}

export interface SearchFilter {
  readonly field: string;
  readonly operator: FilterOperator;
  readonly value: any;
  readonly values?: any[];
  readonly range?: FilterRange;
  readonly nested?: SearchFilter[];
  readonly boost?: number;
}

export type FilterOperator = 
  | 'equals' 
  | 'not_equals' 
  | 'contains' 
  | 'not_contains'
  | 'starts_with' 
  | 'ends_with' 
  | 'greater_than' 
  | 'less_than'
  | 'greater_equal' 
  | 'less_equal' 
  | 'between' 
  | 'in' 
  | 'not_in'
  | 'exists' 
  | 'not_exists' 
  | 'regex' 
  | 'fuzzy';

export interface SortOption {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
  readonly boost?: number;
  readonly nullsFirst?: boolean;
}

// ========== EXPORT & IMPORT TYPES ==========

export interface ExportConfig {
  readonly format: ExportFormat;
  readonly fields: string[];
  readonly filters: ExportFilter[];
  readonly dateRange: DateRange;
  readonly compression: boolean;
  readonly password?: string;
  readonly watermark?: boolean;
  readonly includeMedia: boolean;
  readonly chunkSize: number;
  readonly metadata: ExportMetadata;
}

export type ExportFormat = 
  | 'json' 
  | 'csv' 
  | 'xlsx' 
  | 'pdf' 
  | 'xml' 
  | 'yaml'
  | 'zip' 
  | 'tar' 
  | 'sql';

export interface ImportConfig {
  readonly format: ImportFormat;
  readonly mapping: FieldMapping[];
  readonly validation: boolean;
  readonly skipErrors: boolean;
  readonly chunkSize: number;
  readonly dryRun: boolean;
  readonly overwrite: boolean;
  readonly backup: boolean;
  readonly notifications: boolean;
}

// ========== WEBHOOK & INTEGRATION TYPES ==========

export interface Webhook {
  readonly id: string;
  readonly url: string;
  readonly events: WebhookEvent[];
  readonly headers: Record<string, string>;
  readonly secret: string;
  readonly active: boolean;
  readonly retryPolicy: WebhookRetryPolicy;
  readonly authentication: WebhookAuth;
  readonly timeout: number;
  readonly rateLimit: number;
  readonly createdAt: Date;
  readonly userId: string;
}

export type WebhookEvent = 
  | 'post.created' 
  | 'post.published' 
  | 'post.failed'
  | 'influencer.created' 
  | 'analytics.updated' 
  | 'subscription.changed'
  | 'user.registered' 
  | 'payment.succeeded' 
  | 'payment.failed';

export interface Integration {
  readonly id: string;
  readonly name: string;
  readonly type: IntegrationType;
  readonly provider: string;
  readonly config: IntegrationConfig;
  readonly credentials: IntegrationCredentials;
  readonly status: IntegrationStatus;
  readonly lastSync: Date;
  readonly syncFrequency: number;
  readonly features: IntegrationFeature[];
  readonly webhooks: Webhook[];
  readonly logs: IntegrationLog[];
  readonly userId: string;
}

// ========== CONSTANTS ==========

export const SUBSCRIPTION_TIERS: Record<SubscriptionTier, SubscriptionLimits> = {
  freemium: {
    maxPlatforms: 5,
    maxPostsPerMonth: 50,
    maxInfluencers: 1,
    maxContentVariations: 10,
    maxCulturalAdaptations: 0,
    maxApiCalls: 100,
    maxStorage: 100,   // 100 MB
    maxBandwidth: 1,   // 1 GB
    maxTeamMembers: 1,
    maxProjects: 3
  },
  premium: {
    maxPlatforms: 50,
    maxPostsPerMonth: 1000,
    maxInfluencers: 3,
    maxContentVariations: 500,
    maxCulturalAdaptations: 100,
    maxApiCalls: 10000,
    maxStorage: 1024,   // 1 GB
    maxBandwidth: 10,   // 10 GB
    maxTeamMembers: 5,
    maxProjects: 20
  },
  enterprise: {
    maxPlatforms: Number.MAX_SAFE_INTEGER,
    maxPostsPerMonth: Number.MAX_SAFE_INTEGER,
    maxInfluencers: Number.MAX_SAFE_INTEGER,
    maxContentVariations: Number.MAX_SAFE_INTEGER,
    maxCulturalAdaptations: Number.MAX_SAFE_INTEGER,
    maxApiCalls: Number.MAX_SAFE_INTEGER,
    maxStorage: Number.MAX_SAFE_INTEGER,
    maxBandwidth: Number.MAX_SAFE_INTEGER,
    maxTeamMembers: 100,
    maxProjects: Number.MAX_SAFE_INTEGER
  }
};

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  aiInfluencerCreation: true,
  predictiveInventory: true,
  culturalAdaptation: true,
  voiceCloning: false,
  anticipatoryShipping: false,
  realtimeTrendAnalysis: false,
  bulkOperations: false,
  advancedAnalytics: false,
  enterpriseTeamManagement: false,
  apiAccess: false,
  whiteLabel: false,
  customIntegrations: false
};

export const OFFLINE_CAPABILITIES: OfflineCapability[] = [
  'contentDrafting',
  'postScheduling',
  'analyticsViewing',
  'influencerEditing',
  'profileManagement',
  'cachedContentAccess'
];

// ========== ENUMERATIONS ==========

export enum OfflineCapability {
  ContentDrafting = 'contentDrafting',
  PostScheduling = 'postScheduling',
  AnalyticsViewing = 'analyticsViewing',
  InfluencerEditing = 'influencerEditing',
  ProfileManagement = 'profileManagement',
  CachedContentAccess = 'cachedContentAccess',
  MediaBrowsing = 'mediaBrowsing',
  SettingsManagement = 'settingsManagement'
}

export enum MediaQuality {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Ultra = 'ultra'
}

export enum OptimizationType {
  SizeReduction = 'size_reduction',
  FormatConversion = 'format_conversion',
  AspectRatioAdjustment = 'aspect_ratio_adjustment',
  Compression = 'compression',
  QualityOptimization = 'quality_optimization'
}

// ========== SECURITY ENUMS ==========

export enum VisibilityLevel {
  Private = 'private',
  Team = 'team',
  Public = 'public'
}

export enum AuditAction {
  Create = 'create',
  Update = 'update',
  Delete = 'delete',
  Login = 'login',
  Logout = 'logout',
  Access = 'access',
  Purchase = 'purchase',
  SubscriptionChange = 'subscription_change',
  SecurityChange = 'security_change'
}

// ========== NOTIFICATION ENUMS ==========

export enum NotificationPriority {
  Low = 'low',
  Normal = 'normal',
  High = 'high',
  Critical = 'critical'
}

export enum NotificationCategory {
  System = 'system',
  Social = 'social',
  Commerce = 'commerce',
  Security = 'security',
  Subscription = 'subscription',
  Performance = 'performance'
}

export enum DeliveryChannel {
  Push = 'push',
  Email = 'email',
  Sms = 'sms',
  InApp = 'in_app',
  Webhook = 'webhook'
}

// ========== SUBSCRIPTION ENUMS ==========

export enum PaymentMethod {
  CreditCard = 'credit_card',
  PayPal = 'paypal',
  ApplePay = 'apple_pay',
  GooglePay = 'google_pay',
  Crypto = 'crypto',
  BankTransfer = 'bank_transfer'
}

// ========== CULTURAL ENUMS ==========

export enum CulturalPreference {
  HighContext = 'high_context',
  LowContext = 'low_context',
  Formal = 'formal',
  Informal = 'informal',
  Direct = 'direct',
  Indirect = 'indirect',
  RelationshipFocused = 'relationship_focused',
  TaskFocused = 'task_focused'
}

// ========== ADDITIONAL TYPES FOR COMPLETENESS ==========

export interface SecurityQuestion {
  question: string;
  answerHash: string;
  createdAt: Date;
  lastUsed: Date;
}

export interface TrustedDevice {
  deviceId: string;
  deviceName: string;
  lastUsed: Date;
  location: GeoLocation;
}

export interface LoginHistory {
  timestamp: Date;
  ipAddress: string;
  location: GeoLocation;
  deviceInfo: DeviceInfo;
  successful: boolean;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlockedAt: Date;
  progress: number;
  target: number;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  awardedAt: Date;
}

export interface Watermark {
  text: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  opacity: number;
  fontSize: number;
  color: string;
}