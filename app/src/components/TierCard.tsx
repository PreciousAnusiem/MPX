import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  Platform,
  Alert,
  Vibration,
} from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import NetInfo from '@react-native-community/netinfo';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { RootState } from '../store';
import { updateSubscription, setOfflineMode } from '../store/userSlice';
import { subscriptionService } from '../services/subscription';
import { analyticsService } from '../services/analytics';
import { themeService } from '../services/theme';
import { encryptionService } from '../services/encryption';
import { offlineService } from '../services/offline';
import { TIER_COLORS, SUBSCRIPTION_TIERS, STORAGE_KEYS } from '../utils/constants';
import { SubscriptionTier, TierFeature } from '../types';

interface TierCardProps {
  tier: SubscriptionTier;
  isActive?: boolean;
  isRecommended?: boolean;
  onSelect: (tier: SubscriptionTier) => void;
  showComparison?: boolean;
  compactMode?: boolean;
  testID?: string;
}

const { width: screenWidth } = Dimensions.get('window');
const CARD_WIDTH = screenWidth * 0.85;
const COMPACT_CARD_WIDTH = screenWidth * 0.42;

export const TierCard: React.FC<TierCardProps> = ({
  tier,
  isActive = false,
  isRecommended = false,
  onSelect,
  showComparison = false,
  compactMode = false,
  testID,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  
  const { currentTier, isOffline } = useSelector((state: RootState) => state.user);
  const { theme } = useSelector((state: RootState) => state.theme);
  
  const [animatedValue] = useState(new Animated.Value(0));
  const [isLoading, setIsLoading] = useState(false);
  const [localFeatures, setLocalFeatures] = useState<TierFeature[]>([]);
  const [popularityScore, setPopularityScore] = useState(0);
  const [isNetworkAvailable, setIsNetworkAvailable] = useState(true);

  // Offline-first feature loading
  useEffect(() => {
    loadTierData();
    checkNetworkStatus();
    calculatePopularityScore();
  }, [tier]);

  const loadTierData = async () => {
    try {
      // Load cached tier data first (offline-first)
      const cachedData = await AsyncStorage.getItem(`${STORAGE_KEYS.TIER_DATA}_${tier.id}`);
      if (cachedData) {
        const decryptedData = await encryptionService.decrypt(cachedData);
        setLocalFeatures(JSON.parse(decryptedData).features);
      }

      // Update with fresh data if online
      if (isNetworkAvailable) {
        const freshData = await subscriptionService.getTierDetails(tier.id);
        setLocalFeatures(freshData.features);
        
        // Cache encrypted data
        const encryptedData = await encryptionService.encrypt(JSON.stringify(freshData));
        await AsyncStorage.setItem(`${STORAGE_KEYS.TIER_DATA}_${tier.id}`, encryptedData);
      }
    } catch (error) {
      // Fallback to hardcoded features if cache fails
      setLocalFeatures(SUBSCRIPTION_TIERS[tier.id]?.features || []);
      offlineService.logError('TierCard', 'Failed to load tier data', error);
    }
  };

  const checkNetworkStatus = async () => {
    const netInfo = await NetInfo.fetch();
    setIsNetworkAvailable(netInfo.isConnected || false);
    if (!netInfo.isConnected) {
      dispatch(setOfflineMode(true));
    }
  };

  const calculatePopularityScore = async () => {
    try {
      // Calculate based on cached analytics or default values
      const cachedScore = await AsyncStorage.getItem(`${STORAGE_KEYS.POPULARITY}_${tier.id}`);
      if (cachedScore) {
        setPopularityScore(parseInt(cachedScore, 10));
      } else {
        // Default popularity scores for offline mode
        const defaultScores = { freemium: 85, premium: 92, enterprise: 78 };
        setPopularityScore(defaultScores[tier.id as keyof typeof defaultScores] || 75);
      }
    } catch (error) {
      setPopularityScore(75); // Safe fallback
    }
  };

  // Memoized feature list with offline support
  const tierFeatures = useMemo(() => {
    if (localFeatures.length > 0) return localFeatures;
    
    // Offline fallback features
    const offlineFeatures = {
      freemium: [
        { id: 'platforms', name: t('features.platforms_5'), enabled: true, offline: true },
        { id: 'ai_influencer', name: t('features.ai_influencer_1'), enabled: true, offline: true },
        { id: 'content_variations', name: t('features.content_variations_10'), enabled: true, offline: true },
        { id: 'basic_analytics', name: t('features.basic_analytics'), enabled: true, offline: true },
        { id: 'offline_mode', name: t('features.offline_mode'), enabled: true, offline: true },
      ],
      premium: [
        { id: 'platforms', name: t('features.platforms_50'), enabled: true, offline: false },
        { id: 'ai_influencers', name: t('features.ai_influencers_3'), enabled: true, offline: true },
        { id: 'content_variations', name: t('features.content_variations_100'), enabled: true, offline: true },
        { id: 'cultural_adaptation', name: t('features.cultural_adaptation'), enabled: true, offline: false },
        { id: 'predictive_inventory', name: t('features.predictive_inventory'), enabled: true, offline: false },
        { id: 'advanced_analytics', name: t('features.advanced_analytics'), enabled: true, offline: true },
        { id: 'voice_cloning', name: t('features.voice_cloning'), enabled: true, offline: true },
      ],
      enterprise: [
        { id: 'unlimited_platforms', name: t('features.unlimited_platforms'), enabled: true, offline: false },
        { id: 'unlimited_ai', name: t('features.unlimited_ai'), enabled: true, offline: true },
        { id: 'custom_voice_cloning', name: t('features.custom_voice_cloning'), enabled: true, offline: true },
        { id: 'anticipatory_shipping', name: t('features.anticipatory_shipping'), enabled: true, offline: false },
        { id: 'team_management', name: t('features.team_management'), enabled: true, offline: true },
        { id: 'api_access', name: t('features.api_access'), enabled: true, offline: false },
        { id: 'priority_support', name: t('features.priority_support'), enabled: true, offline: false },
        { id: 'white_label', name: t('features.white_label'), enabled: true, offline: true },
      ],
    };
    
    return offlineFeatures[tier.id as keyof typeof offlineFeatures] || [];
  }, [localFeatures, tier.id, t]);

  // Animation for card entrance
  useEffect(() => {
    Animated.spring(animatedValue, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleSelectTier = async () => {
    if (isLoading) return;
    
    try {
      setIsLoading(true);
      
      // Haptic feedback
      if (Platform.OS === 'ios') {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        Vibration.vibrate(50);
      }

      // Analytics tracking (offline-queued)
      analyticsService.trackEvent('tier_card_selected', {
        tier_id: tier.id,
        is_upgrade: tier.id !== 'freemium',
        is_offline: !isNetworkAvailable,
        timestamp: Date.now(),
      });

      // Handle offline mode
      if (!isNetworkAvailable && tier.id !== 'freemium') {
        Alert.alert(
          t('alerts.offline_title'),
          t('alerts.offline_subscription_message'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { 
              text: t('common.continue_offline'), 
              onPress: () => {
                offlineService.queueAction('subscription_request', { tierId: tier.id });
                onSelect(tier);
              }
            },
          ]
        );
        return;
      }

      onSelect(tier);
    } catch (error) {
      offlineService.logError('TierCard', 'Selection failed', error);
      Alert.alert(t('alerts.error'), t('alerts.selection_failed'));
    } finally {
      setIsLoading(false);
    }
  };

  const renderFeature = (feature: TierFeature, index: number) => (
    <Animated.View
      key={feature.id}
      style={[
        styles.featureRow,
        { 
          opacity: animatedValue,
          transform: [{
            translateX: animatedValue.interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0],
            }),
          }],
        },
      ]}
    >
      <View style={[styles.featureIcon, { backgroundColor: theme.accent }]}>
        <Ionicons
          name={feature.enabled ? 'checkmark' : 'close'}
          size={12}
          color={theme.background}
        />
      </View>
      <Text 
        style={[
          styles.featureText, 
          { color: theme.textSecondary },
          !feature.enabled && styles.disabledFeature,
          !isNetworkAvailable && !feature.offline && styles.offlineDisabled,
        ]}
        numberOfLines={compactMode ? 1 : 2}
      >
        {feature.name}
        {!isNetworkAvailable && !feature.offline && ' (⚡)'}
      </Text>
    </Animated.View>
  );

  const renderPopularityBadge = () => {
    if (!isRecommended && popularityScore < 90) return null;
    
    return (
      <View style={[styles.popularityBadge, { backgroundColor: theme.success }]}>
        <Text style={styles.popularityText}>
          {isRecommended ? t('badges.recommended') : `${popularityScore}% ${t('badges.popular')}`}
        </Text>
      </View>
    );
  };

  const renderPricing = () => (
    <View style={styles.pricingContainer}>
      <Text style={[styles.priceText, { color: theme.textPrimary }]}>
        {tier.price === 'Free' ? t('pricing.free') : tier.price}
      </Text>
      {tier.period && (
        <Text style={[styles.periodText, { color: theme.textSecondary }]}>
          /{tier.period}
        </Text>
      )}
      {tier.originalPrice && tier.originalPrice !== tier.price && (
        <Text style={[styles.originalPrice, { color: theme.textMuted }]}>
          {tier.originalPrice}
        </Text>
      )}
    </View>
  );

  const cardStyle = [
    styles.card,
    compactMode && styles.compactCard,
    isActive && [styles.activeCard, { borderColor: theme.primary }],
    { backgroundColor: theme.cardBackground },
    {
      transform: [{
        scale: animatedValue.interpolate({
          inputRange: [0, 1],
          outputRange: [0.95, 1],
        }),
      }],
      opacity: animatedValue,
    },
  ];

  return (
    <Animated.View style={cardStyle} testID={testID}>
      <LinearGradient
        colors={TIER_COLORS[tier.id] || ['#6C5CE7', '#A29BFE']}
        style={styles.gradientHeader}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.headerContent}>
          <Text style={styles.tierTitle}>{t(`tiers.${tier.id}.title`)}</Text>
          {renderPopularityBadge()}
        </View>
        {renderPricing()}
      </LinearGradient>

      <View style={[styles.content, { backgroundColor: theme.cardBackground }]}>
        <Text style={[styles.description, { color: theme.textSecondary }]} numberOfLines={compactMode ? 2 : 3}>
          {t(`tiers.${tier.id}.description`)}
        </Text>

        <View style={styles.featuresContainer}>
          {tierFeatures.slice(0, compactMode ? 3 : 6).map(renderFeature)}
          {tierFeatures.length > (compactMode ? 3 : 6) && (
            <Text style={[styles.moreFeatures, { color: theme.textMuted }]}>
              +{tierFeatures.length - (compactMode ? 3 : 6)} {t('common.more_features')}
            </Text>
          )}
        </View>

        {!isNetworkAvailable && (
          <View style={[styles.offlineIndicator, { backgroundColor: theme.warning }]}>
            <Ionicons name="cloud-offline" size={14} color={theme.background} />
            <Text style={[styles.offlineText, { color: theme.background }]}>
              {t('status.offline_mode')}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.selectButton,
            { backgroundColor: isActive ? theme.success : theme.primary },
            isLoading && styles.loadingButton,
          ]}
          onPress={handleSelectTier}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <Animated.View
                style={[
                  styles.loadingSpinner,
                  {
                    transform: [{
                      rotate: animatedValue.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '360deg'],
                      }),
                    }],
                  },
                ]}
              />
              <Text style={styles.loadingText}>{t('common.loading')}</Text>
            </View>
          ) : (
            <Text style={styles.selectButtonText}>
              {isActive ? t('common.current_plan') : 
               tier.id === 'freemium' ? t('common.get_started') : t('common.upgrade')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {showComparison && (
        <BlurView intensity={80} style={styles.comparisonOverlay}>
          <Text style={styles.comparisonText}>{t('common.compare_plans')}</Text>
        </BlurView>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    marginHorizontal: 10,
    marginVertical: 8,
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  compactCard: {
    width: COMPACT_CARD_WIDTH,
    marginHorizontal: 6,
  },
  activeCard: {
    borderWidth: 2,
    elevation: 12,
    shadowOpacity: 0.25,
  },
  gradientHeader: {
    padding: 20,
    paddingBottom: 16,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tierTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  popularityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  popularityText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  pricingContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  priceText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  periodText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
    opacity: 0.8,
    marginLeft: 4,
  },
  originalPrice: {
    fontSize: 14,
    textDecorationLine: 'line-through',
    marginLeft: 8,
    opacity: 0.6,
  },
  content: {
    padding: 20,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  featuresContainer: {
    marginBottom: 20,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  featureIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  featureText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  disabledFeature: {
    opacity: 0.5,
    textDecorationLine: 'line-through',
  },
  offlineDisabled: {
    opacity: 0.3,
  },
  moreFeatures: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
  },
  offlineIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  offlineText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  selectButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  loadingButton: {
    opacity: 0.7,
  },
  selectButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingSpinner: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderTopColor: 'transparent',
    borderRadius: 8,
    marginRight: 8,
  },
  loadingText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  comparisonOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  comparisonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});

export default TierCard;