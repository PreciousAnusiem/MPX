import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  Alert,
  StyleSheet,
  Platform,
  Share,
  BackHandler,
} from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

// Redux imports
import { RootState } from '../store';
import { setUser, updateSubscription } from '../store/userSlice';
import { setContent, addOfflineContent } from '../store/contentSlice';
import { updateNetworkStatus } from '../store/appSlice';

// Services
import { api } from '../services/api';
import { authService } from '../services/auth';
import { subscriptionService } from '../services/subscription';
import { analyticsService } from '../services/analytics';
import { offlineService } from '../services/offline';

// Components
import { TierCard } from '../components/TierCard';
import { FeatureCard } from '../components/FeatureCard';
import { StatCard } from '../components/StatCard';
import { QuickActionButton } from '../components/QuickActionButton';
import { Loading } from '../components/Loading';
import { OfflineBanner } from '../components/OfflineBanner';
import { LanguageSelector } from '../components/LanguageSelector';

// Utils
import { colors, spacing, typography, borderRadius } from '../utils/theme';
import { formatNumber, getGreeting, getTierColor } from '../utils/helpers';
import { useI18n } from '../utils/i18n';
import { STORAGE_KEYS, FEATURE_FLAGS } from '../utils/constants';

// Types
import {
  User,
  DashboardData,
  FeatureAccess,
  QuickStats,
  OfflineAction,
} from '../types';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface DashboardScreenProps {
  route?: any;
  navigation?: any;
}

