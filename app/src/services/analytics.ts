import { analytics } from './firebase';
import { logEvent, setUserId, setUserProperties } from 'firebase/analytics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import CryptoJS from 'crypto-js';

// Types
interface AnalyticsEvent {
  id: string;
  name: string;
  parameters: Record<string, any>;
  timestamp: number;
  userId?: string;
  userTier?: string;
  sessionId: string;
  retryCount: number;
}

interface UserProperties {
  subscription_tier: string;
  language: string;
  country: string;
  app_version: string;
  platform: string;
  registration_date: string;
  last_active: string;
  content_generated_count: number;
  posts_created_count: number;
  ai_influencers_count: number;
}

interface EngagementMetrics {
  session_duration: number;
  feature_usage: Record<string, number>;
  screen_views: Record<string, number>;
  user_actions: Record<string, number>;
  errors_encountered: string[];
}

// Constants
const STORAGE_KEYS = {
  OFFLINE_EVENTS: '@onxlink_offline_events',
  USER_PROPERTIES: '@onxlink_user_properties',
  SESSION_DATA: '@onxlink_session_data',
  ENGAGEMENT_METRICS: '@onxlink_engagement_metrics',
  ANALYTICS_SETTINGS: '@onxlink_analytics_settings'
};

const ENCRYPTION_KEY = 'onxlink_analytics_2024';
const MAX_OFFLINE_EVENTS = 1000;
const BATCH_SIZE = 50;
const RETRY_DELAY = 5000;
const MAX_RETRY_COUNT = 3;

class AnalyticsService {
  private isInitialized = false;
  private currentSessionId: string = '';
  private sessionStartTime: number = 0;
  private offlineQueue: AnalyticsEvent[] = [];
  private retryTimer: NodeJS.Timeout | null = null;
  private isOnline = true;
  private userProperties: Partial<UserProperties> = {};
  private engagementMetrics: EngagementMetrics = {
    session_duration: 0,
    feature_usage: {},
    screen_views: {},
    user_actions: {},
    errors_encountered: []
  };
  private analyticsEnabled = true;
  private consentGiven = false;

  constructor() {
    this.initializeService();
    this.setupNetworkListener();
  }

  // Initialize service
  private async initializeService(): Promise<void> {
    try {
      await this.loadStoredData();
      await this.checkAnalyticsConsent();
      this.generateSessionId();
      this.sessionStartTime = Date.now();
      await this.loadOfflineEvents();
      this.isInitialized = true;
      
      // Track app open
      this.trackEvent('app_open', {
        app_version: this.userProperties.app_version || '1.0.0',
        platform: this.userProperties.platform || 'mobile'
      });
      
    } catch (error) {
      console.error('Analytics initialization failed:', error);
      this.isInitialized = false;
    }
  }

  // Setup network connectivity listener
  private setupNetworkListener(): void {
    NetInfo.addEventListener(state => {
      const wasOffline = !this.isOnline;
      this.isOnline = state.isConnected === true;
      
      if (wasOffline && this.isOnline) {
        this.processOfflineQueue();
      }
    });
  }

  // Check if user has given analytics consent
  private async checkAnalyticsConsent(): Promise<void> {
    try {
      const consent = await AsyncStorage.getItem('@onxlink_analytics_consent');
      this.consentGiven = consent === 'true';
      
      const settings = await AsyncStorage.getItem(STORAGE_KEYS.ANALYTICS_SETTINGS);
      if (settings) {
        const parsed = JSON.parse(settings);
        this.analyticsEnabled = parsed.enabled !== false;
      }
    } catch (error) {
      console.error('Error checking analytics consent:', error);
      this.consentGiven = false;
    }
  }

  // Load stored user data
  private async loadStoredData(): Promise<void> {
    try {
      const storedProperties = await this.getEncryptedStorage(STORAGE_KEYS.USER_PROPERTIES);
      if (storedProperties) {
        this.userProperties = JSON.parse(storedProperties);
      }

      const storedMetrics = await this.getEncryptedStorage(STORAGE_KEYS.ENGAGEMENT_METRICS);
      if (storedMetrics) {
        this.engagementMetrics = JSON.parse(storedMetrics);
      }
    } catch (error) {
      console.error('Error loading stored analytics data:', error);
    }
  }

