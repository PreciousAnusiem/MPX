import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
  Alert,
  BackHandler,
  AppState,
  AppStateStatus,
  Image,
  StatusBar,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { CommonActions } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import { BlurView } from '@react-native-community/blur';
import Biometrics from 'react-native-biometrics';
import DeviceInfo from 'react-native-device-info';
import CryptoJS from 'crypto-js';

// Store imports
import { RootState } from '../store';
import { 
  loginStart, 
  loginSuccess, 
  loginFailure, 
  signupStart, 
  signupSuccess, 
  signupFailure,
  setOfflineMode,
  setBiometricEnabled,
  setRememberMe
} from '../store/authSlice';
import { setUserData } from '../store/userSlice';

// Service imports
import { authService } from '../services/auth';
import { analyticsService } from '../services/analytics';
import { storageService } from '../services/storage';
import { biometricService } from '../services/biometric';

// Component imports
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Loading } from '../components/Loading';
import { LanguageSelector } from '../components/LanguageSelector';

// Utils imports
import { validateEmail, validatePassword, encryptSensitiveData, decryptSensitiveData } from '../utils/helpers';
import { COLORS, FONTS, SIZES, ANIMATIONS } from '../utils/constants';
import { t } from '../utils/i18n';

// Types
interface AuthForm {
  email: string;
  password: string;
  confirmPassword?: string;
  firstName?: string;
  lastName?: string;
}

interface BiometricData {
  enabled: boolean;
  type: string;
  lastUsed: number;
}

const { width, height } = Dimensions.get('window');

