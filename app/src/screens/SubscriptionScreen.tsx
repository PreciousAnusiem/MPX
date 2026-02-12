import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Dimensions,
  Platform,
  ActivityIndicator,
  Modal,
  Animated,
  StatusBar,
  RefreshControl,
  Vibration,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import Purchases, { PurchasesPackage, CustomerInfo } from 'react-native-purchases';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as Analytics from 'expo-firebase-analytics';
import Icon from 'react-native-vector-icons/Ionicons';

import { RootState } from '../store';
import { updateSubscription, setLoading, setError } from '../store/userSlice';
import { 
  getCurrentTier, 
  getSubscriptionExpiry, 
  getOfflineCapabilities,
  validateTierAccess 
} from '../services/subscription';
import { encryptData, decryptData } from '../utils/security';
import { logSecureEvent } from '../utils/analytics';
import { showToast } from '../utils/helpers';
import { SubscriptionTier, Feature, OfflineCapability } from '../types';

interface TierFeature {
  id: string;
  name: string;
  description: string;
  included: boolean;
  highlight?: boolean;
  offline?: boolean;
}

interface SubscriptionTierData {
  id: SubscriptionTier;
  name: string;
  price: string;
  monthlyPrice?: string;
  yearlyPrice?: string;
  period: string;
  color: string;
  gradientColors: string[];
  popular?: boolean;
  enterprise?: boolean;
  features: TierFeature[];
  offlineCapabilities: OfflineCapability[];
  maxAIInfluencers: number;
  maxPlatforms: number;
  maxContentVariations: number;
  culturalLanguages: number;
}

const { width, height } = Dimensions.get('window');
const CARD_WIDTH = width * 0.85;
const ANIMATION_DURATION = 300;

// Offline storage keys
const OFFLINE_KEYS = {
  SUBSCRIPTION_DATA: '@onxlink_subscription_offline',
  TIER_FEATURES: '@onxlink_tier_features',
  USAGE_LIMITS: '@onxlink_usage_limits',
  LAST_SYNC: '@onxlink_last_subscription_sync',
};

