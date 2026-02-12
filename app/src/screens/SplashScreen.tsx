import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Animated,
  StatusBar,
  Dimensions,
  ActivityIndicator,
  AppState,
  AppStateStatus,
  BackHandler,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import i18n from '../utils/i18n';
import { AuthService } from '../services/auth';
import { StorageService } from '../services/storage';
import { AnalyticsService } from '../services/analytics';
import { loadUserProfile, setOfflineMode } from '../store/userSlice';
import { initializeApp, setAppReady } from '../store/appSlice';
import { ThemeService } from '../services/theme';
import { RootState } from '../store';
import { STORAGE_KEYS, APP_CONFIG } from '../utils/constants';

const { width, height } = Dimensions.get('window');

interface SplashScreenProps {
  navigation: any;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ navigation }) => {
  const dispatch = useDispatch();
  const { theme } = useSelector((state: RootState) => state.theme);
  const { isOfflineMode } = useSelector((state: RootState) => state.user);
  
  // Animation refs
  const logoScale = useRef(new Animated.Value(0.3)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslateY = useRef(new Animated.Value(50)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const progressOpacity = useRef(new Animated.Value(0)).current;
  const backgroundGradient = useRef(new Animated.Value(0)).current;
  
  // State management
  const [initializationProgress, setInitializationProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('Starting...');
  const [isOnline, setIsOnline] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  
  // Critical app initialization steps
  const initializationSteps = [
    { key: 'storage', label: 'Initializing storage...', weight: 10 },
    { key: 'theme', label: 'Loading theme...', weight: 8 },
    { key: 'language', label: 'Setting up language...', weight: 8 },
    { key: 'network', label: 'Checking connectivity...', weight: 12 },
    { key: 'auth', label: 'Verifying authentication...', weight: 15 },
    { key: 'user', label: 'Loading user profile...', weight: 12 },
    { key: 'offline', label: 'Preparing offline features...', weight: 10 },
    { key: 'analytics', label: 'Initializing analytics...', weight: 8 },
    { key: 'subscription', label: 'Checking subscription...', weight: 10 },
    { key: 'finalize', label: 'Finalizing setup...', weight: 7 },
  ];

  // Handle app state changes
  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (appState.match(/inactive|background/) && nextAppState === 'active') {
      // App has come to the foreground, re-check network status
      checkNetworkStatus();
    }
    setAppState(nextAppState);
  };

  // Check network connectivity
  const checkNetworkStatus = async () => {
    try {
      const netInfo = await NetInfo.fetch();
      const isConnected = netInfo.isConnected && netInfo.isInternetReachable;
      setIsOnline(isConnected ?? false);
      dispatch(setOfflineMode(!isConnected));
      
      if (!isConnected) {
        setCurrentStep('Offline mode activated');
      }
    } catch (error) {
      console.warn('Network check failed:', error);
      setIsOnline(false);
      dispatch(setOfflineMode(true));
    }
  };

  // Update progress with animation
  const updateProgress = (step: string, progress: number) => {
    setCurrentStep(step);
    setInitializationProgress(progress);
  };

  // Initialize core app services
  const initializeAppServices = async () => {
    let cumulativeProgress = 0;
    
    try {
      // Step 1: Initialize storage
      updateProgress(initializationSteps[0].label, 0);
      await StorageService.initialize();
      cumulativeProgress += initializationSteps[0].weight;
      updateProgress(initializationSteps[0].label, cumulativeProgress);

      // Step 2: Load theme
      updateProgress(initializationSteps[1].label, cumulativeProgress);
      await ThemeService.loadTheme();
      cumulativeProgress += initializationSteps[1].weight;
      updateProgress(initializationSteps[1].label, cumulativeProgress);

      // Step 3: Initialize language
      updateProgress(initializationSteps[2].label, cumulativeProgress);
      const savedLanguage = await AsyncStorage.getItem(STORAGE_KEYS.LANGUAGE);
      if (savedLanguage) {
        await i18n.changeLanguage(savedLanguage);
      }
      cumulativeProgress += initializationSteps[2].weight;
      updateProgress(initializationSteps[2].label, cumulativeProgress);

      // Step 4: Check network
      updateProgress(initializationSteps[3].label, cumulativeProgress);
      await checkNetworkStatus();
      cumulativeProgress += initializationSteps[3].weight;
      updateProgress(initializationSteps[3].label, cumulativeProgress);

      // Step 5: Initialize authentication
      updateProgress(initializationSteps[4].label, cumulativeProgress);
      const authInitialized = await AuthService.initialize();
      cumulativeProgress += initializationSteps[4].weight;
      updateProgress(initializationSteps[4].label, cumulativeProgress);

      // Step 6: Load user profile
      updateProgress(initializationSteps[5].label, cumulativeProgress);
      if (authInitialized && isOnline) {
        try {
          await dispatch(loadUserProfile()).unwrap();
        } catch (error) {
          // Load cached user data if online loading fails
          const cachedUser = await StorageService.getSecureData(STORAGE_KEYS.USER_PROFILE);
          if (cachedUser) {
            dispatch(loadUserProfile(JSON.parse(cachedUser)));
          }
        }
      } else {
        // Load cached user data for offline mode
        const cachedUser = await StorageService.getSecureData(STORAGE_KEYS.USER_PROFILE);
        if (cachedUser) {
          dispatch(loadUserProfile(JSON.parse(cachedUser)));
        }
      }
      cumulativeProgress += initializationSteps[5].weight;
      updateProgress(initializationSteps[5].label, cumulativeProgress);

      // Step 7: Prepare offline features
      updateProgress(initializationSteps[6].label, cumulativeProgress);
      await prepareOfflineFeatures();
      cumulativeProgress += initializationSteps[6].weight;
      updateProgress(initializationSteps[6].label, cumulativeProgress);

      // Step 8: Initialize analytics (only if online)
      updateProgress(initializationSteps[7].label, cumulativeProgress);
      if (isOnline) {
        await AnalyticsService.initialize();
        AnalyticsService.logEvent('app_startup', {
          startup_time: Date.now(),
          is_offline: !isOnline,
        });
      }
      cumulativeProgress += initializationSteps[7].weight;
      updateProgress(initializationSteps[7].label, cumulativeProgress);

      // Step 9: Check subscription status
      updateProgress(initializationSteps[8].label, cumulativeProgress);
      await checkSubscriptionStatus();
      cumulativeProgress += initializationSteps[8].weight;
      updateProgress(initializationSteps[8].label, cumulativeProgress);

      // Step 10: Finalize
      updateProgress(initializationSteps[9].label, cumulativeProgress);
      dispatch(setAppReady(true));
      cumulativeProgress = 100;
      updateProgress('Ready!', cumulativeProgress);

      // Wait for animations to complete before navigating
      setTimeout(() => {
        navigateToNextScreen();
      }, 800);

    } catch (error) {
      console.error('Initialization error:', error);
      setInitializationError(error instanceof Error ? error.message : 'Unknown error occurred');
      handleInitializationError(error);
    }
  };

  // Prepare offline features and cache
  const prepareOfflineFeatures = async () => {
    try {
      // Cache essential app data for offline use
      const essentialData = {
        timestamp: Date.now(),
        version: APP_CONFIG.VERSION,
        features: {
          contentGeneration: true,
          basicAnalytics: true,
          socialPostDrafts: true,
          aiInfluencer: true,
        },
      };

      await StorageService.setData(STORAGE_KEYS.OFFLINE_CACHE, JSON.stringify(essentialData));

      // Preload critical UI assets
      await preloadCriticalAssets();

      // Initialize offline content generation templates
      await initializeOfflineTemplates();

    } catch (error) {
      console.warn('Offline preparation failed:', error);
      // Continue without offline features if initialization fails
    }
  };

  // Preload critical assets for offline use
  const preloadCriticalAssets = async () => {
    try {
      // Preload theme assets, fonts, and critical images
      const criticalAssets = [
        'logo_light.png',
        'logo_dark.png',
        'default_avatar.png',
        'placeholder_image.png',
      ];

      // Cache critical assets locally
      await Promise.all(
        criticalAssets.map(async (asset) => {
          try {
            // Implementation would cache these assets locally
            await StorageService.cacheAsset(asset);
          } catch (error) {
            console.warn(`Failed to cache asset: ${asset}`, error);
          }
        })
      );
    } catch (error) {
      console.warn('Asset preloading failed:', error);
    }
  };

  // Initialize offline content templates
  const initializeOfflineTemplates = async () => {
    try {
      const offlineTemplates = {
        socialPosts: [
          {
            id: 'template_1',
            type: 'instagram',
            template: 'Check out this amazing {product}! 🔥 #amazing #product',
            variables: ['product'],
          },
          {
            id: 'template_2',
            type: 'twitter',
            template: 'Just discovered {discovery}! What do you think? 🤔',
            variables: ['discovery'],
          },
          {
            id: 'template_3',
            type: 'tiktok',
            template: 'POV: You find the perfect {item} 💯 #fyp #viral',
            variables: ['item'],
          },
        ],
        aiPersonas: [
          {
            id: 'persona_1',
            name: 'Creative Storyteller',
            description: 'Engaging content with emotional appeal',
            traits: ['creative', 'emotional', 'storytelling'],
          },
          {
            id: 'persona_2',
            name: 'Professional Expert',
            description: 'Authority-driven content with expertise',
            traits: ['professional', 'authoritative', 'educational'],
          },
        ],
      };

      await StorageService.setData(
        STORAGE_KEYS.OFFLINE_TEMPLATES,
        JSON.stringify(offlineTemplates)
      );
    } catch (error) {
      console.warn('Offline templates initialization failed:', error);
    }
  };

  // Check subscription status
  const checkSubscriptionStatus = async () => {
    try {
      if (isOnline) {
        // Check online subscription status
        const subscriptionData = await AuthService.getSubscriptionStatus();
        await StorageService.setSecureData(
          STORAGE_KEYS.SUBSCRIPTION_CACHE,
          JSON.stringify(subscriptionData)
        );
      } else {
        // Use cached subscription data
        const cachedSubscription = await StorageService.getSecureData(STORAGE_KEYS.SUBSCRIPTION_CACHE);
        if (cachedSubscription) {
          // Use cached data for offline functionality
          console.log('Using cached subscription data');
        }
      }
    } catch (error) {
      console.warn('Subscription check failed:', error);
      // Continue with default/cached subscription data
    }
  };

  // Handle initialization errors
  const handleInitializationError = (error: any) => {
    const errorMessage = error instanceof Error ? error.message : 'Initialization failed';
    
    Alert.alert(
      'Initialization Error',
      `${errorMessage}\n\nWould you like to retry or continue in offline mode?`,
      [
        {
          text: 'Retry',
          onPress: () => {
            setInitializationError(null);
            setInitializationProgress(0);
            initializeAppServices();
          },
        },
        {
          text: 'Offline Mode',
          onPress: () => {
            dispatch(setOfflineMode(true));
            navigateToNextScreen();
          },
        },
        {
          text: 'Exit',
          style: 'destructive',
          onPress: () => BackHandler.exitApp(),
        },
      ],
      { cancelable: false }
    );
  };

  // Navigate to next screen based on auth state
  const navigateToNextScreen = async () => {
    try {
      const isAuthenticated = await AuthService.isAuthenticated();
      const hasCompletedOnboarding = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETED);

      if (!isAuthenticated) {
        navigation.replace('Auth');
      } else if (!hasCompletedOnboarding) {
        navigation.replace('Onboarding');
      } else {
        navigation.replace('MainTabs');
      }
    } catch (error) {
      console.error('Navigation error:', error);
      navigation.replace('Auth');
    }
  };

  // Start animations
  const startAnimations = () => {
    // Logo entrance animation
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
    ]).start();

    // Title entrance animation (delayed)
    setTimeout(() => {
      Animated.parallel([
        Animated.spring(titleTranslateY, {
          toValue: 0,
          tension: 80,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]).start();
    }, 500);

    // Progress indicator animation (delayed)
    setTimeout(() => {
      Animated.timing(progressOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }, 1200);

    // Background gradient animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(backgroundGradient, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: false,
        }),
        Animated.timing(backgroundGradient, {
          toValue: 0,
          duration: 3000,
          useNativeDriver: false,
        }),
      ])
    ).start();
  };

  // Handle back button
  useFocusEffect(
    React.useCallback(() => {
      const onBackPress = () => {
        // Prevent back button during initialization
        return true;
      };

      BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => BackHandler.removeEventListener('hardwareBackPress', onBackPress);
    }, [])
  );

  // Component lifecycle
  useEffect(() => {
    const setupApp = async () => {
      // Add small delay for smooth startup
      setTimeout(() => {
        startAnimations();
      }, 100);

      // Start initialization after animations begin
      setTimeout(() => {
        initializeAppServices();
      }, 1000);
    };

    setupApp();

    // Listen for app state changes
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription?.remove();
    };
  }, []);

  // Dynamic styles based on theme
  const styles = {
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
    backgroundGradient: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      opacity: 0.1,
    },
    logoContainer: {
      alignItems: 'center' as const,
      marginBottom: 40,
    },
    logo: {
      width: 120,
      height: 120,
      borderRadius: 24,
      backgroundColor: theme.colors.primary,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      elevation: 8,
      shadowColor: theme.colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
    },
    logoText: {
      fontSize: 36,
      fontWeight: '800' as const,
      color: theme.colors.background,
      letterSpacing: -1,
    },
    titleContainer: {
      alignItems: 'center' as const,
      marginBottom: 60,
    },
    title: {
      fontSize: 28,
      fontWeight: '700' as const,
      color: theme.colors.text,
      textAlign: 'center' as const,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      textAlign: 'center' as const,
      marginTop: 8,
      fontWeight: '500' as const,
    },
    progressContainer: {
      width: width * 0.8,
      alignItems: 'center' as const,
      position: 'absolute' as const,
      bottom: 120,
    },
    progressBar: {
      width: '100%',
      height: 4,
      backgroundColor: theme.colors.border,
      borderRadius: 2,
      overflow: 'hidden' as const,
      marginBottom: 16,
    },
    progressFill: {
      height: '100%',
      backgroundColor: theme.colors.primary,
      borderRadius: 2,
    },
    progressText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center' as const,
      fontWeight: '500' as const,
    },
    offlineIndicator: {
      position: 'absolute' as const,
      top: 60,
      right: 20,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      backgroundColor: theme.colors.warning,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
    },
    offlineText: {
      fontSize: 12,
      color: theme.colors.background,
      fontWeight: '600' as const,
      marginLeft: 4,
    },
  };

  return (
    <View style={styles.container}>
      <StatusBar
        backgroundColor={theme.colors.background}
        barStyle={theme.isDark ? 'light-content' : 'dark-content'}
        translucent={false}
      />

      {/* Background gradient animation */}
      <Animated.View
        style={[
          styles.backgroundGradient,
          {
            backgroundColor: backgroundGradient.interpolate({
              inputRange: [0, 1],
              outputRange: [theme.colors.primary, theme.colors.secondary],
            }),
          },
        ]}
      />

      {/* Offline indicator */}
      {!isOnline && (
        <View style={styles.offlineIndicator}>
          <ActivityIndicator size="small" color={theme.colors.background} />
          <Text style={styles.offlineText}>Offline Mode</Text>
        </View>
      )}

      {/* Logo */}
      <Animated.View
        style={[
          styles.logoContainer,
          {
            transform: [{ scale: logoScale }],
            opacity: logoOpacity,
          },
        ]}
      >
        <View style={styles.logo}>
          <Text style={styles.logoText}>ONX</Text>
        </View>
      </Animated.View>

      {/* Title */}
      <Animated.View
        style={[
          styles.titleContainer,
          {
            transform: [{ translateY: titleTranslateY }],
            opacity: titleOpacity,
          },
        ]}
      >
        <Text style={styles.title}>{i18n.t('splash.title', 'ONXLink')}</Text>
        <Text style={styles.subtitle}>
          {i18n.t('splash.subtitle', 'AI-Powered Social Commerce Platform')}
        </Text>
      </Animated.View>

      {/* Progress indicator */}
      <Animated.View style={[styles.progressContainer, { opacity: progressOpacity }]}>
        <View style={styles.progressBar}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: `${initializationProgress}%`,
              },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {initializationError ? 'Error occurred' : currentStep}
        </Text>
        {initializationProgress > 0 && initializationProgress < 100 && (
          <Text style={[styles.progressText, { fontSize: 12, marginTop: 4 }]}>
            {Math.round(initializationProgress)}%
          </Text>
        )}
      </Animated.View>
    </View>
  );
};

export default SplashScreen;