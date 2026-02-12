import { Platform } from 'react-native';
import Purchases, { PurchasesPackage, CustomerInfo, PurchasesOffering } from 'react-native-purchases';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EventEmitter } from 'events';
import CryptoJS from 'crypto-js';

// Types
export interface SubscriptionTier {
  id: string;
  name: 'freemium' | 'premium' | 'enterprise';
  displayName: string;
  price: string;
  currency: string;
  features: string[];
  limits: {
    platforms: number;
    aiInfluencers: number;
    contentVariations: number;
    languages: number;
    teamMembers: number;
  };
  isActive: boolean;
  expiresAt?: Date;
}

export interface OfflineFeature {
  id: string;
  name: string;
  isAvailable: boolean;
  lastSyncAt?: Date;
  dataSize: number;
}

export interface PaddleConfig {
  vendorId: string;
  environment: 'sandbox' | 'production';
  publicKey: string;
}

// Constants
const STORAGE_KEYS = {
  SUBSCRIPTION_DATA: '@onxlink:subscription_data',
  OFFLINE_FEATURES: '@onxlink:offline_features',
  LAST_SYNC: '@onxlink:last_sync',
  ENCRYPTED_TOKENS: '@onxlink:encrypted_tokens',
  USER_PREFERENCES: '@onxlink:user_preferences',
  CACHED_OFFERINGS: '@onxlink:cached_offerings',
  PADDLE_CONFIG: '@onxlink:paddle_config'
} as const;

const ENCRYPTION_KEY = 'ONXLink_Secure_Key_2024';
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
const OFFLINE_RETENTION_DAYS = 30;

class SubscriptionService extends EventEmitter {
  private static instance: SubscriptionService;
  private currentTier: SubscriptionTier;
  private offerings: PurchasesOffering[] = [];
  private isInitialized = false;
  private syncTimer?: NodeJS.Timeout;
  private paddleConfig?: PaddleConfig;
  private offlineFeatures: OfflineFeature[] = [];
  private retryQueue: Array<() => Promise<void>> = [];
  private isOnline = true;

  private constructor() {
    super();
    this.currentTier = this.getFreemiumTier();
    this.initializeOfflineFeatures();
    this.setupNetworkListener();
  }

  public static getInstance(): SubscriptionService {
    if (!SubscriptionService.instance) {
      SubscriptionService.instance = new SubscriptionService();
    }
    return SubscriptionService.instance;
  }