const SubscriptionScreen: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { user, subscription, loading } = useSelector((state: RootState) => state.user);
  
  // State management
  const [isOnline, setIsOnline] = useState(true);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier>('freemium');
  const [currentTier, setCurrentTier] = useState<SubscriptionTier>('freemium');
  const [isRestoring, setIsRestoring] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [refreshing, setRefreshing] = useState(false);
  const [offlineData, setOfflineData] = useState<any>(null);
  const [usageStats, setUsageStats] = useState<any>(null);
  
  // Animations
  const fadeAnim = useMemo(() => new Animated.Value(0), []);
  const slideAnim = useMemo(() => new Animated.Value(50), []);
  const scaleAnim = useMemo(() => new Animated.Value(0.95), []);

  // Subscription tiers configuration
  const subscriptionTiers: SubscriptionTierData[] = useMemo(() => [
    {
      id: 'freemium',
      name: t('subscription.freemium.title', 'Freemium'),
      price: t('subscription.freemium.price', 'Free'),
      period: t('subscription.freemium.period', 'Forever'),
      color: '#B2BEC3',
      gradientColors: ['#B2BEC3', '#DDD'],
      maxAIInfluencers: 1,
      maxPlatforms: 5,
      maxContentVariations: 10,
      culturalLanguages: 3,
      features: [
        {
          id: 'basic_posting',
          name: t('features.basic_posting', 'Auto-post to 5 platforms'),
          description: t('features.basic_posting_desc', 'TikTok, Instagram, Twitter, Facebook, YouTube'),
          included: true,
          offline: true,
        },
        {
          id: 'basic_ai_influencer',
          name: t('features.basic_ai_influencer', '1 Basic AI Influencer'),
          description: t('features.basic_ai_influencer_desc', 'Pre-designed AI persona'),
          included: true,
          offline: true,
        },
        {
          id: 'content_variations',
          name: t('features.content_variations', '10 Content Variations'),
          description: t('features.content_variations_desc', 'AI-generated captions'),
          included: true,
          offline: false,
        },
        {
          id: 'basic_analytics',
          name: t('features.basic_analytics', 'Basic Analytics'),
          description: t('features.basic_analytics_desc', 'Performance tracking'),
          included: true,
          offline: true,
        },
        {
          id: 'community_support',
          name: t('features.community_support', 'Community Support'),
          description: t('features.community_support_desc', 'Forum access'),
          included: true,
          offline: false,
        },
      ],
      offlineCapabilities: [
        { id: 'content_creation', name: 'Content Creation', available: true },
        { id: 'analytics_view', name: 'Analytics Viewing', available: true },
        { id: 'ai_influencer_edit', name: 'AI Influencer Editing', available: true },
      ],
    },
    {
      id: 'premium',
      name: t('subscription.premium.title', 'Premium'),
      price: billingPeriod === 'yearly' ? '$77' : '$9',
      monthlyPrice: '$9',
      yearlyPrice: '$77',
      period: billingPeriod === 'yearly' 
        ? t('subscription.premium.period_yearly', 'per year') 
        : t('subscription.premium.period_monthly', 'per month'),
      color: '#6C5CE7',
      gradientColors: ['#6C5CE7', '#A29BFE'],
      popular: true,
      maxAIInfluencers: 3,
      maxPlatforms: 50,
      maxContentVariations: 100,
      culturalLanguages: 15,
      features: [
        {
          id: 'advanced_posting',
          name: t('features.advanced_posting', 'Auto-post to 50+ platforms'),
          description: t('features.advanced_posting_desc', 'All major social platforms'),
          included: true,
          highlight: true,
          offline: true,
        },
        {
          id: 'custom_ai_influencers',
          name: t('features.custom_ai_influencers', '3 Custom AI Influencers'),
          description: t('features.custom_ai_influencers_desc', 'Fully customizable personas'),
          included: true,
          highlight: true,
          offline: true,
        },
        {
          id: 'advanced_content',
          name: t('features.advanced_content', '100+ Content Variations'),
          description: t('features.advanced_content_desc', 'Platform-optimized content'),
          included: true,
          offline: false,
        },
        {
          id: 'cultural_adaptation',
          name: t('features.cultural_adaptation', 'Cultural Adaptation (15 languages)'),
          description: t('features.cultural_adaptation_desc', 'Localized content for global reach'),
          included: true,
          highlight: true,
          offline: true,
        },
        {
          id: 'predictive_inventory',
          name: t('features.predictive_inventory', 'Predictive Inventory Alerts'),
          description: t('features.predictive_inventory_desc', 'AI-powered trend detection'),
          included: true,
          offline: false,
        },
        {
          id: 'advanced_analytics',
          name: t('features.advanced_analytics', 'Advanced Analytics'),
          description: t('features.advanced_analytics_desc', 'Deep insights & ROI tracking'),
          included: true,
          offline: true,
        },
        {
          id: 'priority_support',
          name: t('features.priority_support', 'Priority Support'),
          description: t('features.priority_support_desc', '24/7 dedicated support'),
          included: true,
          offline: false,
        },
      ],
      offlineCapabilities: [
        { id: 'content_creation', name: 'Content Creation', available: true },
        { id: 'analytics_view', name: 'Analytics Viewing', available: true },
        { id: 'ai_influencer_edit', name: 'AI Influencer Editing', available: true },
        { id: 'cultural_templates', name: 'Cultural Templates', available: true },
        { id: 'inventory_cache', name: 'Inventory Cache', available: true },
      ],
    },
    {
      id: 'enterprise',
      name: t('subscription.enterprise.title', 'Enterprise'),
      price: '$777',
      period: t('subscription.enterprise.period', 'per year'),
      color: '#2D3436',
      gradientColors: ['#2D3436', '#636E72'],
      enterprise: true,
      maxAIInfluencers: -1, // Unlimited
      maxPlatforms: -1, // Unlimited
      maxContentVariations: -1, // Unlimited
      culturalLanguages: 15,
      features: [
        {
          id: 'unlimited_everything',
          name: t('features.unlimited_everything', 'Unlimited Platforms & AI Influencers'),
          description: t('features.unlimited_everything_desc', 'No limits on usage'),
          included: true,
          highlight: true,
          offline: true,
        },
        {
          id: 'custom_voice_cloning',
          name: t('features.custom_voice_cloning', 'Custom Voice Cloning'),
          description: t('features.custom_voice_cloning_desc', 'Personalized AI voices'),
          included: true,
          highlight: true,
          offline: true,
        },
        {
          id: 'anticipatory_shipping',
          name: t('features.anticipatory_shipping', 'Anticipatory Shipping AI'),
          description: t('features.anticipatory_shipping_desc', 'Predictive logistics'),
          included: true,
          offline: false,
        },
        {
          id: 'multi_user_management',
          name: t('features.multi_user_management', 'Multi-user Team Management'),
          description: t('features.multi_user_management_desc', 'Collaborative workspace'),
          included: true,
          offline: true,
        },
        {
          id: 'api_access',
          name: t('features.api_access', 'API Access & Integration'),
          description: t('features.api_access_desc', 'Custom integrations'),
          included: true,
          offline: false,
        },
        {
          id: 'dedicated_support',
          name: t('features.dedicated_support', 'Dedicated Account Manager'),
          description: t('features.dedicated_support_desc', 'Personal support specialist'),
          included: true,
          offline: false,
        },
        {
          id: 'white_label',
          name: t('features.white_label', 'White Label Options'),
          description: t('features.white_label_desc', 'Brand customization'),
          included: true,
          offline: true,
        },
      ],
      offlineCapabilities: [
        { id: 'content_creation', name: 'Content Creation', available: true },
        { id: 'analytics_view', name: 'Analytics Viewing', available: true },
        { id: 'ai_influencer_edit', name: 'AI Influencer Editing', available: true },
        { id: 'cultural_templates', name: 'Cultural Templates', available: true },
        { id: 'inventory_cache', name: 'Inventory Cache', available: true },
        { id: 'voice_cloning_cache', name: 'Voice Cloning Cache', available: true },
        { id: 'team_management', name: 'Team Management', available: true },
        { id: 'white_label_config', name: 'White Label Config', available: true },
      ],
    },
  ], [t, billingPeriod]);

  // Initialize component
  useEffect(() => {
    initializeSubscription();
    setupNetworkListener();
    loadOfflineData();
    
    // Animation sequence
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
    ]).start();

    // Handle back button
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    
    return () => {
      backHandler.remove();
    };
  }, []);

  // Network connectivity setup
  const setupNetworkListener = useCallback(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected || false);
      if (state.isConnected) {
        syncOfflineData();
      }
    });
    return unsubscribe;
  }, []);

  // Initialize subscription system
  const initializeSubscription = useCallback(async () => {
    try {
      dispatch(setLoading(true));
      
      // Configure RevenueCat for mobile
      if (Platform.OS !== 'web') {
        await configurePurchases();
      }
      
      await Promise.all([
        loadSubscriptionData(),
        loadUsageStats(),
        checkSubscriptionStatus(),
      ]);
      
      logSecureEvent('subscription_screen_viewed', {
        current_tier: currentTier,
        is_online: isOnline,
      });
      
    } catch (error) {
      console.error('Subscription initialization error:', error);
      dispatch(setError(t('errors.subscription_init_failed')));
      await loadOfflineData();
    } finally {
      dispatch(setLoading(false));
    }
  }, [currentTier, isOnline, t]);

  // Configure RevenueCat purchases
  const configurePurchases = useCallback(async () => {
    try {
      const apiKey = Platform.OS === 'ios' 
        ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
        : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
      
      if (!apiKey) {
        throw new Error('RevenueCat API key not configured');
      }

      await Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
      await Purchases.configure({ apiKey });
      
      // Set user ID if available
      if (user?.id) {
        await Purchases.logIn(user.id);
      }
      
      // Load available packages
      const offerings = await Purchases.getOfferings();
      if (offerings.current) {
        setPackages(offerings.current.availablePackages);
      }
      
    } catch (error) {
      console.error('RevenueCat configuration error:', error);
      showToast(t('errors.purchase_config_failed'), 'error');
    }
  }, [user?.id, t]);

  // Load subscription data
  const loadSubscriptionData = useCallback(async () => {
    try {
      const tier = await getCurrentTier();
      const expiry = await getSubscriptionExpiry();
      const capabilities = await getOfflineCapabilities();
      
      setCurrentTier(tier);
      setSelectedTier(tier);
      
      // Cache offline
      const subscriptionData = {
        tier,
        expiry,
        capabilities,
        lastSync: Date.now(),
      };
      
      await AsyncStorage.setItem(
        OFFLINE_KEYS.SUBSCRIPTION_DATA,
        await encryptData(JSON.stringify(subscriptionData))
      );
      
    } catch (error) {
      console.error('Failed to load subscription data:', error);
    }
  }, []);

  // Load usage statistics
  const loadUsageStats = useCallback(async () => {
    try {
      // This would typically come from your API
      const stats = {
        postsThisMonth: Math.floor(Math.random() * 100),
        aiInfluencersCreated: Math.floor(Math.random() * 5),
        contentVariationsGenerated: Math.floor(Math.random() * 200),
        platformsConnected: Math.floor(Math.random() * 10),
      };
      
      setUsageStats(stats);
      
      // Cache offline
      await AsyncStorage.setItem(
        OFFLINE_KEYS.USAGE_LIMITS,
        await encryptData(JSON.stringify(stats))
      );
      
    } catch (error) {
      console.error('Failed to load usage stats:', error);
    }
  }, []);

  // Check current subscription status
  const checkSubscriptionStatus = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') {
        const customerInfo = await Purchases.getCustomerInfo();
        const activeSubscriptions = customerInfo.activeSubscriptions;
        
        if (activeSubscriptions.length > 0) {
          // Update subscription status based on active subscriptions
          const subscriptionType = determineSubscriptionTier(activeSubscriptions);
          setCurrentTier(subscriptionType);
          
          dispatch(updateSubscription({
            tier: subscriptionType,
            isActive: true,
            expiryDate: customerInfo.latestExpirationDate,
          }));
        }
      }
    } catch (error) {
      console.error('Failed to check subscription status:', error);
    }
  }, []);

  // Determine subscription tier from active subscriptions
  const determineSubscriptionTier = (activeSubscriptions: string[]): SubscriptionTier => {
    if (activeSubscriptions.some(sub => sub.includes('enterprise'))) {
      return 'enterprise';
    }
    if (activeSubscriptions.some(sub => sub.includes('premium'))) {
      return 'premium';
    }
    return 'freemium';
  };

  // Load offline data
  const loadOfflineData = useCallback(async () => {
    try {
      const encryptedData = await AsyncStorage.getItem(OFFLINE_KEYS.SUBSCRIPTION_DATA);
      if (encryptedData) {
        const decryptedData = await decryptData(encryptedData);
        const offlineData = JSON.parse(decryptedData);
        setOfflineData(offlineData);
        
        if (!isOnline) {
          setCurrentTier(offlineData.tier);
          setSelectedTier(offlineData.tier);
        }
      }
      
      const encryptedStats = await AsyncStorage.getItem(OFFLINE_KEYS.USAGE_LIMITS);
      if (encryptedStats && !isOnline) {
        const decryptedStats = await decryptData(encryptedStats);
        setUsageStats(JSON.parse(decryptedStats));
      }
      
    } catch (error) {
      console.error('Failed to load offline data:', error);
    }
  }, [isOnline]);

  // Sync offline data when connection restored
  const syncOfflineData = useCallback(async () => {
    try {
      if (offlineData) {
        await loadSubscriptionData();
        await loadUsageStats();
        showToast(t('messages.data_synced'), 'success');
      }
    } catch (error) {
      console.error('Failed to sync offline data:', error);
    }
  }, [offlineData, loadSubscriptionData, loadUsageStats, t]);

  // Handle subscription purchase
  const handleSubscription = useCallback(async (tier: SubscriptionTier) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
      if (tier === 'freemium') {
        await handleFreemiumSelection();
        return;
      }

      if (!isOnline) {
        showToast(t('errors.offline_purchase'), 'error');
        return;
      }

      if (Platform.OS === 'web') {
        await handleWebPurchase(tier);
      } else {
        await handleMobilePurchase(tier);
      }

      logSecureEvent('subscription_purchase_attempted', {
        tier,
        billing_period: billingPeriod,
      });

    } catch (error) {
      console.error('Subscription purchase error:', error);
      showToast(t('errors.purchase_failed'), 'error');
      dispatch(setError(error.message));
    }
  }, [isOnline, billingPeriod, t]);

  // Handle freemium selection
  const handleFreemiumSelection = useCallback(async () => {
    setCurrentTier('freemium');
    setSelectedTier('freemium');
    
    dispatch(updateSubscription({
      tier: 'freemium',
      isActive: true,
      expiryDate: null,
    }));
    
    showToast(t('messages.freemium_activated'), 'success');
    
    // Cache offline
    const subscriptionData = {
      tier: 'freemium',
      expiry: null,
      capabilities: await getOfflineCapabilities(),
      lastSync: Date.now(),
    };
    
    await AsyncStorage.setItem(
      OFFLINE_KEYS.SUBSCRIPTION_DATA,
      await encryptData(JSON.stringify(subscriptionData))
    );
  }, [t]);

  // Handle web purchase (Paddle)
  const handleWebPurchase = useCallback(async (tier: SubscriptionTier) => {
    try {
      // Initialize Paddle.js
      if (typeof window !== 'undefined' && window.Paddle) {
        const productId = getProductIdForTier(tier);
        
        window.Paddle.Checkout.open({
          product: productId,
          email: user?.email,
          successCallback: (data: any) => {
            handlePurchaseSuccess(tier, data);
          },
          closeCallback: () => {
            console.log('Purchase cancelled');
          },
        });
      } else {
        throw new Error('Paddle not loaded');
      }
    } catch (error) {
      console.error('Web purchase error:', error);
      showToast(t('errors.web_purchase_failed'), 'error');
    }
  }, [user?.email, t]);

  // Handle mobile purchase (RevenueCat)
  const handleMobilePurchase = useCallback(async (tier: SubscriptionTier) => {
    try {
      dispatch(setLoading(true));
      
      const packageToPurchase = packages.find(pkg => 
        pkg.identifier.includes(tier.toLowerCase())
      );
      
      if (!packageToPurchase) {
        throw new Error(`Package not found for tier: ${tier}`);
      }

      const { customerInfo } = await Purchases.purchasePackage(packageToPurchase);
      
      if (customerInfo.activeSubscriptions.length > 0) {
        await handlePurchaseSuccess(tier, customerInfo);
      }
      
    } catch (error) {
      if (error.userCancelled) {
        showToast(t('messages.purchase_cancelled'), 'info');
      } else {
        throw error;
      }
    } finally {
      dispatch(setLoading(false));
    }
  }, [packages, t]);

  // Handle successful purchase
  const handlePurchaseSuccess = useCallback(async (tier: SubscriptionTier, data: any) => {
    try {
      setCurrentTier(tier);
      setSelectedTier(tier);
      
      dispatch(updateSubscription({
        tier,
        isActive: true,
        expiryDate: data.expiryDate || Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year from now
      }));
      
      showToast(t('messages.purchase_successful'), 'success');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Update offline cache
      const subscriptionData = {
        tier,
        expiry: data.expiryDate,
        capabilities: await getOfflineCapabilities(),
        lastSync: Date.now(),
      };
      
      await AsyncStorage.setItem(
        OFFLINE_KEYS.SUBSCRIPTION_DATA,
        await encryptData(JSON.stringify(subscriptionData))
      );
      
      logSecureEvent('subscription_purchase_completed', {
        tier,
        transaction_id: data.transactionId || data.transaction?.transactionId,
      });
      
    } catch (error) {
      console.error('Purchase success handling error:', error);
    }
  }, [t]);

  // Get product ID for tier (Paddle)
  const getProductIdForTier = (tier: SubscriptionTier): string => {
    const productIds = {
      premium: process.env.EXPO_PUBLIC_PADDLE_PREMIUM_PRODUCT_ID,
      enterprise: process.env.EXPO_PUBLIC_PADDLE_ENTERPRISE_PRODUCT_ID,
    };
    return productIds[tier] || '';
  };

  // Handle restore purchases
  const handleRestorePurchases = useCallback(async () => {
    try {
      setIsRestoring(true);
      
      if (Platform.OS !== 'web') {
        const customerInfo = await Purchases.restorePurchases();
        
        if (customerInfo.activeSubscriptions.length > 0) {
          const tier = determineSubscriptionTier(customerInfo.activeSubscriptions);
          setCurrentTier(tier);
          
          dispatch(updateSubscription({
            tier,
            isActive: true,
            expiryDate: customerInfo.latestExpirationDate,
          }));
          
          showToast(t('messages.purchases_restored'), 'success');
        } else {
          showToast(t('messages.no_purchases_found'), 'info');
        }
      }
      
      logSecureEvent('subscription_restore_attempted');
      
    } catch (error) {
      console.error('Restore purchases error:', error);
      showToast(t('errors.restore_failed'), 'error');
    } finally {
      setIsRestoring(false);
    }
  }, [t]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await initializeSubscription();
    } catch (error) {
      console.error('Refresh error:', error);
    } finally {
      setRefreshing(false);
    }
  }, [initializeSubscription]);

  // Handle back button press
  const handleBackPress = useCallback(() => {
    // Add any necessary cleanup or navigation logic
    return false; // Allow default back behavior
  }, []);

  // Render tier card
  const renderTierCard = useCallback((tier: SubscriptionTierData, index: number) => {
    const isSelected = selectedTier === tier.id;
    const isCurrent = currentTier === tier.id;
    const canAccess = validateTierAccess(tier.id, currentTier);

    return (
      <Animated.View
        key={tier.id}
        style={[
          styles.tierCard,
          {
            transform: [
              { scale: scaleAnim },
              { translateY: slideAnim },
            ],
            opacity: fadeAnim,
          },
          isSelected && styles.selectedTierCard,
          tier.popular && styles.popularTierCard,
        ]}
      >
        <LinearGradient
          colors={tier.gradientColors}
          style={styles.tierCardGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {tier.popular && (
            <View style={styles.popularBadge}>
              <Text style={styles.popularBadgeText}>
                {t('subscription.popular', 'MOST POPULAR')}
              </Text>
            </View>
          )}
          
          {isCurrent && (
            <View style={styles.currentBadge}>
              <Icon name="checkmark-circle" size={20} color="#00CEC9" />
              <Text style={styles.currentBadgeText}>
                {t('subscription.current', 'Current Plan')}
              </Text>
            </View>
          )}

          <View style={styles.tierHeader}>
            <Text style={[styles.tierName, { color: tier.id === 'freemium' ? '#2D3436' : '#FFFFFF' }]}>
              {tier.name}
            </Text>
            <View style={styles.priceContainer}>
              <Text style={[styles.tierPrice, { color: tier.id === 'freemium' ? '#2D3436' : '#FFFFFF' }]}>
                {tier.price}
              </Text>
              <Text style={[styles.tierPeriod, { color: tier.id === 'freemium' ? '#636E72' : '#A29BFE' }]}>
                {tier.period}
              </Text>
            </View>
          </View>

          {tier.id !== 'freemium' && (
            <View style={styles.billingToggle}>
              <TouchableOpacity
                style={[
                  styles.billingOption,
                  billingPeriod === 'monthly' && styles.billingOptionActive,
                ]}
                onPress={() => setBillingPeriod('monthly')}
              >
                <Text style={[
                  styles.billingOptionText,
                  billingPeriod === 'monthly' && styles.billingOptionTextActive,
                ]}>
                  {t('billing.monthly', 'Monthly')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.billingOption,
                  billingPeriod === 'yearly' && styles.billingOptionActive,
                ]}
                onPress={() => setBillingPeriod('yearly')}
              >
                <Text style={[
                  styles.billingOptionText,
                  billingPeriod === 'yearly' && styles.billingOptionTextActive,
                ]}>
                  {t('billing.yearly', 'Yearly')}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.featuresContainer}>
            {tier.features.map(feature => (
              <View key={feature.id} style={[
                styles.featureItem,
                !feature.included && styles.featureDisabled,
              ]}>
                <Icon 
                  name={feature.included ? "checkmark-circle" : "close-circle"} 
                  size={18} 
                  color={feature.included ? 
                    (feature.highlight ? '#00CEC9' : tier.id === 'freemium' ? '#2D3436' : '#FFFFFF') : 
                    '#E17055'} 
                  style={styles.featureIcon}
                />
                <View style={styles.featureTextContainer}>
                  <Text style={[
                    styles.featureName,
                    { color: tier.id === 'freemium' ? '#2D3436' : '#FFFFFF' },
                    feature.highlight && styles.highlightFeature,
                  ]}>
                    {feature.name}
                  </Text>
                  <Text style={[
                    styles.featureDescription,
                    { color: tier.id === 'freemium' ? '#636E72' : '#A29BFE' }
                  ]}>
                    {feature.description}
                  </Text>
                  {!isOnline && feature.offline === false && (
                    <View style={styles.offlineIndicator}>
                      <Icon name="cloud-offline" size={12} color="#FDCB6E" />
                      <Text style={styles.offlineText}>
                        {t('features.requires_online', 'Requires online')}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>

          {tier.id !== 'freemium' && (
            <View style={styles.offlineCapabilitiesContainer}>
              <Text style={styles.offlineTitle}>
                {t('features.offline_capabilities', 'Offline Capabilities')}
              </Text>
              <View style={styles.offlineGrid}>
                {tier.offlineCapabilities.map(capability => (
                  <View key={capability.id} style={styles.capabilityItem}>
                    <Icon 
                      name={capability.available ? "checkmark" : "close"} 
                      size={14} 
                      color={capability.available ? '#00CEC9' : '#E17055'} 
                    />
                    <Text style={styles.capabilityText}>
                      {capability.name}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.selectButton,
              isSelected && styles.selectedButton,
              !canAccess && styles.disabledButton,
            ]}
            onPress={() => {
              if (canAccess) {
                setSelectedTier(tier.id);
                if (tier.id !== currentTier) {
                  setShowBillingModal(true);
                }
              } else {
                Vibration.vibrate(50);
                showToast(
                  t('errors.tier_upgrade_required', 'Upgrade to access this tier'),
                  'warning'
                );
              }
            }}
            disabled={loading || isRestoring}
          >
            {isCurrent ? (
              <Text style={styles.buttonText}>
                {t('buttons.current_plan', 'Current Plan')}
              </Text>
            ) : (
              <Text style={styles.buttonText}>
                {tier.id === 'freemium' 
                  ? t('buttons.select_free', 'Select Free') 
                  : currentTier === 'enterprise' && tier.id === 'premium'
                    ? t('buttons.downgrade', 'Downgrade')
                    : t('buttons.upgrade', 'Upgrade')}
              </Text>
            )}
          </TouchableOpacity>
        </LinearGradient>
      </Animated.View>
    );
  }, [
    selectedTier, 
    currentTier, 
    billingPeriod, 
    isOnline, 
    loading, 
    isRestoring, 
    t,
    fadeAnim,
    slideAnim,
    scaleAnim
  ]);

  // Render usage statistics
  const renderUsageStats = useCallback(() => {
    if (!usageStats) return null;

    const tierData = subscriptionTiers.find(t => t.id === currentTier) || subscriptionTiers[0];
    const isUnlimited = (value: number) => value === -1 ? t('common.unlimited', 'Unlimited') : value;

    return (
      <View style={styles.usageContainer}>
        <Text style={styles.sectionTitle}>
          {t('subscription.your_usage', 'Your Usage')}
        </Text>
        <View style={styles.usageGrid}>
          <View style={styles.usageItem}>
            <Text style={styles.usageValue}>{usageStats.postsThisMonth}</Text>
            <Text style={styles.usageLabel}>
              {t('usage.posts_this_month', 'Posts this month')}
            </Text>
            <Text style={styles.usageLimit}>
              {t('usage.of_limit', 'of {{limit}}', { 
                limit: isUnlimited(tierData.maxPlatforms) 
              })}
            </Text>
          </View>
          <View style={styles.usageItem}>
            <Text style={styles.usageValue}>{usageStats.aiInfluencersCreated}</Text>
            <Text style={styles.usageLabel}>
              {t('usage.ai_influencers', 'AI Influencers')}
            </Text>
            <Text style={styles.usageLimit}>
              {t('usage.of_limit', 'of {{limit}}', { 
                limit: isUnlimited(tierData.maxAIInfluencers) 
              })}
            </Text>
          </View>
          <View style={styles.usageItem}>
            <Text style={styles.usageValue}>{usageStats.contentVariationsGenerated}</Text>
            <Text style={styles.usageLabel}>
              {t('usage.content_variations', 'Content Variations')}
            </Text>
            <Text style={styles.usageLimit}>
              {t('usage.of_limit', 'of {{limit}}', { 
                limit: isUnlimited(tierData.maxContentVariations) 
              })}
            </Text>
          </View>
        </View>
      </View>
    );
  }, [usageStats, currentTier, t]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8F9FA" />
      
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#6C5CE7']}
            tintColor="#6C5CE7"
          />
        }
      >
        <Text style={styles.title}>
          {t('subscription.title', 'Choose Your Plan')}
        </Text>
        <Text style={styles.subtitle}>
          {t('subscription.subtitle', 'Select the plan that fits your social commerce needs')}
        </Text>

        <View style={styles.tiersContainer}>
          {subscriptionTiers.map((tier, index) => renderTierCard(tier, index))}
        </View>

        {renderUsageStats()}

        <TouchableOpacity
          style={styles.restoreButton}
          onPress={handleRestorePurchases}
          disabled={isRestoring || !isOnline}
        >
          {isRestoring ? (
            <ActivityIndicator size="small" color="#6C5CE7" />
          ) : (
            <Text style={styles.restoreButtonText}>
              {t('buttons.restore_purchases', 'Restore Purchases')}
            </Text>
          )}
        </TouchableOpacity>

        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Icon name="cloud-offline" size={18} color="#FDCB6E" />
            <Text style={styles.offlineBannerText}>
              {t('status.offline_mode', 'Offline Mode - Limited functionality')}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Billing Confirmation Modal */}
      <Modal
        visible={showBillingModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBillingModal(false)}
      >
        <BlurView intensity={20} style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {t('billing.confirm_title', 'Confirm Subscription Change')}
            </Text>
            
            <Text style={styles.modalText}>
              {selectedTier === 'freemium'
                ? t('billing.confirm_downgrade', 'Are you sure you want to downgrade to Freemium?')
                : t('billing.confirm_upgrade', 'You are about to subscribe to {{tier}} for {{price}} {{period}}. This will be charged to your payment method.', {
                    tier: t(`subscription.${selectedTier}.title`),
                    price: subscriptionTiers.find(t => t.id === selectedTier)?.price || '',
                    period: billingPeriod === 'monthly' 
                      ? t('billing.per_month', 'per month') 
                      : t('billing.per_year', 'per year')
                  })}
            </Text>
            
            {selectedTier !== 'freemium' && (
              <View style={styles.billingDetails}>
                <View style={styles.billingRow}>
                  <Text style={styles.billingLabel}>
                    {t('billing.plan', 'Plan:')}
                  </Text>
                  <Text style={styles.billingValue}>
                    {t(`subscription.${selectedTier}.title`)}
                  </Text>
                </View>
                <View style={styles.billingRow}>
                  <Text style={styles.billingLabel}>
                    {t('billing.price', 'Price:')}
                  </Text>
                  <Text style={styles.billingValue}>
                    {subscriptionTiers.find(t => t.id === selectedTier)?.price}
                    <Text style={styles.billingPeriod}>
                      {billingPeriod === 'monthly' 
                        ? t('billing.per_month_short', '/mo') 
                        : t('billing.per_year_short', '/yr')}
                    </Text>
                  </Text>
                </View>
                <View style={styles.billingRow}>
                  <Text style={styles.billingLabel}>
                    {t('billing.payment', 'Payment:')}
                  </Text>
                  <Text style={styles.billingValue}>
                    {t('billing.app_store', 'App Store Account')}
                  </Text>
                </View>
              </View>
            )}
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setShowBillingModal(false);
                }}
              >
                <Text style={styles.cancelButtonText}>
                  {t('buttons.cancel', 'Cancel')}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setShowBillingModal(false);
                  handleSubscription(selectedTier);
                }}
              >
                <Text style={styles.confirmButtonText}>
                  {selectedTier === 'freemium'
                    ? t('buttons.confirm_downgrade', 'Confirm Downgrade')
                    : t('buttons.subscribe_now', 'Subscribe Now')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </BlurView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = {
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  scrollContainer: {
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold' as 'bold',
    textAlign: 'center' as 'center',
    color: '#2D3436',
    marginTop: 20,
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center' as 'center',
    color: '#636E72',
    marginTop: 8,
    marginBottom: 30,
    paddingHorizontal: 40,
  },
  tiersContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  tierCard: {
    width: CARD_WIDTH,
    borderRadius: 20,
    overflow: 'hidden' as 'hidden',
    marginBottom: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  selectedTierCard: {
    borderWidth: 2,
    borderColor: '#00CEC9',
  },
  popularTierCard: {
    marginTop: 20,
    marginBottom: 35,
  },
  tierCardGradient: {
    paddingVertical: 25,
    paddingHorizontal: 20,
  },
  popularBadge: {
    position: 'absolute' as 'absolute',
    top: -12,
    right: 20,
    backgroundColor: '#FD79A8',
    paddingHorizontal: 15,
    paddingVertical: 4,
    borderRadius: 20,
  },
  popularBadgeText: {
    color: '#FFFFFF',
    fontWeight: 'bold' as 'bold',
    fontSize: 12,
  },
  currentBadge: {
    position: 'absolute' as 'absolute',
    top: -12,
    left: 20,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row' as 'row',
    alignItems: 'center' as 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  currentBadgeText: {
    color: '#2D3436',
    fontWeight: '600' as '600',
    fontSize: 12,
    marginLeft: 5,
  },
  tierHeader: {
    marginBottom: 20,
  },
  tierName: {
    fontSize: 24,
    fontWeight: 'bold' as 'bold',
  },
  priceContainer: {
    flexDirection: 'row' as 'row',
    alignItems: 'flex-end' as 'flex-end',
    marginTop: 5,
  },
  tierPrice: {
    fontSize: 32,
    fontWeight: '800' as '800',
    lineHeight: 36,
  },
  tierPeriod: {
    fontSize: 16,
    fontWeight: '600' as '600',
    marginLeft: 8,
    marginBottom: 4,
  },
  billingToggle: {
    flexDirection: 'row' as 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
  },
  billingOption: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center' as 'center',
  },
  billingOptionActive: {
    backgroundColor: '#FFFFFF',
  },
  billingOptionText: {
    fontWeight: '600' as '600',
    color: '#FFFFFF',
  },
  billingOptionTextActive: {
    color: '#6C5CE7',
  },
  featuresContainer: {
    marginBottom: 20,
  },
  featureItem: {
    flexDirection: 'row' as 'row',
    marginBottom: 12,
  },
  featureDisabled: {
    opacity: 0.6,
  },
  featureIcon: {
    marginRight: 10,
    marginTop: 3,
  },
  featureTextContainer: {
    flex: 1,
  },
  featureName: {
    fontSize: 15,
    fontWeight: '600' as '600',
    marginBottom: 2,
  },
  highlightFeature: {
    color: '#00CEC9',
    fontWeight: '700' as '700',
  },
  featureDescription: {
    fontSize: 13,
  },
  offlineIndicator: {
    flexDirection: 'row' as 'row',
    alignItems: 'center' as 'center',
    marginTop: 4,
  },
  offlineText: {
    fontSize: 11,
    color: '#FDCB6E',
    marginLeft: 4,
  },
  offlineCapabilitiesContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
  },
  offlineTitle: {
    fontSize: 16,
    fontWeight: '600' as '600',
    color: '#FFFFFF',
    marginBottom: 10,
  },
  offlineGrid: {
    flexDirection: 'row' as 'row',
    flexWrap: 'wrap' as 'wrap',
  },
  capabilityItem: {
    flexDirection: 'row' as 'row',
    alignItems: 'center' as 'center',
    width: '50%',
    marginBottom: 8,
  },
  capabilityText: {
    fontSize: 13,
    color: '#FFFFFF',
    marginLeft: 6,
  },
  selectButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center' as 'center',
  },
  selectedButton: {
    backgroundColor: 'rgba(0, 206, 201, 0.2)',
    borderWidth: 1,
    borderColor: '#00CEC9',
  },
  disabledButton: {
    opacity: 0.6,
  },
  buttonText: {
    fontWeight: 'bold' as 'bold',
    color: '#2D3436',
  },
  usageContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold' as 'bold',
    color: '#2D3436',
    marginBottom: 15,
  },
  usageGrid: {
    flexDirection: 'row' as 'row',
    justifyContent: 'space-between' as 'space-between',
  },
  usageItem: {
    alignItems: 'center' as 'center',
    flex: 1,
  },
  usageValue: {
    fontSize: 24,
    fontWeight: 'bold' as 'bold',
    color: '#6C5CE7',
    marginBottom: 4,
  },
  usageLabel: {
    fontSize: 14,
    color: '#636E72',
    textAlign: 'center' as 'center',
  },
  usageLimit: {
    fontSize: 12,
    color: '#B2BEC3',
    marginTop: 4,
  },
  restoreButton: {
    alignSelf: 'center' as 'center',
    paddingVertical: 12,
    paddingHorizontal: 25,
  },
  restoreButtonText: {
    color: '#6C5CE7',
    fontWeight: '600' as '600',
  },
  offlineBanner: {
    flexDirection: 'row' as 'row',
    alignItems: 'center' as 'center',
    justifyContent: 'center' as 'center',
    backgroundColor: 'rgba(253, 203, 110, 0.15)',
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginHorizontal: 20,
    borderRadius: 12,
    marginTop: 10,
  },
  offlineBannerText: {
    color: '#FDCB6E',
    fontWeight: '500' as '500',
    marginLeft: 8,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center' as 'center',
    alignItems: 'center' as 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    width: width * 0.85,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 25,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold' as 'bold',
    color: '#2D3436',
    marginBottom: 15,
    textAlign: 'center' as 'center',
  },
  modalText: {
    fontSize: 16,
    color: '#636E72',
    lineHeight: 24,
    marginBottom: 20,
    textAlign: 'center' as 'center',
  },
  billingDetails: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
  },
  billingRow: {
    flexDirection: 'row' as 'row',
    justifyContent: 'space-between' as 'space-between',
    marginBottom: 10,
  },
  billingLabel: {
    fontSize: 15,
    color: '#636E72',
    fontWeight: '500' as '500',
  },
  billingValue: {
    fontSize: 15,
    fontWeight: '600' as '600',
    color: '#2D3436',
  },
  billingPeriod: {
    fontSize: 13,
    color: '#B2BEC3',
  },
  modalButtons: {
    flexDirection: 'row' as 'row',
    justifyContent: 'space-between' as 'space-between',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center' as 'center',
  },
  cancelButton: {
    backgroundColor: '#F8F9FA',
    marginRight: 10,
  },
  confirmButton: {
    backgroundColor: '#6C5CE7',
    marginLeft: 10,
  },
  cancelButtonText: {
    color: '#2D3436',
    fontWeight: '600' as '600',
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontWeight: '600' as '600',
  },
};

export default SubscriptionScreen;