  // Generate unique session ID
  private generateSessionId(): void {
    this.currentSessionId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Encrypted storage helpers
  private async setEncryptedStorage(key: string, value: string): Promise<void> {
    try {
      const encrypted = CryptoJS.AES.encrypt(value, ENCRYPTION_KEY).toString();
      await AsyncStorage.setItem(key, encrypted);
    } catch (error) {
      console.error('Error setting encrypted storage:', error);
    }
  }

  private async getEncryptedStorage(key: string): Promise<string | null> {
    try {
      const encrypted = await AsyncStorage.getItem(key);
      if (!encrypted) return null;
      
      const decrypted = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
      return decrypted.toString(CryptoJS.enc.Utf8);
    } catch (error) {
      console.error('Error getting encrypted storage:', error);
      return null;
    }
  }

  // Set user ID and properties
  async setUser(userId: string, properties: Partial<UserProperties>): Promise<void> {
    if (!this.consentGiven || !this.analyticsEnabled) return;

    try {
      this.userProperties = { ...this.userProperties, ...properties };
      
      if (this.isOnline && analytics) {
        setUserId(analytics, userId);
        setUserProperties(analytics, properties);
      }

      await this.setEncryptedStorage(
        STORAGE_KEYS.USER_PROPERTIES,
        JSON.stringify(this.userProperties)
      );

      // Track user property update
      this.trackEvent('user_properties_updated', {
        properties_count: Object.keys(properties).length
      });

    } catch (error) {
      console.error('Error setting user properties:', error);
    }
  }

  // Track events
  async trackEvent(eventName: string, parameters: Record<string, any> = {}): Promise<void> {
    if (!this.consentGiven || !this.analyticsEnabled) return;

    try {
      const event: AnalyticsEvent = {
        id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: eventName,
        parameters: {
          ...parameters,
          session_id: this.currentSessionId,
          user_tier: this.userProperties.subscription_tier || 'freemium',
          timestamp: Date.now()
        },
        timestamp: Date.now(),
        userId: this.userProperties.subscription_tier,
        userTier: this.userProperties.subscription_tier,
        sessionId: this.currentSessionId,
        retryCount: 0
      };

      // Update engagement metrics
      this.updateEngagementMetrics(eventName, parameters);

      if (this.isOnline && analytics) {
        await logEvent(analytics, eventName, event.parameters);
      } else {
        this.addToOfflineQueue(event);
      }

    } catch (error) {
      console.error('Error tracking event:', error);
      this.trackError('analytics_event_failed', error);
    }
  }

  // Track screen views
  async trackScreenView(screenName: string, screenClass?: string): Promise<void> {
    const parameters = {
      screen_name: screenName,
      screen_class: screenClass || screenName
    };

    await this.trackEvent('screen_view', parameters);
    this.engagementMetrics.screen_views[screenName] = 
      (this.engagementMetrics.screen_views[screenName] || 0) + 1;
  }

  // Track user actions
  async trackUserAction(action: string, context?: Record<string, any>): Promise<void> {
    await this.trackEvent('user_action', {
      action_name: action,
      ...context
    });

    this.engagementMetrics.user_actions[action] = 
      (this.engagementMetrics.user_actions[action] || 0) + 1;
  }

  // Track feature usage
  async trackFeatureUsage(feature: string, details?: Record<string, any>): Promise<void> {
    await this.trackEvent('feature_used', {
      feature_name: feature,
      ...details
    });

    this.engagementMetrics.feature_usage[feature] = 
      (this.engagementMetrics.feature_usage[feature] || 0) + 1;
  }

  // Track subscription events
  async trackSubscription(action: 'upgrade' | 'downgrade' | 'cancel' | 'renew', 
                         fromTier: string, toTier: string): Promise<void> {
    await this.trackEvent('subscription_change', {
      action,
      from_tier: fromTier,
      to_tier: toTier,
      timestamp: Date.now()
    });
  }

  // Track content generation
  async trackContentGeneration(platform: string, contentType: string, 
                              success: boolean, details?: Record<string, any>): Promise<void> {
    await this.trackEvent('content_generated', {
      platform,
      content_type: contentType,
      success,
      generation_time: details?.generation_time || 0,
      word_count: details?.word_count || 0,
      ...details
    });

    if (success) {
      this.userProperties.content_generated_count = 
        (this.userProperties.content_generated_count || 0) + 1;
    }
  }

  // Track AI influencer interactions
  async trackAIInfluencer(action: string, influencerId: string, 
                         details?: Record<string, any>): Promise<void> {
    await this.trackEvent('ai_influencer_interaction', {
      action,
      influencer_id: influencerId,
      ...details
    });
  }

  // Track errors
  async trackError(errorType: string, error: any, context?: Record<string, any>): Promise<void> {
    const errorInfo = {
      error_type: errorType,
      error_message: error?.message || String(error),
      error_stack: error?.stack,
      timestamp: Date.now(),
      ...context
    };

    await this.trackEvent('error_occurred', errorInfo);
    this.engagementMetrics.errors_encountered.push(errorType);
  }

  // Track performance metrics
  async trackPerformance(metric: string, value: number, context?: Record<string, any>): Promise<void> {
    await this.trackEvent('performance_metric', {
      metric_name: metric,
      metric_value: value,
      ...context
    });
  }

  // Update engagement metrics
  private updateEngagementMetrics(eventName: string, parameters: Record<string, any>): void {
    if (eventName === 'session_start') {
      this.sessionStartTime = Date.now();
    } else if (eventName === 'session_end') {
      this.engagementMetrics.session_duration = Date.now() - this.sessionStartTime;
    }

    // Save engagement metrics periodically
    this.saveEngagementMetrics();
  }

  // Save engagement metrics to storage
  private async saveEngagementMetrics(): Promise<void> {
    try {
      await this.setEncryptedStorage(
        STORAGE_KEYS.ENGAGEMENT_METRICS,
        JSON.stringify(this.engagementMetrics)
      );
    } catch (error) {
      console.error('Error saving engagement metrics:', error);
    }
  }

  // Add event to offline queue
  private addToOfflineQueue(event: AnalyticsEvent): void {
    this.offlineQueue.push(event);
    
    // Limit queue size
    if (this.offlineQueue.length > MAX_OFFLINE_EVENTS) {
      this.offlineQueue = this.offlineQueue.slice(-MAX_OFFLINE_EVENTS);
    }
    
    this.saveOfflineEvents();
  }

  // Save offline events to storage
  private async saveOfflineEvents(): Promise<void> {
    try {
      await this.setEncryptedStorage(
        STORAGE_KEYS.OFFLINE_EVENTS,
        JSON.stringify(this.offlineQueue)
      );
    } catch (error) {
      console.error('Error saving offline events:', error);
    }
  }

  // Load offline events from storage
  private async loadOfflineEvents(): Promise<void> {
    try {
      const storedEvents = await this.getEncryptedStorage(STORAGE_KEYS.OFFLINE_EVENTS);
      if (storedEvents) {
        this.offlineQueue = JSON.parse(storedEvents);
        if (this.isOnline) {
          this.processOfflineQueue();
        }
      }
    } catch (error) {
      console.error('Error loading offline events:', error);
    }
  }

  // Process offline event queue
  private async processOfflineQueue(): Promise<void> {
    if (!this.isOnline || !analytics || this.offlineQueue.length === 0) return;

    try {
      const batches = this.chunkArray(this.offlineQueue, BATCH_SIZE);
      
      for (const batch of batches) {
        await this.processBatch(batch);
        // Small delay between batches to avoid overwhelming the service
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Clear processed events
      this.offlineQueue = [];
      await this.saveOfflineEvents();

    } catch (error) {
      console.error('Error processing offline queue:', error);
      this.scheduleRetry();
    }
  }

  // Process a batch of events
  private async processBatch(batch: AnalyticsEvent[]): Promise<void> {
    const promises = batch.map(async (event) => {
      try {
        await logEvent(analytics, event.name, event.parameters);
      } catch (error) {
        // Re-add failed events back to queue if retry count is less than max
        if (event.retryCount < MAX_RETRY_COUNT) {
          event.retryCount++;
          this.offlineQueue.push(event);
        }
        throw error;
      }
    });

    await Promise.all(promises);
  }

  // Schedule retry for failed events
  private scheduleRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    this.retryTimer = setTimeout(() => {
      if (this.isOnline) {
        this.processOfflineQueue();
      }
    }, RETRY_DELAY);
  }

  // Utility: Chunk array into smaller arrays
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  // Session management
  async startSession(): Promise<void> {
    this.generateSessionId();
    this.sessionStartTime = Date.now();
    await this.trackEvent('session_start');
  }

  async endSession(): Promise<void> {
    const sessionDuration = Date.now() - this.sessionStartTime;
    await this.trackEvent('session_end', { session_duration: sessionDuration });
    this.engagementMetrics.session_duration = sessionDuration;
    await this.saveEngagementMetrics();
  }

  // User consent management
  async setAnalyticsConsent(consent: boolean): Promise<void> {
    this.consentGiven = consent;
    await AsyncStorage.setItem('@onxlink_analytics_consent', consent.toString());
    
    if (consent) {
      await this.trackEvent('analytics_consent_given');
    } else {
      // Clear all stored analytics data
      await this.clearAllAnalyticsData();
    }
  }

  // Enable/disable analytics
  async setAnalyticsEnabled(enabled: boolean): Promise<void> {
    this.analyticsEnabled = enabled;
    
    const settings = { enabled };
    await AsyncStorage.setItem(STORAGE_KEYS.ANALYTICS_SETTINGS, JSON.stringify(settings));
    
    if (enabled) {
      await this.trackEvent('analytics_enabled');
    }
  }

  // Clear all analytics data
  private async clearAllAnalyticsData(): Promise<void> {
    try {
      const keys = Object.values(STORAGE_KEYS);
      await Promise.all(keys.map(key => AsyncStorage.removeItem(key)));
      
      this.offlineQueue = [];
      this.userProperties = {};
      this.engagementMetrics = {
        session_duration: 0,
        feature_usage: {},
        screen_views: {},
        user_actions: {},
        errors_encountered: []
      };
    } catch (error) {
      console.error('Error clearing analytics data:', error);
    }
  }

  // Get analytics summary (for user dashboard)
  async getAnalyticsSummary(): Promise<any> {
    if (!this.consentGiven) return null;

    return {
      session_duration: this.engagementMetrics.session_duration,
      feature_usage: this.engagementMetrics.feature_usage,
      screen_views: this.engagementMetrics.screen_views,
      user_actions: this.engagementMetrics.user_actions,
      content_generated: this.userProperties.content_generated_count || 0,
      posts_created: this.userProperties.posts_created_count || 0,
      ai_influencers: this.userProperties.ai_influencers_count || 0
    };
  }

  // Offline analytics for user insights
  getOfflineInsights(): any {
    return {
      most_used_features: this.getMostUsedFeatures(),
      screen_time_distribution: this.getScreenTimeDistribution(),
      productivity_score: this.calculateProductivityScore(),
      engagement_level: this.calculateEngagementLevel()
    };
  }

  private getMostUsedFeatures(): Array<{ feature: string; count: number }> {
    return Object.entries(this.engagementMetrics.feature_usage)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([feature, count]) => ({ feature, count }));
  }