const DashboardScreen: React.FC<DashboardScreenProps> = () => {
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const { t, currentLanguage } = useI18n();

  // Redux state
  const user = useSelector((state: RootState) => state.user.profile);
  const subscription = useSelector((state: RootState) => state.user.subscription);
  const isOnline = useSelector((state: RootState) => state.app.isOnline);
  const offlineContent = useSelector((state: RootState) => state.content.offline);

  // Local state
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [quickStats, setQuickStats] = useState<QuickStats>({
    totalPosts: 0,
    totalViews: 0,
    engagementRate: 0,
    followers: 0,
  });
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  // Animations
  const fadeAnim = useSharedValue(0);
  const scaleAnim = useSharedValue(0.9);
  const slideAnim = useSharedValue(-50);

  // Feature access based on subscription tier
  const featureAccess = useMemo((): FeatureAccess => {
    const tier = subscription?.tier || 'freemium';
    return {
      maxPlatforms: tier === 'freemium' ? 5 : tier === 'premium' ? 50 : -1,
      maxInfluencers: tier === 'freemium' ? 1 : tier === 'premium' ? 3 : -1,
      contentVariations: tier === 'freemium' ? 10 : tier === 'premium' ? 100 : -1,
      culturalAdaptation: tier !== 'freemium',
      predictiveInventory: tier !== 'freemium',
      advancedAnalytics: tier === 'enterprise',
      voiceCloning: tier === 'enterprise',
      prioritySupport: tier === 'enterprise',
      apiAccess: tier === 'enterprise',
      teamManagement: tier === 'enterprise',
    };
  }, [subscription?.tier]);

  // Initialize dashboard
  useEffect(() => {
    initializeDashboard();
    setupNetworkListener();
    setupBackgroundSync();
    
    // Start animations
    fadeAnim.value = withTiming(1, { duration: 800 });
    scaleAnim.value = withSpring(1, { damping: 15 });
    slideAnim.value = withSpring(0, { damping: 12 });
  }, []);

  // Focus effect for real-time updates
  useFocusEffect(
    useCallback(() => {
      refreshDashboard();
      analyticsService.trackScreenView('dashboard', {
        tier: subscription?.tier,
        language: currentLanguage,
      });

      const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
        // Double tap to exit
        if (Platform.OS === 'android') {
          Alert.alert(
            t('common.confirmExit'),
            t('common.exitAppConfirm'),
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.exit'), onPress: () => BackHandler.exitApp() },
            ]
          );
          return true;
        }
        return false;
      });

      return () => backHandler.remove();
    }, [subscription?.tier, currentLanguage])
  );

  const initializeDashboard = async () => {
    setIsLoading(true);
    try {
      // Load cached data first for instant display
      await loadCachedData();
      
      // Check and restore offline actions
      await processOfflineActions();
      
      // If online, fetch fresh data
      if (isOnline) {
        await fetchDashboardData();
      }
    } catch (error) {
      console.error('Dashboard initialization error:', error);
      // Show cached data even on error
      await loadCachedData();
    } finally {
      setIsLoading(false);
    }
  };

  const loadCachedData = async () => {
    try {
      const cachedData = await AsyncStorage.getItem(STORAGE_KEYS.DASHBOARD_DATA);
      const cachedStats = await AsyncStorage.getItem(STORAGE_KEYS.QUICK_STATS);
      const lastSync = await AsyncStorage.getItem(STORAGE_KEYS.LAST_SYNC);

      if (cachedData) {
        setDashboardData(JSON.parse(cachedData));
      }
      if (cachedStats) {
        setQuickStats(JSON.parse(cachedStats));
      }
      if (lastSync) {
        setLastSyncTime(new Date(lastSync));
      }
    } catch (error) {
      console.error('Error loading cached data:', error);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const [dashboardResponse, statsResponse] = await Promise.all([
        api.getDashboardData(user?.id || ''),
        api.getQuickStats(user?.id || ''),
      ]);

      const newDashboardData = dashboardResponse.data;
      const newStats = statsResponse.data;

      setDashboardData(newDashboardData);
      setQuickStats(newStats);

      // Cache the data
      await AsyncStorage.multiSet([
        [STORAGE_KEYS.DASHBOARD_DATA, JSON.stringify(newDashboardData)],
        [STORAGE_KEYS.QUICK_STATS, JSON.stringify(newStats)],
        [STORAGE_KEYS.LAST_SYNC, new Date().toISOString()],
      ]);

      setLastSyncTime(new Date());
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      // Continue with cached data
    }
  };

  const processOfflineActions = async () => {
    try {
      const offlineActions = await offlineService.getOfflineActions();
      
      if (isOnline && offlineActions.length > 0) {
        for (const action of offlineActions) {
          await executeOfflineAction(action);
        }
        await offlineService.clearOfflineActions();
      }
    } catch (error) {
      console.error('Error processing offline actions:', error);
    }
  };

  const executeOfflineAction = async (action: OfflineAction) => {
    try {
      switch (action.type) {
        case 'create_content':
          await api.createContent(action.data);
          break;
        case 'post_social':
          await api.postToSocial(action.data);
          break;
        case 'update_profile':
          await api.updateProfile(action.data);
          break;
        default:
          console.warn('Unknown offline action type:', action.type);
      }
    } catch (error) {
      console.error('Error executing offline action:', error);
      // Re-queue action for later
      await offlineService.addOfflineAction(action);
    }
  };

  const setupNetworkListener = () => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      dispatch(updateNetworkStatus(state.isConnected || false));
      
      if (state.isConnected && !isOnline) {
        // Connection restored, sync data
        processOfflineActions();
        refreshDashboard();
      }
    });

    return unsubscribe;
  };

  const setupBackgroundSync = () => {
    // Auto-refresh every 5 minutes when app is active
    const interval = setInterval(() => {
      if (isOnline && !isRefreshing) {
        refreshDashboard(false); // Silent refresh
      }
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  };

  const refreshDashboard = async (showIndicator = true) => {
    if (showIndicator) setIsRefreshing(true);
    
    try {
      await fetchDashboardData();
    } catch (error) {
      console.error('Refresh error:', error);
    } finally {
      if (showIndicator) setIsRefreshing(false);
    }
  };

  const handleFeaturePress = useCallback((feature: string) => {
    const hasAccess = checkFeatureAccess(feature);
    
    if (!hasAccess) {
      setShowUpgradePrompt(true);
      analyticsService.trackEvent('feature_blocked', {
        feature,
        tier: subscription?.tier,
      });
      return;
    }

    analyticsService.trackEvent('feature_accessed', {
      feature,
      tier: subscription?.tier,
    });

    switch (feature) {
      case 'content_studio':
        navigation.navigate('ContentStudio');
        break;
      case 'social_manager':
        navigation.navigate('SocialManager');
        break;
      case 'influencer_lab':
        navigation.navigate('InfluencerLab');
        break;
      case 'analytics':
        navigation.navigate('Analytics');
        break;
      case 'inventory':
        navigation.navigate('Inventory');
        break;
      default:
        console.warn('Unknown feature:', feature);
    }
  }, [subscription?.tier, navigation]);

  const checkFeatureAccess = (feature: string): boolean => {
    switch (feature) {
      case 'content_studio':
      case 'social_manager':
        return true; // Available in all tiers
      case 'influencer_lab':
        return featureAccess.maxInfluencers > 0;
      case 'analytics':
        return featureAccess.advancedAnalytics || subscription?.tier !== 'freemium';
      case 'inventory':
        return featureAccess.predictiveInventory;
      default:
        return false;
    }
  };

  const handleUpgrade = () => {
    setShowUpgradePrompt(false);
    navigation.navigate('Subscription');
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: t('dashboard.shareMessage', {
          appName: 'ONXLink',
          stats: `${formatNumber(quickStats.totalPosts)} posts, ${formatNumber(quickStats.totalViews)} views`,
        }),
        url: 'https://onxlink.app',
      });
      
      analyticsService.trackEvent('app_shared', {
        source: 'dashboard',
        tier: subscription?.tier,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  // Gesture handlers for enhanced UX
  const pullToRefreshGesture = Gesture.Pan()
    .onEnd((event) => {
      if (event.translationY > 100 && event.velocityY > 500) {
        runOnJS(refreshDashboard)();
      }
    });

  // Animated styles
  const containerStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
    transform: [
      { scale: scaleAnim.value },
      { translateY: slideAnim.value },
    ],
  }));

  const renderHeader = () => (
    <View style={styles.header}>
      <LinearGradient
        colors={getTierColor(subscription?.tier)}
        style={styles.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <BlurView intensity={20} style={styles.headerContent}>
          <View style={styles.greetingContainer}>
            <Text style={styles.greeting}>
              {getGreeting()}, {user?.name || t('common.user')}
            </Text>
            <Text style={styles.subGreeting}>
              {t('dashboard.welcome', { tier: subscription?.tier?.toUpperCase() })}
            </Text>
          </View>
          
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleShare} style={styles.headerButton}>
              <Text style={styles.headerButtonText}>📤</Text>
            </TouchableOpacity>
            <LanguageSelector />
          </View>
        </BlurView>
      </LinearGradient>
    </View>
  );

  const renderQuickStats = () => (
    <View style={styles.statsContainer}>
      <Text style={styles.sectionTitle}>{t('dashboard.quickStats')}</Text>
      <View style={styles.statsGrid}>
        <StatCard
          title={t('dashboard.totalPosts')}
          value={formatNumber(quickStats.totalPosts)}
          icon="📝"
          trend={dashboardData?.trends?.posts}
        />
        <StatCard
          title={t('dashboard.totalViews')}
          value={formatNumber(quickStats.totalViews)}
          icon="👀"
          trend={dashboardData?.trends?.views}
        />
        <StatCard
          title={t('dashboard.engagement')}
          value={`${quickStats.engagementRate.toFixed(1)}%`}
          icon="❤️"
          trend={dashboardData?.trends?.engagement}
        />
        <StatCard
          title={t('dashboard.followers')}
          value={formatNumber(quickStats.followers)}
          icon="👥"
          trend={dashboardData?.trends?.followers}
        />
      </View>
    </View>
  );

  const renderQuickActions = () => (
    <View style={styles.actionsContainer}>
      <Text style={styles.sectionTitle}>{t('dashboard.quickActions')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.actionsGrid}>
          <QuickActionButton
            title={t('dashboard.createContent')}
            icon="✨"
            onPress={() => handleFeaturePress('content_studio')}
            disabled={!isOnline && FEATURE_FLAGS.REQUIRE_ONLINE_CONTENT}
          />
          <QuickActionButton
            title={t('dashboard.postSocial')}
            icon="📱"
            onPress={() => handleFeaturePress('social_manager')}
          />
          <QuickActionButton
            title={t('dashboard.aiInfluencer')}
            icon="🤖"
            onPress={() => handleFeaturePress('influencer_lab')}
            locked={!checkFeatureAccess('influencer_lab')}
          />
          <QuickActionButton
            title={t('dashboard.analytics')}
            icon="📊"
            onPress={() => handleFeaturePress('analytics')}
            locked={!checkFeatureAccess('analytics')}
          />
        </View>
      </ScrollView>
    </View>
  );

  const renderFeatures = () => {
    const availableFeatures = [
      {
        id: 'content_studio',
        title: t('features.contentStudio'),
        description: t('features.contentStudioDesc'),
        icon: '✨',
        available: true,
      },
      {
        id: 'social_manager',
        title: t('features.socialManager'),
        description: t('features.socialManagerDesc', {
          platforms: featureAccess.maxPlatforms === -1 ? '50+' : featureAccess.maxPlatforms,
        }),
        icon: '📱',
        available: true,
      },
      {
        id: 'influencer_lab',
        title: t('features.influencerLab'),
        description: t('features.influencerLabDesc', {
          count: featureAccess.maxInfluencers === -1 ? 'unlimited' : featureAccess.maxInfluencers,
        }),
        icon: '🤖',
        available: checkFeatureAccess('influencer_lab'),
      },
      {
        id: 'predictive_inventory',
        title: t('features.predictiveInventory'),
        description: t('features.predictiveInventoryDesc'),
        icon: '📈',
        available: featureAccess.predictiveInventory,
      },
      {
        id: 'cultural_adaptation',
        title: t('features.culturalAdaptation'),
        description: t('features.culturalAdaptationDesc'),
        icon: '🌍',
        available: featureAccess.culturalAdaptation,
      },
      {
        id: 'advanced_analytics',
        title: t('features.advancedAnalytics'),
        description: t('features.advancedAnalyticsDesc'),
        icon: '📊',
        available: featureAccess.advancedAnalytics,
      },
    ];

    return (
      <View style={styles.featuresContainer}>
        <Text style={styles.sectionTitle}>{t('dashboard.features')}</Text>
        {availableFeatures.map((feature, index) => (
          <FeatureCard
            key={feature.id}
            title={feature.title}
            description={feature.description}
            icon={feature.icon}
            available={feature.available}
            onPress={() => handleFeaturePress(feature.id)}
            delay={index * 100}
          />
        ))}
      </View>
    );
  };

  const renderOfflineContent = () => {
    if (isOnline || offlineContent.length === 0) return null;

    return (
      <View style={styles.offlineContainer}>
        <Text style={styles.sectionTitle}>{t('dashboard.offlineContent')}</Text>
        <Text style={styles.offlineDescription}>
          {t('dashboard.offlineContentDesc', { count: offlineContent.length })}
        </Text>
        <TouchableOpacity
          style={styles.offlineButton}
          onPress={() => navigation.navigate('OfflineContent')}
        >
          <Text style={styles.offlineButtonText}>{t('dashboard.viewOffline')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderUpgradePrompt = () => {
    if (subscription?.tier !== 'freemium') return null;

    return (
      <TierCard
        tier="premium"
        highlighted={true}
        onUpgrade={handleUpgrade}
        style={styles.upgradeCard}
      />
    );
  };

  if (isLoading && !dashboardData) {
    return <Loading />;
  }

  return (
    <GestureDetector gesture={pullToRefreshGesture}>
      <Animated.View style={[styles.container, containerStyle]}>
        {!isOnline && <OfflineBanner />}
        
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refreshDashboard}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {renderHeader()}
          {renderQuickStats()}
          {renderQuickActions()}
          {renderFeatures()}
          {renderOfflineContent()}
          {renderUpgradePrompt()}
          
          {lastSyncTime && (
            <View style={styles.syncInfo}>
              <Text style={styles.syncText}>
                {t('dashboard.lastSync', {
                  time: lastSyncTime.toLocaleTimeString(),
                })}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Upgrade Modal */}
        {showUpgradePrompt && (
          <View style={styles.modalOverlay}>
            <BlurView intensity={50} style={styles.modalBlur}>
              <View style={styles.modal}>
                <Text style={styles.modalTitle}>
                  {t('dashboard.upgradeRequired')}
                </Text>
                <Text style={styles.modalDescription}>
                  {t('dashboard.upgradeDescription')}
                </Text>
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={styles.modalButtonSecondary}
                    onPress={() => setShowUpgradePrompt(false)}
                  >
                    <Text style={styles.modalButtonSecondaryText}>
                      {t('common.cancel')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalButtonPrimary}
                    onPress={handleUpgrade}
                  >
                    <Text style={styles.modalButtonPrimaryText}>
                      {t('common.upgrade')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </BlurView>
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  header: {
    height: 200,
    marginBottom: spacing.lg,
  },
  headerGradient: {
    flex: 1,
    borderBottomLeftRadius: borderRadius.xl,
    borderBottomRightRadius: borderRadius.xl,
  },
  headerContent: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    padding: spacing.lg,
    paddingTop: spacing.xl + 20,
  },
  greetingContainer: {
    flex: 1,
  },
  greeting: {
    ...typography.h2,
    color: colors.white,
    fontWeight: '700',
  },
  subGreeting: {
    ...typography.body,
    color: colors.white,
    opacity: 0.9,
    marginTop: spacing.xs,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerButtonText: {
    fontSize: 18,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
    marginHorizontal: spacing.lg,
  },
  statsContainer: {
    marginBottom: spacing.lg,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  actionsContainer: {
    marginBottom: spacing.lg,
  },
  actionsGrid: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  featuresContainer: {
    marginBottom: spacing.lg,
  },
  offlineContainer: {
    margin: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  offlineDescription: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  offlineButton: {
    backgroundColor: colors.warning,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  offlineButtonText: {
    ...typography.bodyBold,
    color: colors.white,
  },
  upgradeCard: {
    margin: spacing.lg,
  },
  syncInfo: {
    alignItems: 'center',
    padding: spacing.md,
  },
  syncText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalBlur: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modal: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  modalDescription: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  modalButtonSecondary: {
    flex: 1,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalButtonSecondaryText: {
    ...typography.bodyBold,
    color: colors.text,
  },
  modalButtonPrimary: {
    flex: 1,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  modalButtonPrimaryText: {
    ...typography.bodyBold,
    color: colors.white,
  },
});

export default DashboardScreen;