  /**
   * Initialize subscription service with platform-specific configurations
   */
  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) return;

      // Initialize RevenueCat for mobile platforms
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        await this.initializeRevenueCat();
      } else {
        // Initialize Paddle for web and other platforms
        await this.initializePaddle();
      }

      // Load cached data
      await this.loadCachedData();
      
      // Setup periodic sync
      this.setupPeriodicSync();
      
      // Check current subscription status
      await this.refreshSubscriptionStatus();
      
      this.isInitialized = true;
      this.emit('initialized');
      
      console.log('✅ Subscription service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize subscription service:', error);
      // Fallback to offline mode
      await this.enableOfflineMode();
      throw error;
    }
  }

  /**
   * Initialize RevenueCat for mobile platforms
   */
  private async initializeRevenueCat(): Promise<void> {
    const apiKey = Platform.OS === 'ios' 
      ? process.env.REVENUECAT_IOS_API_KEY 
      : process.env.REVENUECAT_ANDROID_API_KEY;

    if (!apiKey) {
      throw new Error('RevenueCat API key not found');
    }

    await Purchases.configure({ apiKey });
    
    // Set up purchase listener
    Purchases.addCustomerInfoUpdateListener(this.handleCustomerInfoUpdate.bind(this));
    
    // Load offerings
    await this.loadOfferings();
  }

  /**
   * Initialize Paddle for web platforms
   */
  private async initializePaddle(): Promise<void> {
    if (typeof window === 'undefined') return;

    this.paddleConfig = {
      vendorId: process.env.PADDLE_VENDOR_ID || '',
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
      publicKey: process.env.PADDLE_PUBLIC_KEY || ''
    };

    if (!this.paddleConfig.vendorId) {
      throw new Error('Paddle vendor ID not found');
    }

    // Load Paddle.js dynamically
    await this.loadPaddleScript();
    
    // Initialize Paddle
    if (window.Paddle) {
      window.Paddle.Setup({
        vendor: parseInt(this.paddleConfig.vendorId),
        eventCallback: this.handlePaddleEvent.bind(this)
      });
    }
  }

  /**
   * Load Paddle.js script dynamically
   */
  private async loadPaddleScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.Paddle) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = this.paddleConfig?.environment === 'production' 
        ? 'https://cdn.paddle.com/paddle/paddle.js'
        : 'https://cdn.paddle.com/paddle/v2/paddle.js';
      
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Paddle script'));
      
      document.head.appendChild(script);
    });
  }

  /**
   * Get current subscription tier with offline fallback
   */
  getCurrentTier(): SubscriptionTier {
    return this.currentTier;
  }

  /**
   * Get available subscription packages/offerings
   */
  async getAvailablePackages(): Promise<PurchasesPackage[] | any[]> {
    try {
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        if (this.offerings.length === 0) {
          await this.loadOfferings();
        }
        return this.offerings.flatMap(offering => offering.availablePackages);
      } else {
        // For web, return predefined packages
        return this.getWebPackages();
      }
    } catch (error) {
      console.error('Failed to get packages:', error);
      // Return cached packages in case of error
      return await this.getCachedPackages();
    }
  }

  /**
   * Purchase a subscription package
   */
  async purchasePackage(packageId: string): Promise<boolean> {
    try {
      this.emit('purchaseStarted', packageId);

      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        return await this.purchaseMobilePackage(packageId);
      } else {
        return await this.purchaseWebPackage(packageId);
      }
    } catch (error) {
      console.error('Purchase failed:', error);
      this.emit('purchaseError', error);
      
      // Add to retry queue if offline
      if (!this.isOnline) {
        this.addToRetryQueue(() => this.purchasePackage(packageId));
      }
      
      return false;
    }
  }

  /**
   * Purchase package for mobile platforms using RevenueCat
   */
  private async purchaseMobilePackage(packageId: string): Promise<boolean> {
    const packages = await this.getAvailablePackages() as PurchasesPackage[];
    const targetPackage = packages.find(pkg => pkg.identifier === packageId);
    
    if (!targetPackage) {
      throw new Error(`Package ${packageId} not found`);
    }

    const { customerInfo } = await Purchases.purchasePackage(targetPackage);
    await this.handleCustomerInfoUpdate(customerInfo);
    
    this.emit('purchaseCompleted', packageId);
    return true;
  }

  /**
   * Purchase package for web platforms using Paddle
   */
  private async purchaseWebPackage(packageId: string): Promise<boolean> {
    if (!window.Paddle) {
      throw new Error('Paddle not initialized');
    }

    const productId = this.getProductIdForPackage(packageId);
    
    return new Promise((resolve, reject) => {
      window.Paddle.Checkout.open({
        product: parseInt(productId),
        email: this.getCurrentUserEmail(),
        country: 'NG', // Nigeria
        postcode: '100001',
        allowQuantity: false,
        quantity: 1,
        successCallback: (data: any) => {
          this.handlePaddleSuccess(data, packageId);
          resolve(true);
        },
        closeCallback: () => {
          this.emit('purchaseCancelled', packageId);
          resolve(false);
        }
      });
    });
  }

  /**
   * Restore purchases for mobile platforms
   */
  async restorePurchases(): Promise<boolean> {
    try {
      if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
        console.warn('Restore purchases only available on mobile platforms');
        return false;
      }

      const customerInfo = await Purchases.restorePurchases();
      await this.handleCustomerInfoUpdate(customerInfo);
      
      this.emit('purchasesRestored');
      return true;
    } catch (error) {
      console.error('Failed to restore purchases:', error);
      this.emit('restoreError', error);
      return false;
    }
  }

  /**
   * Check if user has access to a specific feature
   */
  hasFeatureAccess(featureId: string): boolean {
    const tier = this.currentTier;
    
    // Premium features
    const premiumFeatures = [
      'multi_platform_posting',
      'ai_influencer_creation',
      'predictive_inventory',
      'cultural_adaptation',
      'advanced_analytics'
    ];
    
    // Enterprise features
    const enterpriseFeatures = [
      'unlimited_platforms',
      'custom_ai_cloning',
      'anticipatory_shipping',
      'team_management',
      'api_access',
      'priority_support'
    ];

    switch (tier.name) {
      case 'enterprise':
        return true; // Access to all features
      case 'premium':
        return !enterpriseFeatures.includes(featureId);
      case 'freemium':
      default:
        return !premiumFeatures.includes(featureId) && !enterpriseFeatures.includes(featureId);
    }
  }

  /**
   * Get feature limits based on current tier
   */
  getFeatureLimits(): SubscriptionTier['limits'] {
    return this.currentTier.limits;
  }

  /**
   * Check if feature usage is within limits
   */
  isWithinLimits(featureType: keyof SubscriptionTier['limits'], currentUsage: number): boolean {
    const limits = this.getFeatureLimits();
    const limit = limits[featureType];
    
    return limit === -1 || currentUsage < limit; // -1 means unlimited
  }

  /**
   * Get offline features available to user
   */
  getOfflineFeatures(): OfflineFeature[] {
    return this.offlineFeatures.filter(feature => 
      this.hasFeatureAccess(feature.id) && feature.isAvailable
    );
  }

  /**
   * Enable specific offline feature
   */
  async enableOfflineFeature(featureId: string): Promise<boolean> {
    try {
      if (!this.hasFeatureAccess(featureId)) {
        return false;
      }

      const feature = this.offlineFeatures.find(f => f.id === featureId);
      if (!feature) {
        return false;
      }

      // Download necessary data for offline use
      await this.downloadOfflineData(featureId);
      
      feature.isAvailable = true;
      feature.lastSyncAt = new Date();
      
      await this.saveOfflineFeatures();
      this.emit('offlineFeatureEnabled', featureId);
      
      return true;
    } catch (error) {
      console.error(`Failed to enable offline feature ${featureId}:`, error);
      return false;
    }
  }

  /**
   * Sync offline data when online
   */
  async syncOfflineData(): Promise<void> {
    if (!this.isOnline) return;

    try {
      const lastSync = await AsyncStorage.getItem(STORAGE_KEYS.LAST_SYNC);
      const lastSyncDate = lastSync ? new Date(lastSync) : new Date(0);
      const now = new Date();

      // Sync if more than 5 minutes since last sync
      if (now.getTime() - lastSyncDate.getTime() > SYNC_INTERVAL) {
        await this.performDataSync();
        await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC, now.toISOString());
        this.emit('dataSynced');
      }
    } catch (error) {
      console.error('Data sync failed:', error);
    }
  }

  /**
   * Get subscription analytics for retention
   */
  getSubscriptionAnalytics(): {
    tier: string;
    daysActive: number;
    featuresUsed: string[];
    engagementScore: number;
    renewalProbability: number;
  } {
    const daysActive = this.calculateDaysActive();
    const featuresUsed = this.getUsedFeatures();
    const engagementScore = this.calculateEngagementScore();
    const renewalProbability = this.calculateRenewalProbability();

    return {
      tier: this.currentTier.name,
      daysActive,
      featuresUsed,
      engagementScore,
      renewalProbability
    };
  }

  /**
   * Get personalized upgrade recommendations
   */
  getUpgradeRecommendations(): {
    targetTier: string;
    reason: string;
    discount?: number;
    urgency: 'low' | 'medium' | 'high';
  }[] {
    const analytics = this.getSubscriptionAnalytics();
    const recommendations = [];

    if (this.currentTier.name === 'freemium') {
      if (analytics.engagementScore > 0.7) {
        recommendations.push({
          targetTier: 'premium',
          reason: 'High engagement detected. Unlock advanced features!',
          discount: 20,
          urgency: 'high' as const
        });
      } else if (analytics.daysActive > 7) {
        recommendations.push({
          targetTier: 'premium',
          reason: 'You\'ve been with us for a week. Ready for more?',
          discount: 10,
          urgency: 'medium' as const
        });
      }
    } else if (this.currentTier.name === 'premium') {
      if (analytics.featuresUsed.length > 8) {
        recommendations.push({
          targetTier: 'enterprise',
          reason: 'Power user detected. Enterprise features await!',
          urgency: 'medium' as const
        });
      }
    }

    return recommendations;
  }

  // Private methods

  private getFreemiumTier(): SubscriptionTier {
    return {
      id: 'freemium',
      name: 'freemium',
      displayName: 'Freemium',
      price: 'Free',
      currency: 'USD',
      features: [
        'Auto-post to 5 platforms',
        '1 basic AI influencer',
        '10 content variations',
        'Basic analytics'
      ],
      limits: {
        platforms: 5,
        aiInfluencers: 1,
        contentVariations: 10,
        languages: 3,
        teamMembers: 1
      },
      isActive: true
    };
  }

  private async loadOfferings(): Promise<void> {
    try {
      const offerings = await Purchases.getOfferings();
      this.offerings = Object.values(offerings.all);
      await this.cacheOfferings();
    } catch (error) {
      console.error('Failed to load offerings:', error);
      this.offerings = await this.getCachedOfferings();
    }
  }

  private async handleCustomerInfoUpdate(customerInfo: CustomerInfo): Promise<void> {
    const activeTier = this.determineActiveSubscription(customerInfo);
    this.currentTier = activeTier;
    
    await this.saveSubscriptionData();
    this.emit('subscriptionUpdated', activeTier);
  }

  private determineActiveSubscription(customerInfo: CustomerInfo): SubscriptionTier {
    const activeEntitlements = customerInfo.activeSubscriptions;
    
    if (activeEntitlements.includes('enterprise')) {
      return this.getEnterpriseTier();
    } else if (activeEntitlements.includes('premium')) {
      return this.getPremiumTier();
    } else {
      return this.getFreemiumTier();
    }
  }

  private getPremiumTier(): SubscriptionTier {
    return {
      id: 'premium',
      name: 'premium',
      displayName: 'Premium',
      price: '$77/month',
      currency: 'USD',
      features: [
        'Auto-post to 50+ platforms',
        '3 custom AI influencers',
        '100+ content variations',
        'Cultural adaptation (15 languages)',
        'Predictive inventory alerts',
        'Advanced analytics'
      ],
      limits: {
        platforms: 50,
        aiInfluencers: 3,
        contentVariations: 100,
        languages: 15,
        teamMembers: 5
      },
      isActive: true
    };
  }

  private getEnterpriseTier(): SubscriptionTier {
    return {
      id: 'enterprise',
      name: 'enterprise',
      displayName: 'Enterprise',
      price: '$777/year',
      currency: 'USD',
      features: [
        'Unlimited platforms & AI influencers',
        'Custom voice cloning',
        'Anticipatory shipping AI',
        'Multi-user team management',
        'API access & priority support'
      ],
      limits: {
        platforms: -1, // Unlimited
        aiInfluencers: -1,
        contentVariations: -1,
        languages: 15,
        teamMembers: -1
      },
      isActive: true
    };
  }

  private getWebPackages(): any[] {
    return [
      {
        id: 'premium_monthly',
        title: 'Premium Monthly',
        description: 'Access to all premium features',
        price: '$77',
        interval: 'month'
      },
      {
        id: 'enterprise_yearly',
        title: 'Enterprise Yearly',
        description: 'Full enterprise access',
        price: '$777',
        interval: 'year'
      }
    ];
  }

  private getProductIdForPackage(packageId: string): string {
    const productMap: Record<string, string> = {
      'premium_monthly': process.env.PADDLE_PREMIUM_PRODUCT_ID || '',
      'enterprise_yearly': process.env.PADDLE_ENTERPRISE_PRODUCT_ID || ''
    };
    
    return productMap[packageId] || '';
  }

  private getCurrentUserEmail(): string {
    // This should integrate with your auth service
    return 'user@example.com'; // Placeholder
  }

  private handlePaddleEvent(data: any): void {
    console.log('Paddle event:', data);
    
    if (data.event === 'Checkout.Complete') {
      this.handlePaddleSuccess(data, data.product.id);
    }
  }

  private handlePaddleSuccess(data: any, packageId: string): void {
    // Update subscription status based on Paddle webhook
    // This should be verified server-side
    this.emit('purchaseCompleted', packageId);
  }

  private initializeOfflineFeatures(): void {
    this.offlineFeatures = [
      {
        id: 'content_templates',
        name: 'Content Templates',
        isAvailable: true,
        dataSize: 50 * 1024 // 50KB
      },
      {
        id: 'ai_persona_profiles',
        name: 'AI Persona Profiles',
        isAvailable: false,
        dataSize: 200 * 1024 // 200KB
      },
      {
        id: 'analytics_dashboard',
        name: 'Offline Analytics',
        isAvailable: false,
        dataSize: 100 * 1024 // 100KB
      },
      {
        id: 'cultural_insights',
        name: 'Cultural Intelligence Database',
        isAvailable: false,
        dataSize: 1 * 1024 * 1024 // 1MB
      }
    ];
  }

  private setupNetworkListener(): void {
    // Platform-specific network detection
    if (typeof window !== 'undefined' && window.navigator) {
      window.addEventListener('online', () => {
        this.isOnline = true;
        this.processRetryQueue();
        this.syncOfflineData();
      });
      
      window.addEventListener('offline', () => {
        this.isOnline = false;
      });
    }
  }

  private setupPeriodicSync(): void {
    this.syncTimer = setInterval(() => {
      this.syncOfflineData();
    }, SYNC_INTERVAL);
  }

  private async enableOfflineMode(): Promise<void> {
    console.log('📱 Enabling offline mode');
    await this.loadCachedData();
    this.emit('offlineModeEnabled');
  }

  private async loadCachedData(): Promise<void> {
    try {
      const [subscriptionData, offlineFeatures] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.SUBSCRIPTION_DATA),
        AsyncStorage.getItem(STORAGE_KEYS.OFFLINE_FEATURES)
      ]);

      if (subscriptionData) {
        this.currentTier = JSON.parse(subscriptionData);
      }

      if (offlineFeatures) {
        this.offlineFeatures = JSON.parse(offlineFeatures);
      }
    } catch (error) {
      console.error('Failed to load cached data:', error);
    }
  }

  private async saveSubscriptionData(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.SUBSCRIPTION_DATA, 
        JSON.stringify(this.currentTier)
      );
    } catch (error) {
      console.error('Failed to save subscription data:', error);
    }
  }

  private async saveOfflineFeatures(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.OFFLINE_FEATURES,
        JSON.stringify(this.offlineFeatures)
      );
    } catch (error) {
      console.error('Failed to save offline features:', error);
    }
  }

  private async cacheOfferings(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.CACHED_OFFERINGS,
        JSON.stringify(this.offerings)
      );
    } catch (error) {
      console.error('Failed to cache offerings:', error);
    }
  }

  private async getCachedOfferings(): Promise<PurchasesOffering[]> {
    try {
      const cached = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_OFFERINGS);
      return cached ? JSON.parse(cached) : [];
    } catch (error) {
      console.error('Failed to get cached offerings:', error);
      return [];
    }
  }

  private async getCachedPackages(): Promise<any[]> {
    const offerings = await this.getCachedOfferings();
    return offerings.flatMap(offering => offering.availablePackages || []);
  }

  private async downloadOfflineData(featureId: string): Promise<void> {
    // Simulate downloading offline data
    console.log(`📥 Downloading offline data for ${featureId}`);
    
    // In real implementation, this would download and cache necessary data
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  private async performDataSync(): Promise<void> {
    console.log('🔄 Performing data sync');
    
    // Sync subscription status
    await this.refreshSubscriptionStatus();
    
    // Sync offline feature data
    for (const feature of this.offlineFeatures) {
      if (feature.isAvailable && this.hasFeatureAccess(feature.id)) {
        await this.downloadOfflineData(feature.id);
        feature.lastSyncAt = new Date();
      }
    }
    
    await this.saveOfflineFeatures();
  }

  private async refreshSubscriptionStatus(): Promise<void> {
    try {
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        const customerInfo = await Purchases.getCustomerInfo();
        await this.handleCustomerInfoUpdate(customerInfo);
      }
      // For web platforms, you'd typically call your backend API
    } catch (error) {
      console.error('Failed to refresh subscription status:', error);
    }
  }

  private addToRetryQueue(operation: () => Promise<void>): void {
    this.retryQueue.push(operation);
  }

  private async processRetryQueue(): Promise<void> {
    while (this.retryQueue.length > 0 && this.isOnline) {
      const operation = this.retryQueue.shift();
      if (operation) {
        try {
          await operation();
        } catch (error) {
          console.error('Retry operation failed:', error);
        }
      }
    }
  }

  private calculateDaysActive(): number {
    // Calculate based on first app install or subscription date
    const installDate = new Date('2024-01-01'); // Placeholder
    const now = new Date();
    return Math.floor((now.getTime() - installDate.getTime()) / (1000 * 60 * 60 * 24));
  }

  private getUsedFeatures(): string[] {
    // This would integrate with analytics to track feature usage
    return ['content_generation', 'social_posting', 'ai_influencer'];
  }

  private calculateEngagementScore(): number {
    // Calculate based on feature usage, session time, etc.
    const featuresUsed = this.getUsedFeatures().length;
    const maxFeatures = 10;
    return Math.min(featuresUsed / maxFeatures, 1.0);
  }

  private calculateRenewalProbability(): number {
    const analytics = this.getSubscriptionAnalytics();
    const baseScore = 0.5;
    const engagementBonus = analytics.engagementScore * 0.3;
    const loyaltyBonus = Math.min(analytics.daysActive / 30, 1.0) * 0.2;
    
    return Math.min(baseScore + engagementBonus + loyaltyBonus, 1.0);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    this.removeAllListeners();
  }
}

// Extend window interface for Paddle
declare global {
  interface Window {
    Paddle?: {
      Setup: (config: any) => void;
      Checkout: {
        open: (options: any) => void;
      };
    };
  }
}

export default SubscriptionService.getInstance();