import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';
import { Platform, Dimensions, Alert } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Keychain from 'react-native-keychain';
import { SupportedLanguages, UserTier, ContentType, PlatformType } from '../types';

// =============================================================================
// CONSTANTS
// =============================================================================
const ENCRYPTION_KEY = 'ONX_2024_SECURE_KEY_V1';
const STORAGE_PREFIX = 'onxlink_';
const MAX_OFFLINE_CONTENT = 1000;
const CACHE_EXPIRY_HOURS = 24;
const MAX_RETRY_ATTEMPTS = 3;

// =============================================================================
// DEVICE & PLATFORM UTILITIES
// =============================================================================
export const deviceInfo = {
  isIOS: Platform.OS === 'ios',
  isAndroid: Platform.OS === 'android',
  screenWidth: Dimensions.get('window').width,
  screenHeight: Dimensions.get('window').height,
  isTablet: Dimensions.get('window').width > 768,
  isSmallScreen: Dimensions.get('window').width < 375,
  version: Platform.Version,
};

export const getDeviceId = (): string => {
  return `${Platform.OS}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const getScreenDimensions = () => ({
  width: Dimensions.get('window').width,
  height: Dimensions.get('window').height,
  scale: Dimensions.get('window').scale,
});

// =============================================================================
// NETWORK & CONNECTIVITY
// =============================================================================
export const networkUtils = {
  async isConnected(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return state.isConnected === true && state.isInternetReachable === true;
  },

  async getConnectionType(): Promise<string> {
    const state = await NetInfo.fetch();
    return state.type || 'unknown';
  },

  async isHighSpeedConnection(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return state.type === 'wifi' || 
           (state.type === 'cellular' && 
            state.details?.cellularGeneration === '4g');
  },

  subscribeToNetworkChanges(callback: (isConnected: boolean) => void) {
    return NetInfo.addEventListener(state => {
      callback(state.isConnected === true && state.isInternetReachable === true);
    });
  }
};

// =============================================================================
// SECURE STORAGE UTILITIES
// =============================================================================
export const secureStorage = {
  async setSecure(key: string, value: string): Promise<void> {
    try {
      await Keychain.setInternetCredentials(
        `${STORAGE_PREFIX}${key}`,
        key,
        value,
        {
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
        }
      );
    } catch (error) {
      console.error('Secure storage set error:', error);
      throw new Error('Failed to store secure data');
    }
  },

  async getSecure(key: string): Promise<string | null> {
    try {
      const credentials = await Keychain.getInternetCredentials(`${STORAGE_PREFIX}${key}`);
      return credentials ? credentials.password : null;
    } catch (error) {
      console.error('Secure storage get error:', error);
      return null;
    }
  },

  async removeSecure(key: string): Promise<void> {
    try {
      await Keychain.resetInternetCredentials(`${STORAGE_PREFIX}${key}`);
    } catch (error) {
      console.error('Secure storage remove error:', error);
    }
  },

  async hasSecureData(key: string): Promise<boolean> {
    try {
      const credentials = await Keychain.getInternetCredentials(`${STORAGE_PREFIX}${key}`);
      return credentials !== false;
    } catch {
      return false;
    }
  }
};

// =============================================================================
// ENCRYPTION UTILITIES
// =============================================================================
export const encryption = {
  encrypt(text: string): string {
    try {
      return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
    } catch (error) {
      console.error('Encryption error:', error);
      return text; // Fallback to plain text in dev
    }
  },

  decrypt(encryptedText: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedText, ENCRYPTION_KEY);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
      console.error('Decryption error:', error);
      return encryptedText; // Return as-is if decryption fails
    }
  },

  hash(text: string): string {
    return CryptoJS.SHA256(text).toString();
  },

  generateSalt(): string {
    return CryptoJS.lib.WordArray.random(128/8).toString();
  },

  generateSecureKey(): string {
    return CryptoJS.lib.WordArray.random(256/8).toString();
  }
};

// =============================================================================
// CACHE MANAGEMENT
// =============================================================================
export const cacheManager = {
  async set(key: string, data: any, expiryHours: number = CACHE_EXPIRY_HOURS): Promise<void> {
    try {
      const cacheItem = {
        data,
        timestamp: Date.now(),
        expiry: Date.now() + (expiryHours * 60 * 60 * 1000)
      };
      await AsyncStorage.setItem(`${STORAGE_PREFIX}cache_${key}`, JSON.stringify(cacheItem));
    } catch (error) {
      console.error('Cache set error:', error);
    }
  },

  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await AsyncStorage.getItem(`${STORAGE_PREFIX}cache_${key}`);
      if (!cached) return null;

      const cacheItem = JSON.parse(cached);
      if (Date.now() > cacheItem.expiry) {
        await this.remove(key);
        return null;
      }

      return cacheItem.data;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  },

  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(`${STORAGE_PREFIX}cache_${key}`);
    } catch (error) {
      console.error('Cache remove error:', error);
    }
  },

  async clear(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => key.startsWith(`${STORAGE_PREFIX}cache_`));
      await AsyncStorage.multiRemove(cacheKeys);
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  },

  async getCacheSize(): Promise<number> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => key.startsWith(`${STORAGE_PREFIX}cache_`));
      return cacheKeys.length;
    } catch {
      return 0;
    }
  }
};

// =============================================================================
// OFFLINE CONTENT MANAGEMENT
// =============================================================================
export const offlineManager = {
  async saveOfflineContent(contentId: string, content: any, type: ContentType): Promise<void> {
    try {
      const offlineContent = {
        id: contentId,
        content,
        type,
        timestamp: Date.now(),
        accessed: Date.now()
      };

      await AsyncStorage.setItem(
        `${STORAGE_PREFIX}offline_${contentId}`, 
        JSON.stringify(offlineContent)
      );

      // Manage storage limit
      await this.cleanupOldContent();
    } catch (error) {
      console.error('Offline content save error:', error);
    }
  },

  async getOfflineContent<T>(contentId: string): Promise<T | null> {
    try {
      const stored = await AsyncStorage.getItem(`${STORAGE_PREFIX}offline_${contentId}`);
      if (!stored) return null;

      const offlineContent = JSON.parse(stored);
      
      // Update access time
      offlineContent.accessed = Date.now();
      await AsyncStorage.setItem(
        `${STORAGE_PREFIX}offline_${contentId}`, 
        JSON.stringify(offlineContent)
      );

      return offlineContent.content;
    } catch (error) {
      console.error('Offline content get error:', error);
      return null;
    }
  },

  async getAllOfflineContent(): Promise<any[]> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const offlineKeys = keys.filter(key => key.startsWith(`${STORAGE_PREFIX}offline_`));
      
      const contents = await AsyncStorage.multiGet(offlineKeys);
      return contents
        .map(([_, value]) => value ? JSON.parse(value) : null)
        .filter(Boolean)
        .sort((a, b) => b.accessed - a.accessed);
    } catch (error) {
      console.error('Get all offline content error:', error);
      return [];
    }
  },

  async cleanupOldContent(): Promise<void> {
    try {
      const allContent = await this.getAllOfflineContent();
      
      if (allContent.length > MAX_OFFLINE_CONTENT) {
        const toRemove = allContent
          .slice(MAX_OFFLINE_CONTENT)
          .map(content => `${STORAGE_PREFIX}offline_${content.id}`);
        
        await AsyncStorage.multiRemove(toRemove);
      }
    } catch (error) {
      console.error('Cleanup offline content error:', error);
    }
  },

  async getOfflineStorageInfo(): Promise<{count: number, sizeEstimate: string}> {
    try {
      const allContent = await this.getAllOfflineContent();
      const sizeBytes = JSON.stringify(allContent).length;
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
      
      return {
        count: allContent.length,
        sizeEstimate: `${sizeMB} MB`
      };
    } catch {
      return { count: 0, sizeEstimate: '0 MB' };
    }
  },
  
  async isContentAvailable(contentId: string): Promise<boolean> {
    const key = `${STORAGE_PREFIX}offline_${contentId}`;
    return AsyncStorage.getItem(key).then(value => value !== null);
  }
};

// =============================================================================
// VALIDATION UTILITIES
// =============================================================================
export const validators = {
  email(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  password(password: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (password.length < 8) errors.push('Password must be at least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('Password must contain uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('Password must contain lowercase letter');
    if (!/\d/.test(password)) errors.push('Password must contain a number');
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push('Password must contain special character');
    
    return { isValid: errors.length === 0, errors };
  },

  url(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },

  socialHandle(handle: string, platform: PlatformType): boolean {
    const patterns = {
      instagram: /^[a-zA-Z0-9._]{1,30}$/,
      tiktok: /^[a-zA-Z0-9._]{1,24}$/,
      twitter: /^[a-zA-Z0-9_]{1,15}$/,
      youtube: /^[a-zA-Z0-9._-]{1,50}$/,
      facebook: /^[a-zA-Z0-9.]{5,50}$/
    };
    
    return patterns[platform]?.test(handle) || false;
  },

  contentLength(content: string, platform: PlatformType): boolean {
    const limits = {
      instagram: 2200,
      tiktok: 150,
      twitter: 280,
      youtube: 5000,
      facebook: 63206
    };
    
    return content.length <= (limits[platform] || 2200);
  },

  phoneNumber(phone: string): boolean {
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,15}$/;
    return phoneRegex.test(phone);
  },
  
  isJson(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }
};

// =============================================================================
// FORMAT UTILITIES
// =============================================================================
export const formatters = {
  currency(amount: number, currency: string = 'USD'): string {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency
      }).format(amount);
    } catch {
      return `$${amount.toFixed(2)}`;
    }
  },

  number(num: number, locale: string = 'en-US'): string {
    try {
      return new Intl.NumberFormat(locale).format(num);
    } catch {
      return num.toString();
    }
  },

  compactNumber(num: number): string {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  },

  dateTime(date: Date | string, locale: string = 'en-US'): string {
    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(dateObj);
    } catch {
      return 'Invalid date';
    }
  },

  relativeTime(date: Date | string): string {
    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      const now = new Date();
      const diffMs = now.getTime() - dateObj.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return this.dateTime(dateObj);
    } catch {
      return 'Unknown';
    }
  },

  truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  },

  camelToTitle(camelCase: string): string {
    return camelCase
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  },

  slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  },
  
  formatLanguageName(language: SupportedLanguages): string {
    const languageNames: Record<SupportedLanguages, string> = {
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      zh: 'Chinese',
      ja: 'Japanese',
      ko: 'Korean',
      ru: 'Russian',
      ar: 'Arabic',
      pt: 'Portuguese',
      hi: 'Hindi',
      id: 'Indonesian',
      it: 'Italian',
      nl: 'Dutch',
      tr: 'Turkish'
    };
    
    return languageNames[language] || language;
  }
};

// =============================================================================
// USER ENGAGEMENT & RETENTION
// =============================================================================
export const engagement = {
  async trackUserAction(action: string, metadata?: any): Promise<void> {
    try {
      const sessionData = {
        action,
        timestamp: Date.now(),
        metadata,
        sessionId: await this.getCurrentSessionId()
      };

      await cacheManager.set(`user_action_${Date.now()}`, sessionData, 168); // 7 days
      
      // Update engagement metrics
      await this.updateEngagementMetrics(action);
    } catch (error) {
      console.error('Track user action error:', error);
    }
  },

  async updateEngagementMetrics(action: string): Promise<void> {
    try {
      const metrics = await cacheManager.get<any>('engagement_metrics') || {
        dailyActions: 0,
        weeklyActions: 0,
        lastActiveDate: Date.now(),
        streakDays: 0,
        favoriteFeatures: {},
        retentionScore: 0
      };

      metrics.dailyActions += 1;
      metrics.weeklyActions += 1;
      metrics.lastActiveDate = Date.now();
      
      // Track favorite features
      metrics.favoriteFeatures[action] = (metrics.favoriteFeatures[action] || 0) + 1;
      
      // Calculate streak
      const daysDiff = Math.floor((Date.now() - metrics.lastActiveDate) / (1000 * 60 * 60 * 24));
      if (daysDiff <= 1) {
        metrics.streakDays = daysDiff === 1 ? metrics.streakDays + 1 : metrics.streakDays;
      } else {
        metrics.streakDays = 1;
      }

      // Calculate retention score
      metrics.retentionScore = this.calculateRetentionScore(metrics);

      await cacheManager.set('engagement_metrics', metrics, 168);
    } catch (error) {
      console.error('Update engagement metrics error:', error);
    }
  },

  calculateRetentionScore(metrics: any): number {
    const actionScore = Math.min(metrics.dailyActions * 10, 500);
    const streakScore = Math.min(metrics.streakDays * 20, 300);
    const diversityScore = Object.keys(metrics.favoriteFeatures).length * 15;
    
    return Math.min(actionScore + streakScore + diversityScore, 1000);
  },

  async getCurrentSessionId(): Promise<string> {
    let sessionId = await cacheManager.get<string>('current_session_id');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await cacheManager.set('current_session_id', sessionId, 24);
    }
    return sessionId;
  },

  async shouldShowMotivationalMessage(): Promise<boolean> {
    const metrics = await cacheManager.get<any>('engagement_metrics');
    if (!metrics) return true;

    const lastMotivationalShow = await cacheManager.get<number>('last_motivational_show') || 0;
    const daysSinceLastShow = Math.floor((Date.now() - lastMotivationalShow) / (1000 * 60 * 60 * 24));
    
    return daysSinceLastShow >= 3 || metrics.streakDays >= 7;
  },

  async getPersonalizedRecommendations(): Promise<string[]> {
    try {
      const metrics = await cacheManager.get<any>('engagement_metrics');
      if (!metrics) return ['Start creating content', 'Connect social accounts'];

      const recommendations: string[] = [];
      const { favoriteFeatures, dailyActions, streakDays } = metrics;

      // Feature-based recommendations
      const topFeature = Object.keys(favoriteFeatures).reduce((a, b) => 
        favoriteFeatures[a] > favoriteFeatures[b] ? a : b, '');

      if (topFeature === 'content_generation') {
        recommendations.push('Try AI influencer creation', 'Explore cultural adaptation');
      } else if (topFeature === 'social_posting') {
        recommendations.push('Enable predictive inventory', 'Set up auto-posting schedule');
      }

      // Activity-based recommendations
      if (dailyActions < 5) {
        recommendations.push('Generate more content variations', 'Connect additional platforms');
      }

      if (streakDays >= 7) {
        recommendations.push('Unlock premium features', 'Share your progress');
      }

      return recommendations.slice(0, 3);
    } catch {
      return ['Explore new features', 'Create engaging content'];
    }
  },
  
  async resetEngagementMetrics(): Promise<void> {
    await cacheManager.remove('engagement_metrics');
  }
};

// =============================================================================
// ERROR HANDLING & RETRY LOGIC
// =============================================================================
export const errorHandler = {
  async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = MAX_RETRY_ATTEMPTS,
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) break;
        
        // Exponential backoff
        const waitTime = delay * Math.pow(2, attempt - 1);
        await this.sleep(waitTime);
      }
    }

    throw lastError!;
  },

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  async logError(error: Error, context?: string): Promise<void> {
    try {
      const errorLog = {
        message: error.message,
        stack: error.stack,
        context,
        timestamp: Date.now(),
        userId: await secureStorage.getSecure('user_id'),
        deviceInfo: {
          platform: Platform.OS,
          version: Platform.Version
        }
      };

      await cacheManager.set(`error_${Date.now()}`, errorLog, 72); // 3 days
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
  },

  getUserFriendlyMessage(error: Error): string {
    const errorMessages: Record<string, string> = {
      'Network request failed': 'Connection issue. Please check your internet.',
      'Request timeout': 'Request took too long. Please try again.',
      'Unauthorized': 'Please sign in again.',
      'Forbidden': 'You don\'t have permission for this action.',
      'Not Found': 'The requested content was not found.',
      'Internal Server Error': 'Server issue. Please try again later.',
    };

    return errorMessages[error.message] || 'Something went wrong. Please try again.';
  },
  
  async reportCriticalError(error: Error, context: string): Promise<void> {
    await this.logError(error, context);
    Alert.alert(
      'Critical Error',
      this.getUserFriendlyMessage(error),
      [{ text: 'OK', onPress: () => {} }]
    );
  }
};

// =============================================================================
// SUBSCRIPTION & TIER UTILITIES
// =============================================================================
export const subscriptionUtils = {
  getTierFeatures(tier: UserTier): string[] {
    const features = {
      freemium: [
        'Post to 5 platforms',
        '1 basic AI influencer',
        '10 content variations',
        'Basic analytics'
      ],
      premium: [
        'Post to 50+ platforms',
        '3 custom AI influencers',
        '100+ content variations',
        'Cultural adaptation (15 languages)',
        'Predictive inventory alerts',
        'Advanced analytics'
      ],
      enterprise: [
        'Unlimited platforms & AI influencers',
        'Custom voice cloning',
        'Anticipatory shipping AI',
        'Multi-user team management',
        'API access & priority support',
        'White-label solutions'
      ]
    };

    return features[tier] || features.freemium;
  },

  getTierLimits(tier: UserTier): Record<string, number> {
    const limits = {
      freemium: {
        platforms: 5,
        aiInfluencers: 1,
        contentVariations: 10,
        monthlyPosts: 50,
        storageGB: 1
      },
      premium: {
        platforms: 50,
        aiInfluencers: 3,
        contentVariations: 100,
        monthlyPosts: 1000,
        storageGB: 10
      },
      enterprise: {
        platforms: -1, // unlimited
        aiInfluencers: -1,
        contentVariations: -1,
        monthlyPosts: -1,
        storageGB: 100
      }
    };

    return limits[tier] || limits.freemium;
  },

  canAccessFeature(userTier: UserTier, feature: string): boolean {
    const featureRequirements: Record<string, UserTier[]> = {
      'basic_posting': ['freemium', 'premium', 'enterprise'],
      'ai_influencer_basic': ['freemium', 'premium', 'enterprise'],
      'multi_platform': ['premium', 'enterprise'],
      'cultural_adaptation': ['premium', 'enterprise'],
      'predictive_inventory': ['premium', 'enterprise'],
      'voice_cloning': ['enterprise'],
      'api_access': ['enterprise'],
      'team_management': ['enterprise']
    };

    return featureRequirements[feature]?.includes(userTier) || false;
  },

  getUpgradeIncentive(currentTier: UserTier): string {
    const incentives = {
      freemium: 'Unlock 50+ platforms and AI influencers with Premium!',
      premium: 'Get unlimited features and team management with Enterprise!',
      enterprise: 'You have access to all features!'
    };

    return incentives[currentTier];
  },
  
  async getSubscriptionStatus(): Promise<{tier: UserTier, expires: number}> {
    const tier = await secureStorage.getSecure('user_tier') as UserTier || 'freemium';
    const expires = parseInt(await secureStorage.getSecure('subscription_expiry') || '0');
    return { tier, expires };
  }
};

// =============================================================================
// ANALYTICS & TRACKING
// =============================================================================
export const analytics = {
  async trackScreenView(screenName: string): Promise<void> {
    try {
      await engagement.trackUserAction('screen_view', { screenName });
      await this.updateScreenAnalytics(screenName);
    } catch (error) {
      console.error('Track screen view error:', error);
    }
  },

  async updateScreenAnalytics(screenName: string): Promise<void> {
    try {
      const screenAnalytics = await cacheManager.get<any>('screen_analytics') || {};
      
      if (!screenAnalytics[screenName]) {
        screenAnalytics[screenName] = {
          views: 0,
          totalTime: 0,
          lastVisited: Date.now(),
          averageTime: 0
        };
      }

      screenAnalytics[screenName].views += 1;
      screenAnalytics[screenName].lastVisited = Date.now();

      await cacheManager.set('screen_analytics', screenAnalytics, 168);
    } catch (error) {
      console.error('Update screen analytics error:', error);
    }
  },

  async trackFeatureUsage(feature: string, metadata?: any): Promise<void> {
    try {
      await engagement.trackUserAction('feature_usage', { feature, ...metadata });
      
      const featureAnalytics = await cacheManager.get<any>('feature_analytics') || {};
      
      if (!featureAnalytics[feature]) {
        featureAnalytics[feature] = {
          uses: 0,
          lastUsed: Date.now(),
          successRate: 100
        };
      }

      featureAnalytics[feature].uses += 1;
      featureAnalytics[feature].lastUsed = Date.now();

      await cacheManager.set('feature_analytics', featureAnalytics, 168);
    } catch (error) {
      console.error('Track feature usage error:', error);
    }
  },

  async getMostUsedFeatures(): Promise<Array<{feature: string, uses: number}>> {
    try {
      const featureAnalytics = await cacheManager.get<any>('feature_analytics') || {};
      
      return Object.keys(featureAnalytics)
        .map(feature => ({
          feature,
          uses: featureAnalytics[feature].uses
        }))
        .sort((a, b) => b.uses - a.uses)
        .slice(0, 5);
    } catch {
      return [];
    }
  },
  
  async getScreenTimeMetrics(): Promise<Array<{screen: string, views: number}>> {
    try {
      const screenAnalytics = await cacheManager.get<any>('screen_analytics') || {};
      
      return Object.keys(screenAnalytics)
        .map(screen => ({
          screen,
          views: screenAnalytics[screen].views
        }))
        .sort((a, b) => b.views - a.views);
    } catch {
      return [];
    }
  }
};

// =============================================================================
// PERFORMANCE UTILITIES
// =============================================================================
export const performance = {
  debounce<T extends (...args: any[]) => any>(
    func: T,
    delay: number
  ): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout;
    
    return (...args: Parameters<T>) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  },

  throttle<T extends (...args: any[]) => any>(
    func: T,
    limit: number
  ): (...args: Parameters<T>) => void {
    let inThrottle: boolean;
    
    return (...args: Parameters<T>) => {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  async measureExecutionTime<T>(
    operation: () => Promise<T>,
    operationName?: string
  ): Promise<T> {
    const startTime = Date.now();
    const result = await operation();
    const executionTime = Date.now() - startTime;
    
    if (operationName && __DEV__) {
      console.log(`${operationName} took ${executionTime}ms`);
    }
    
    return result;
  },

  memoize<T extends (...args: any[]) => any>(
    func: T,
    getKey?: (...args: Parameters<T>) => string
  ): T {
    const cache = new Map();
    
    return ((...args: Parameters<T>) => {
      const key = getKey ? getKey(...args) : JSON.stringify(args);
      
      if (cache.has(key)) {
        return cache.get(key);
      }
      
      const result = func(...args);
      cache.set(key, result);
      
      return result;
    }) as T;
  }
};

// =============================================================================
// NOTIFICATION UTILITIES
// =============================================================================
export const notifications = {
  async scheduleLocalNotification(
    title: string,
    body: string,
    triggerDate: Date,
    data?: any
  ): Promise<void> {
    try {
      // Implementation would depend on notification library
      // This is a placeholder structure
      const notificationData = {
        id: `notification_${Date.now()}`,
        title,
        body,
        triggerDate: triggerDate.getTime(),
        data,
        scheduled: true
      };

      await cacheManager.set(`notification_${notificationData.id}`, notificationData, 168);
    } catch (error) {
      console.error('Schedule notification error:', error);
    }
  },

  async getScheduledNotifications(): Promise<any[]> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const notificationKeys = keys.filter(key => 
        key.startsWith(`${STORAGE_PREFIX}cache_notification_`)
      );
      
      const notifications = await AsyncStorage.multiGet(notificationKeys);
      const now = Date.now();
      const result = [];
      const expiredKeys = [];

      for (const [key, value] of notifications) {
        if (value) {
          try {
            const cacheItem = JSON.parse(value);
            if (now > cacheItem.expiry) {
              expiredKeys.push(key);
            } else {
              result.push(cacheItem.data);
            }
          } catch (error) {
            expiredKeys.push(key);
          }
        }
      }

      if (expiredKeys.length > 0) {
        await AsyncStorage.multiRemove(expiredKeys);
      }

      return result;
    } catch (error) {
      console.error('Get scheduled notifications error:', error);
      return [];
    }
  },

  async cancelNotification(id: string): Promise<void> {
    await cacheManager.remove(`notification_${id}`);
  },

  async clearAllNotifications(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const notificationKeys = keys.filter(key => 
      key.startsWith(`${STORAGE_PREFIX}cache_notification_`)
    );
    await AsyncStorage.multiRemove(notificationKeys);
  },
  
  async showImmediateNotification(title: string, body: string, data?: any): Promise<void> {
    // In a real implementation, this would trigger the native notification system
    Alert.alert(title, body, [
      { text: 'OK', onPress: () => {} }
    ]);
    
    // Track notification shown
    await engagement.trackUserAction('notification_shown', { title, data });
  }
};

// =============================================================================
// INTERNATIONALIZATION UTILITIES
// =============================================================================
export const i18n = {
  async getCurrentLanguage(): Promise<SupportedLanguages> {
    const lang = await secureStorage.getSecure('user_language');
    return (lang || 'en') as SupportedLanguages;
  },
  
  async setLanguage(language: SupportedLanguages): Promise<void> {
    await secureStorage.setSecure('user_language', language);
    await cacheManager.clear(); // Clear cached language-specific data
  },
  
  getLanguageResources(): Record<SupportedLanguages, any> {
    // In a real implementation, this would load from JSON files
    return {
      en: require('../locales/en.json'),
      es: require('../locales/es.json'),
      fr: require('../locales/fr.json'),
      de: require('../locales/de.json'),
      zh: require('../locales/zh.json'),
      ja: require('../locales/ja.json'),
      ko: require('../locales/ko.json'),
      ru: require('../locales/ru.json'),
      ar: require('../locales/ar.json'),
      pt: require('../locales/pt.json'),
      hi: require('../locales/hi.json'),
      id: require('../locales/id.json'),
      it: require('../locales/it.json'),
      nl: require('../locales/nl.json'),
      tr: require('../locales/tr.json')
    };
  }
};

// =============================================================================
// THEME MANAGEMENT
// =============================================================================
export const themeManager = {
  async getCurrentTheme(): Promise<'light' | 'dark'> {
    return (await secureStorage.getSecure('user_theme') || 'light') as 'light' | 'dark';
  },
  
  async setTheme(theme: 'light' | 'dark'): Promise<void> {
    await secureStorage.setSecure('user_theme', theme);
  },
  
  async toggleTheme(): Promise<'light' | 'dark'> {
    const current = await this.getCurrentTheme();
    const newTheme = current === 'light' ? 'dark' : 'light';
    await this.setTheme(newTheme);
    return newTheme;
  },
  
  getThemeColors(theme: 'light' | 'dark' = 'light') {
    return theme === 'light' ? {
      primary: '#2563eb',
      background: '#ffffff',
      card: '#f8fafc',
      text: '#0f172a',
      border: '#e2e8f0',
      notification: '#dc2626'
    } : {
      primary: '#3b82f6',
      background: '#0f172a',
      card: '#1e293b',
      text: '#f8fafc',
      border: '#334155',
      notification: '#ef4444'
    };
  }
};

// =============================================================================
// API SECURITY UTILITIES
// =============================================================================
export const apiSecurity = {
  async getEncryptedApiKey(): Promise<string> {
    const apiKey = await secureStorage.getSecure('api_key');
    if (!apiKey) throw new Error('API key not available');
    return encryption.encrypt(apiKey);
  },
  
  async refreshApiKey(): Promise<void> {
    // This would call your backend to rotate API keys
    const newKey = encryption.generateSecureKey();
    await secureStorage.setSecure('api_key', newKey);
    await engagement.trackUserAction('api_key_rotated');
  },
  
  async attachAuthHeaders(headers: HeadersInit = {}): Promise<HeadersInit> {
    const token = await secureStorage.getSecure('auth_token');
    return {
      ...headers,
      Authorization: `Bearer ${token}`,
      'X-API-Key': await this.getEncryptedApiKey(),
      'X-Device-Id': getDeviceId(),
      'X-Request-Timestamp': Date.now().toString()
    };
  },
  
  async validateCertificate(response: Response): Promise<boolean> {
    // In a real implementation, this would validate the SSL certificate
    return true;
  }
};

// =============================================================================
// GDPR COMPLIANCE UTILITIES
// =============================================================================
export const gdpr = {
  async deleteUserData(userId: string): Promise<void> {
    // Remove all user-related data
    await secureStorage.removeSecure('user_id');
    await secureStorage.removeSecure('auth_token');
    await secureStorage.removeSecure('api_key');
    await cacheManager.clear();
    await offlineManager.clearAllContent();
    
    // Clear engagement data
    await engagement.resetEngagementMetrics();
    
    // Clear notifications
    await notifications.clearAllNotifications();
  },
  
  async exportUserData(userId: string): Promise<string> {
    // Collect all user data
    const userData = {
      secure: {
        userId: await secureStorage.getSecure('user_id'),
        authToken: await secureStorage.getSecure('auth_token'),
        apiKey: await secureStorage.getSecure('api_key'),
        theme: await themeManager.getCurrentTheme(),
        language: await i18n.getCurrentLanguage()
      },
      cache: await cacheManager.getCacheSize(),
      offlineContent: await offlineManager.getAllOfflineContent(),
      engagement: await cacheManager.get('engagement_metrics'),
      analytics: {
        screens: await analytics.getScreenTimeMetrics(),
        features: await analytics.getMostUsedFeatures()
      }
    };
    
    return JSON.stringify(userData);
  },
  
  async requestDataConsent(): Promise<boolean> {
    // Show consent dialog and store preference
    const consent = true; // Would come from UI dialog
    await secureStorage.setSecure('gdpr_consent', consent.toString());
    return consent;
  }
};

// =============================================================================
// BIOMETRIC AUTHENTICATION
// =============================================================================
export const biometrics = {
  async isAvailable(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    
    try {
      const result = await Keychain.getSupportedBiometryType();
      return result !== null;
    } catch {
      return false;
    }
  },
  
  async authenticate(reason: string = 'Authenticate to continue'): Promise<boolean> {
    try {
      const result = await Keychain.authenticate({
        title: 'Authentication Required',
        subtitle: reason,
        description: '',
        cancel: 'Cancel',
        fallbackTitle: 'Use Password',
        disableDeviceFallback: false
      });
      return result;
    } catch {
      return false;
    }
  },
  
  async storeWithBiometrics(key: string, value: string): Promise<void> {
    await Keychain.setInternetCredentials(
      `${STORAGE_PREFIX}${key}`,
      key,
      value,
      {
        accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
        authenticationType: Keychain.AUTHENTICATION_TYPE.BIOMETRICS,
        securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE
      }
    );
  }
};

// =============================================================================
// OFFLINE SYNC MANAGER
// =============================================================================
export const syncManager = {
  async queueOfflineAction(action: string, payload: any): Promise<void> {
    const queue = await cacheManager.get<any[]>('sync_queue') || [];
    queue.push({
      id: `action_${Date.now()}`,
      action,
      payload,
      timestamp: Date.now(),
      attempts: 0
    });
    await cacheManager.set('sync_queue', queue);
  },
  
  async processQueue(): Promise<void> {
    if (!(await networkUtils.isConnected())) return;
    
    const queue = await cacheManager.get<any[]>('sync_queue') || [];
    const failedActions = [];
    
    for (const action of queue) {
      try {
        // This would call your API to execute the action
        // await apiService.executeAction(action.action, action.payload);
        action.attempts++;
      } catch (error) {
        if (action.attempts < MAX_RETRY_ATTEMPTS) {
          failedActions.push(action);
        }
      }
    }
    
    await cacheManager.set('sync_queue', failedActions);
  },
  
  async getQueueSize(): Promise<number> {
    const queue = await cacheManager.get<any[]>('sync_queue') || [];
    return queue.length;
  }
};

// =============================================================================
// EXPORT ALL UTILITIES
// =============================================================================
export default {
  deviceInfo,
  getDeviceId,
  getScreenDimensions,
  networkUtils,
  secureStorage,
  encryption,
  cacheManager,
  offlineManager,
  validators,
  formatters,
  engagement,
  errorHandler,
  subscriptionUtils,
  analytics,
  performance,
  notifications,
  i18n,
  themeManager,
  apiSecurity,
  gdpr,
  biometrics,
  syncManager
};