  private getScreenTimeDistribution(): Record<string, number> {
    const total = Object.values(this.engagementMetrics.screen_views)
      .reduce((sum, count) => sum + count, 0);
    
    const distribution: Record<string, number> = {};
    Object.entries(this.engagementMetrics.screen_views).forEach(([screen, count]) => {
      distribution[screen] = total > 0 ? (count / total) * 100 : 0;
    });
    
    return distribution;
  }

  private calculateProductivityScore(): number {
    const contentGenerated = this.userProperties.content_generated_count || 0;
    const postsCreated = this.userProperties.posts_created_count || 0;
    const aiInfluencers = this.userProperties.ai_influencers_count || 0;
    
    // Weighted scoring system
    const score = (contentGenerated * 2) + (postsCreated * 3) + (aiInfluencers * 5);
    return Math.min(score, 100); // Cap at 100
  }

  private calculateEngagementLevel(): 'low' | 'medium' | 'high' {
    const actionsCount = Object.values(this.engagementMetrics.user_actions)
      .reduce((sum, count) => sum + count, 0);
    
    if (actionsCount < 10) return 'low';
    if (actionsCount < 50) return 'medium';
    return 'high';
  }

  // Cleanup
  destroy(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();

// Export utility functions for direct use
export const {
  trackEvent,
  trackScreenView,
  trackUserAction,
  trackFeatureUsage,
  trackSubscription,
  trackContentGeneration,
  trackAIInfluencer,
  trackError,
  trackPerformance,
  setUser,
  startSession,
  endSession,
  setAnalyticsConsent,
  setAnalyticsEnabled,
  getAnalyticsSummary,
  getOfflineInsights
} = analyticsService;