const AuthScreen: React.FC = ({ navigation, route }: any) => {
  // Redux state
  const dispatch = useDispatch();
  const { isLoading, isOffline, biometricEnabled, rememberMe } = useSelector((state: RootState) => state.auth);
  const { theme, language } = useSelector((state: RootState) => state.user);

  // Local state
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [formData, setFormData] = useState<AuthForm>({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: ''
  });
  const [errors, setErrors] = useState<Partial<AuthForm>>({});
  const [isConnected, setIsConnected] = useState(true);
  const [offlineAttempts, setOfflineAttempts] = useState(0);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockTimeRemaining, setBlockTimeRemaining] = useState(0);

  // Animation refs
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  // Timer refs
  const blockTimerRef = useRef<NodeJS.Timeout>();
  const offlineRetryRef = useRef<NodeJS.Timeout>();

  // Constants
  const MAX_LOGIN_ATTEMPTS = 5;
  const BLOCK_DURATION = 300000; // 5 minutes
  const OFFLINE_RETRY_INTERVAL = 30000; // 30 seconds

  // Initialize component
  useEffect(() => {
    initializeAuth();
    setupNetworkListener();
    setupBackHandler();
    setupAppStateHandler();
    checkBiometricAvailability();
    startAnimations();

    return () => {
      cleanup();
    };
  }, []);

  // Initialize authentication
  const initializeAuth = async () => {
    try {
      // Check if user was previously logged in
      const savedCredentials = await storageService.getSecureItem('user_credentials');
      const loginAttempts = await AsyncStorage.getItem('login_attempts');
      const lastBlockTime = await AsyncStorage.getItem('last_block_time');

      if (savedCredentials) {
        const decryptedCreds = decryptSensitiveData(savedCredentials);
        if (decryptedCreds) {
          setFormData(prev => ({
            ...prev,
            email: decryptedCreds.email || ''
          }));
        }
      }

      // Check login attempts and blocking
      if (loginAttempts) {
        const attempts = parseInt(loginAttempts, 10);
        setLoginAttempts(attempts);

        if (attempts >= MAX_LOGIN_ATTEMPTS && lastBlockTime) {
          const blockTime = parseInt(lastBlockTime, 10);
          const timePassed = Date.now() - blockTime;
          
          if (timePassed < BLOCK_DURATION) {
            setIsBlocked(true);
            setBlockTimeRemaining(Math.ceil((BLOCK_DURATION - timePassed) / 1000));
            startBlockTimer();
          } else {
            await resetLoginAttempts();
          }
        }
      }

      // Auto-login with biometrics if enabled
      if (biometricEnabled && savedCredentials) {
        await attemptBiometricLogin();
      }

      analyticsService.trackEvent('auth_screen_viewed', {
        mode: authMode,
        hasRememberedCredentials: !!savedCredentials
      });
    } catch (error) {
      console.error('Auth initialization error:', error);
    }
  };

  // Setup network connectivity listener
  const setupNetworkListener = () => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected ?? false);
      dispatch(setOfflineMode(!state.isConnected));

      if (state.isConnected && offlineAttempts > 0) {
        // Connection restored, retry pending operations
        handleOfflineRetry();
      }
    });

    return unsubscribe;
  };

  // Setup back handler
  const setupBackHandler = () => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (authMode !== 'login') {
        setAuthMode('login');
        return true;
      }
      return false;
    });

    return () => backHandler.remove();
  };

  // Setup app state handler
  const setupAppStateHandler = () => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App became active, check biometric if available
        if (biometricEnabled && biometricAvailable) {
          attemptBiometricLogin();
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  };

  // Check biometric availability
  const checkBiometricAvailability = async () => {
    try {
      const { available, biometryType } = await Biometrics.isSensorAvailable();
      setBiometricAvailable(available);
      
      if (available) {
        const biometricData: BiometricData = {
          enabled: biometricEnabled,
          type: biometryType || 'unknown',
          lastUsed: Date.now()
        };
        await storageService.setSecureItem('biometric_data', JSON.stringify(biometricData));
      }
    } catch (error) {
      console.error('Biometric check error:', error);
    }
  };

  // Start entrance animations
  const startAnimations = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: ANIMATIONS.FADE_DURATION,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 1,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      )
    ]).start();
  };

  // Form validation
  const validateForm = (): boolean => {
    const newErrors: Partial<AuthForm> = {};

    // Email validation
    if (!formData.email) {
      newErrors.email = t('auth.email_required');
    } else if (!validateEmail(formData.email)) {
      newErrors.email = t('auth.email_invalid');
    }

    // Password validation
    if (!formData.password) {
      newErrors.password = t('auth.password_required');
    } else if (authMode === 'signup' && !validatePassword(formData.password)) {
      newErrors.password = t('auth.password_requirements');
    }

    // Signup specific validations
    if (authMode === 'signup') {
      if (!formData.firstName?.trim()) {
        newErrors.firstName = t('auth.first_name_required');
      }

      if (!formData.lastName?.trim()) {
        newErrors.lastName = t('auth.last_name_required');
      }

      if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = t('auth.passwords_dont_match');
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (isBlocked) {
      Alert.alert(t('auth.account_blocked'), t('auth.try_again_later'));
      return;
    }

    if (!validateForm()) {
      triggerShakeAnimation();
      return;
    }

    if (!isConnected) {
      await handleOfflineAuth();
      return;
    }

    try {
      if (authMode === 'login') {
        await handleLogin();
      } else if (authMode === 'signup') {
        await handleSignup();
      } else if (authMode === 'forgot') {
        await handleForgotPassword();
      }
    } catch (error) {
      handleAuthError(error);
    }
  };

  // Handle login
  const handleLogin = async () => {
    dispatch(loginStart());

    try {
      const response = await authService.login({
        email: formData.email,
        password: formData.password,
        deviceId: await DeviceInfo.getUniqueId(),
        deviceInfo: {
          model: DeviceInfo.getModel(),
          systemVersion: DeviceInfo.getSystemVersion(),
          appVersion: DeviceInfo.getVersion(),
        }
      });

      if (response.success) {
        dispatch(loginSuccess(response.data));
        dispatch(setUserData(response.data.user));

        // Save credentials if remember me is enabled
        if (rememberMe) {
          await saveCredentials();
        }

        // Setup biometric if available
        if (biometricAvailable && !biometricEnabled) {
          await promptBiometricSetup();
        }

        await resetLoginAttempts();
        
        analyticsService.trackEvent('login_success', {
          method: 'email',
          biometric_available: biometricAvailable
        });

        navigateToApp();
      } else {
        throw new Error(response.message || t('auth.login_failed'));
      }
    } catch (error) {
      await handleLoginAttempt();
      dispatch(loginFailure(error.message));
      throw error;
    }
  };

  // Handle signup
  const handleSignup = async () => {
    dispatch(signupStart());

    try {
      const response = await authService.signup({
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName!,
        lastName: formData.lastName!,
        deviceId: await DeviceInfo.getUniqueId(),
        language,
        referralCode: route?.params?.referralCode
      });

      if (response.success) {
        dispatch(signupSuccess(response.data));
        dispatch(setUserData(response.data.user));

        analyticsService.trackEvent('signup_success', {
          method: 'email',
          has_referral: !!route?.params?.referralCode
        });

        // Show welcome message
        Alert.alert(
          t('auth.welcome'),
          t('auth.account_created_successfully'),
          [{ text: t('common.continue'), onPress: navigateToApp }]
        );
      } else {
        throw new Error(response.message || t('auth.signup_failed'));
      }
    } catch (error) {
      dispatch(signupFailure(error.message));
      throw error;
    }
  };

  // Handle forgot password
  const handleForgotPassword = async () => {
    try {
      const response = await authService.forgotPassword(formData.email);
      
      if (response.success) {
        Alert.alert(
          t('auth.check_email'),
          t('auth.password_reset_sent'),
          [{ text: t('common.ok'), onPress: () => setAuthMode('login') }]
        );

        analyticsService.trackEvent('password_reset_requested', {
          email: formData.email
        });
      } else {
        throw new Error(response.message || t('auth.reset_failed'));
      }
    } catch (error) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  // Handle offline authentication
  const handleOfflineAuth = async () => {
    if (authMode !== 'login') {
      Alert.alert(t('auth.offline_mode'), t('auth.login_only_offline'));
      return;
    }

    try {
      const savedCreds = await storageService.getSecureItem('user_credentials');
      
      if (!savedCreds) {
        Alert.alert(t('auth.offline_mode'), t('auth.no_offline_data'));
        return;
      }

      const decryptedCreds = decryptSensitiveData(savedCreds);
      
      if (decryptedCreds && 
          decryptedCreds.email === formData.email && 
          decryptedCreds.password === formData.password) {
        
        // Load offline user data
        const offlineUserData = await storageService.getItem('offline_user_data');
        
        if (offlineUserData) {
          dispatch(loginSuccess({ 
            token: 'offline_token', 
            user: JSON.parse(offlineUserData) 
          }));
          dispatch(setUserData(JSON.parse(offlineUserData)));
          dispatch(setOfflineMode(true));

          analyticsService.trackEvent('offline_login_success');
          navigateToApp();
        } else {
          throw new Error(t('auth.offline_data_corrupt'));
        }
      } else {
        throw new Error(t('auth.invalid_offline_credentials'));
      }
    } catch (error) {
      setOfflineAttempts(prev => prev + 1);
      Alert.alert(t('auth.offline_login_failed'), error.message);
    }
  };

  // Handle biometric login
  const attemptBiometricLogin = async () => {
    if (!biometricAvailable || !biometricEnabled) return;

    try {
      const { success } = await Biometrics.simplePrompt({
        promptMessage: t('auth.biometric_prompt'),
        fallbackPromptMessage: t('auth.biometric_fallback')
      });

      if (success) {
        const savedCreds = await storageService.getSecureItem('user_credentials');
        
        if (savedCreds) {
          const decryptedCreds = decryptSensitiveData(savedCreds);
          
          if (decryptedCreds) {
            setFormData(prev => ({
              ...prev,
              email: decryptedCreds.email,
              password: decryptedCreds.password
            }));

            // Auto-submit login
            setTimeout(() => handleSubmit(), 500);
          }
        }
      }
    } catch (error) {
      console.error('Biometric login error:', error);
    }
  };

  // Prompt biometric setup
  const promptBiometricSetup = async () => {
    Alert.alert(
      t('auth.enable_biometric'),
      t('auth.biometric_convenience'),
      [
        { text: t('common.later'), style: 'cancel' },
        { 
          text: t('common.enable'), 
          onPress: async () => {
            dispatch(setBiometricEnabled(true));
            await storageService.setSecureItem('biometric_enabled', 'true');
            analyticsService.trackEvent('biometric_enabled');
          }
        }
      ]
    );
  };

  // Save credentials securely
  const saveCredentials = async () => {
    try {
      const credentialsToSave = {
        email: formData.email,
        password: formData.password,
        timestamp: Date.now()
      };

      const encryptedCreds = encryptSensitiveData(credentialsToSave);
      await storageService.setSecureItem('user_credentials', encryptedCreds);
    } catch (error) {
      console.error('Error saving credentials:', error);
    }
  };

  // Handle login attempts tracking
  const handleLoginAttempt = async () => {
    const newAttempts = loginAttempts + 1;
    setLoginAttempts(newAttempts);
    await AsyncStorage.setItem('login_attempts', newAttempts.toString());

    if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
      setIsBlocked(true);
      setBlockTimeRemaining(BLOCK_DURATION / 1000);
      await AsyncStorage.setItem('last_block_time', Date.now().toString());
      startBlockTimer();

      Alert.alert(
        t('auth.account_blocked'),
        t('auth.too_many_attempts'),
        [{ text: t('common.ok') }]
      );
    }
  };

  // Reset login attempts
  const resetLoginAttempts = async () => {
    setLoginAttempts(0);
    setIsBlocked(false);
    setBlockTimeRemaining(0);
    await AsyncStorage.multiRemove(['login_attempts', 'last_block_time']);
    
    if (blockTimerRef.current) {
      clearInterval(blockTimerRef.current);
    }
  };

  // Start block timer
  const startBlockTimer = () => {
    blockTimerRef.current = setInterval(() => {
      setBlockTimeRemaining(prev => {
        if (prev <= 1) {
          setIsBlocked(false);
          resetLoginAttempts();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Handle offline retry
  const handleOfflineRetry = useCallback(async () => {
    if (offlineAttempts > 0) {
      // Retry failed operations when connection is restored
      try {
        // Implementation for retrying failed operations
        setOfflineAttempts(0);
      } catch (error) {
        console.error('Offline retry error:', error);
      }
    }
  }, [offlineAttempts]);

  // Handle authentication errors
  const handleAuthError = (error: any) => {
    let message = error.message || t('auth.unknown_error');
    
    // Handle specific error codes
    if (error.code === 'auth/user-not-found') {
      message = t('auth.user_not_found');
    } else if (error.code === 'auth/wrong-password') {
      message = t('auth.wrong_password');
    } else if (error.code === 'auth/email-already-in-use') {
      message = t('auth.email_already_in_use');
    } else if (error.code === 'auth/weak-password') {
      message = t('auth.weak_password');
    }

    Alert.alert(t('common.error'), message);
    triggerShakeAnimation();
  };

  // Trigger shake animation for errors
  const triggerShakeAnimation = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 100, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 100, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 100, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 100, useNativeDriver: true }),
    ]).start();
  };

  // Navigate to app
  const navigateToApp = () => {
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'DashboardScreen' }],
      })
    );
  };

  // Cleanup function
  const cleanup = () => {
    if (blockTimerRef.current) {
      clearInterval(blockTimerRef.current);
    }
    if (offlineRetryRef.current) {
      clearTimeout(offlineRetryRef.current);
    }
  };

  // Form input change handler
  const handleInputChange = (field: keyof AuthForm, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  // Toggle auth mode
  const toggleAuthMode = (mode: 'login' | 'signup' | 'forgot') => {
    setAuthMode(mode);
    setErrors({});
    
    // Clear non-email fields when switching modes
    if (mode === 'login') {
      setFormData(prev => ({
        email: prev.email,
        password: '',
        confirmPassword: '',
        firstName: '',
        lastName: ''
      }));
    }

    analyticsService.trackEvent('auth_mode_changed', { mode });
  };

  // Render form based on auth mode
  const renderForm = () => {
    const slideTransform = {
      transform: [
        {
          translateY: slideAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [50, 0],
          }),
        },
        {
          translateX: shakeAnim,
        },
      ],
    };

    return (
      <Animated.View style={[styles.formContainer, slideTransform]}>
        {authMode === 'signup' && (
          <>
            <Input
              placeholder={t('auth.first_name')}
              value={formData.firstName || ''}
              onChangeText={(value) => handleInputChange('firstName', value)}
              error={errors.firstName}
              leftIcon="person-outline"
              autoCapitalize="words"
              returnKeyType="next"
            />
            <Input
              placeholder={t('auth.last_name')}
              value={formData.lastName || ''}
              onChangeText={(value) => handleInputChange('lastName', value)}
              error={errors.lastName}
              leftIcon="person-outline"
              autoCapitalize="words"
              returnKeyType="next"
            />
          </>
        )}

        <Input
          placeholder={t('auth.email')}
          value={formData.email}
          onChangeText={(value) => handleInputChange('email', value)}
          error={errors.email}
          leftIcon="mail-outline"
          keyboardType="email-address"
          autoCapitalize="none"
          returnKeyType="next"
        />

        {authMode !== 'forgot' && (
          <>
            <Input
              placeholder={t('auth.password')}
              value={formData.password}
              onChangeText={(value) => handleInputChange('password', value)}
              error={errors.password}
              leftIcon="lock-closed-outline"
              rightIcon={showPassword ? "eye-off-outline" : "eye-outline"}
              onRightIconPress={() => setShowPassword(!showPassword)}
              secureTextEntry={!showPassword}
              returnKeyType={authMode === 'signup' ? "next" : "done"}
            />

            {authMode === 'signup' && (
              <Input
                placeholder={t('auth.confirm_password')}
                value={formData.confirmPassword || ''}
                onChangeText={(value) => handleInputChange('confirmPassword', value)}
                error={errors.confirmPassword}
                leftIcon="lock-closed-outline"
                secureTextEntry={!showPassword}
                returnKeyType="done"
              />
            )}
          </>
        )}

        {authMode === 'login' && (
          <View style={styles.optionsContainer}>
            <TouchableOpacity
              style={styles.checkboxContainer}
              onPress={() => dispatch(setRememberMe(!rememberMe))}
            >
              <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                {rememberMe && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>{t('auth.remember_me')}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => toggleAuthMode('forgot')}>
              <Text style={styles.forgotPassword}>{t('auth.forgot_password')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <Button
          title={
            authMode === 'login' ? t('auth.sign_in') :
            authMode === 'signup' ? t('auth.create_account') :
            t('auth.reset_password')
          }
          onPress={handleSubmit}
          loading={isLoading}
          disabled={isBlocked}
          style={styles.primaryButton}
        />

        {isBlocked && (
          <Text style={styles.blockText}>
            {t('auth.blocked_for')} {Math.floor(blockTimeRemaining / 60)}:
            {(blockTimeRemaining % 60).toString().padStart(2, '0')}
          </Text>
        )}
      </Animated.View>
    );
  };

  // Render biometric option
  const renderBiometricOption = () => {
    if (!biometricAvailable || authMode !== 'login') return null;

    return (
      <TouchableOpacity
        style={styles.biometricButton}
        onPress={attemptBiometricLogin}
        disabled={isLoading}
      >
        <Animated.View style={[
          styles.biometricIcon,
          { opacity: glowAnim }
        ]}>
          <Text style={styles.biometricText}>👆</Text>
        </Animated.View>
        <Text style={styles.biometricLabel}>{t('auth.use_biometric')}</Text>
      </TouchableOpacity>
    );
  };

  // Render mode toggle
  const renderModeToggle = () => {
    if (authMode === 'forgot') {
      return (
        <TouchableOpacity
          style={styles.modeToggle}
          onPress={() => toggleAuthMode('login')}
        >
          <Text style={styles.modeToggleText}>
            ← {t('auth.back_to_login')}
          </Text>
        </TouchableOpacity>
      );
    }

    return (
      <View style={styles.modeToggle}>
        <Text style={styles.modeToggleQuestion}>
          {authMode === 'login' ? t('auth.dont_have_account') : t('auth.already_have_account')}
        </Text>
        <TouchableOpacity
          onPress={() => toggleAuthMode(authMode === 'login' ? 'signup' : 'login')}
        >
          <Text style={styles.modeToggleLink}>
            {authMode === 'login' ? t('auth.sign_up') : t('auth.sign_in')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Render offline indicator
  const renderOfflineIndicator = () => {
    if (isConnected) return null;

    return (
      <View style={styles.offlineContainer}>
        <Text style={styles.offlineText}>
          📶 {t('auth.offline_mode')}
        </Text>
        <Text style={styles.offlineSubtext}>
          {t('auth.limited_functionality')}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar
        barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={COLORS.background}
      />
      
      <LinearGradient
        colors={[COLORS.primary + '20', COLORS.background]}
        style={styles.gradient}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoid}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
              <Image
                source={require('../assets/images/logo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
              <Text style={styles.title}>ONXLink</Text>
              <Text style={styles.subtitle}>
                {t('auth.tagline')}
              </Text>
            </Animated.View>

            {renderOfflineIndicator()}
            {renderForm()}
            {renderBiometricOption()}
            {renderModeToggle()}

            <View style={styles.languageContainer}>
              <LanguageSelector />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>

      {isLoading && (
        <BlurView style={styles.loadingOverlay} blurType="light">
          <Loading size="large" />
        </BlurView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  gradient: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: SIZES.padding * 2,
    paddingBottom: SIZES.padding * 4,
  },
  header: {
    alignItems: 'center',
    marginBottom: SIZES.margin * 3,
  },
  logo: {
    width: width * 0.3,
    height: width * 0.3,
    marginBottom: SIZES.margin,
  },
  title: {
    ...FONTS.h1,
    color: COLORS.textPrimary,
    marginBottom: SIZES.margin / 2,
  },
  subtitle: {
    ...FONTS.body2,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingHorizontal: SIZES.padding * 2,
  },
  formContainer: {
    marginBottom: SIZES.margin * 2,
  },
  optionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SIZES.margin * 2,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radius / 2,
    marginRight: SIZES.margin,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkmark: {
    color: COLORS.white,
    fontSize: 12,
  },
  checkboxLabel: {
    ...FONTS.body3,
    color: COLORS.textSecondary,
  },
  forgotPassword: {
    ...FONTS.body3,
    color: COLORS.primary,
  },
  primaryButton: {
    marginTop: SIZES.margin,
  },
  blockText: {
    ...FONTS.body4,
    color: COLORS.danger,
    textAlign: 'center',
    marginTop: SIZES.margin,
  },
  biometricButton: {
    alignItems: 'center',
    marginVertical: SIZES.margin * 2,
  },
  biometricIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SIZES.margin,
  },
  biometricText: {
    fontSize: 24,
  },
  biometricLabel: {
    ...FONTS.body2,
    color: COLORS.primary,
  },
  modeToggle: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginVertical: SIZES.margin,
  },
  modeToggleQuestion: {
    ...FONTS.body3,
    color: COLORS.textSecondary,
    marginRight: SIZES.margin / 2,
  },
  modeToggleLink: {
    ...FONTS.body3,
    color: COLORS.primary,
    fontWeight: 'bold',
  },
  modeToggleText: {
    ...FONTS.body2,
    color: COLORS.primary,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  offlineContainer: {
    backgroundColor: COLORS.warning + '20',
    padding: SIZES.padding,
    borderRadius: SIZES.radius,
    marginBottom: SIZES.margin * 2,
    borderWidth: 1,
    borderColor: COLORS.warning,
  },
  offlineText: {
    ...FONTS.body3,
    color: COLORS.warning,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  offlineSubtext: {
    ...FONTS.body4,
    color: COLORS.warning,
    textAlign: 'center',
    marginTop: SIZES.margin / 2,
  },
  languageContainer: {
    marginTop: SIZES.margin * 2,
    alignItems: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default AuthScreen;