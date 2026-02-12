import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import CryptoJS from 'crypto-js';
import TouchID from 'react-native-touch-id';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import DeviceInfo from 'react-native-device-info';
import NetInfo from '@react-native-community/netinfo';
import { api } from './api';
import { storage } from './storage';
import { analytics } from './analytics';

// Types
interface User {
  id: string;
  email: string;
  name: string;
  subscriptionTier: 'freemium' | 'premium' | 'enterprise';
  subscriptionExpiry: Date;
  preferences: UserPreferences;
  securitySettings: SecuritySettings;
  offlineCapabilities: OfflineCapabilities;
  lastSyncTimestamp: number;
}

interface UserPreferences {
  language: string;
  theme: 'light' | 'dark' | 'auto';
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  accessibility: AccessibilitySettings;
}

interface SecuritySettings {
  biometricEnabled: boolean;
  twoFactorEnabled: boolean;
  sessionTimeout: number;
  trustedDevices: string[];
  securityQuestions: SecurityQuestion[];
}

interface OfflineCapabilities {
  contentGenerationLimit: number;
  socialPostsLimit: number;
  aiInfluencersLimit: number;
  offlineAnalytics: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOffline: boolean;
  sessionToken: string | null;
  refreshToken: string | null;
  biometricSupported: boolean;
  mfaRequired: boolean;
  lastActivity: number;
}

interface LoginCredentials {
  email: string;
  password: string;
  rememberMe: boolean;
  deviceFingerprint?: string;
}

interface RegistrationData {
  email: string;
  password: string;
  name: string;
  acceptedTerms: boolean;
  marketingConsent: boolean;
  referralCode?: string;
}

class AuthService {
  private static instance: AuthService;
  private state: AuthState;
  private encryptionKey: string;
  private sessionTimer: NodeJS.Timeout | null = null;
  private offlineMode: boolean = false;
  private retryQueue: Array<() => Promise<void>> = [];
  private securityConfig = {
    maxLoginAttempts: 5,
    lockoutDuration: 300000, // 5 minutes
    sessionTimeout: 1800000, // 30 minutes
    passwordMinLength: 8,
    requireBiometric: false,
  };

  private constructor() {
    this.state = {
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isOffline: false,
      sessionToken: null,
      refreshToken: null,
      biometricSupported: false,
      mfaRequired: false,
      lastActivity: Date.now(),
    };
    this.encryptionKey = this.generateEncryptionKey();
    this.initializeService();
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  // Initialize service with offline support and security checks
  private async initializeService(): Promise<void> {
    try {
      // Check network connectivity
      const netInfo = await NetInfo.fetch();
      this.offlineMode = !netInfo.isConnected;
      this.state.isOffline = this.offlineMode;

      // Initialize biometric authentication
      await this.initializeBiometrics();

      // Initialize Google Sign-In
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        GoogleSignin.configure({
          webClientId: process.env.GOOGLE_WEB_CLIENT_ID,
          offlineAccess: true,
          hostedDomain: '',
          loginHint: '',
          forceCodeForRefreshToken: true,
        });
      }

      // Restore authentication state
      await this.restoreAuthState();

      // Setup network listener
      NetInfo.addEventListener(state => {
        const wasOffline = this.offlineMode;
        this.offlineMode = !state.isConnected;
        this.state.isOffline = this.offlineMode;

        if (wasOffline && state.isConnected) {
          this.syncOfflineData();
        }
      });

      // Setup session monitoring
      this.startSessionMonitoring();

    } catch (error) {
      console.error('Auth service initialization failed:', error);
      analytics.trackError('auth_init_failed', error);
    }
  }

  // Biometric authentication setup
  private async initializeBiometrics(): Promise<void> {
    try {
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        const biometryType = await TouchID.isSupported();
        this.state.biometricSupported = biometryType !== false;
        
        const biometricConfig = {
          title: 'Authenticate with Biometrics',
          subTitle: 'Use your fingerprint or face to sign in',
          description: 'Secure access to your ONXLink account',
          fallbackLabel: 'Use PIN',
          cancelLabel: 'Cancel',
          passcodeFallback: true,
          showErrorMessage: true,
          errorMessage: 'Authentication failed. Please try again.',
        };

        await storage.setSecure('biometric_config', JSON.stringify(biometricConfig));
      }
    } catch (error) {
      console.warn('Biometric setup failed:', error);
      this.state.biometricSupported = false;
    }
  }

  // Generate secure encryption key for local storage
  private generateEncryptionKey(): string {
    const deviceId = DeviceInfo.getUniqueId();
    const appVersion = DeviceInfo.getVersion();
    const timestamp = Date.now().toString();
    
    return CryptoJS.SHA256(`${deviceId}-${appVersion}-${timestamp}`).toString();
  }

  // Encrypt sensitive data before storage
  private encrypt(data: string): string {
    return CryptoJS.AES.encrypt(data, this.encryptionKey).toString();
  }

  // Decrypt sensitive data from storage
  private decrypt(encryptedData: string): string {
    const bytes = CryptoJS.AES.decrypt(encryptedData, this.encryptionKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  // Restore authentication state from secure storage
  private async restoreAuthState(): Promise<void> {
    try {
      this.state.isLoading = true;

      const encryptedToken = await storage.getSecure('session_token');
      const encryptedUser = await storage.getSecure('user_data');
      const encryptedRefreshToken = await storage.getSecure('refresh_token');

      if (encryptedToken && encryptedUser) {
        const sessionToken = this.decrypt(encryptedToken);
        const userData = JSON.parse(this.decrypt(encryptedUser));
        const refreshToken = encryptedRefreshToken ? this.decrypt(encryptedRefreshToken) : null;

        // Validate session token
        if (this.isTokenValid(sessionToken)) {
          this.state.sessionToken = sessionToken;
          this.state.refreshToken = refreshToken;
          this.state.user = userData;
          this.state.isAuthenticated = true;

          // Update last activity
          this.updateLastActivity();

          // Verify session with server (if online)
          if (!this.offlineMode) {
            await this.verifySession();
          }
        } else {
          await this.clearAuthState();
        }
      }
    } catch (error) {
      console.error('Failed to restore auth state:', error);
      await this.clearAuthState();
    } finally {
      this.state.isLoading = false;
    }
  }

  // Email/Password Login with offline support
  public async login(credentials: LoginCredentials): Promise<{ success: boolean; requiresMFA?: boolean; error?: string }> {
    try {
      this.state.isLoading = true;

      // Input validation
      if (!this.validateEmail(credentials.email)) {
        return { success: false, error: 'Invalid email format' };
      }

      if (!this.validatePassword(credentials.password)) {
        return { success: false, error: 'Invalid password format' };
      }

      // Check login attempts
      const loginAttempts = await this.getLoginAttempts(credentials.email);
      if (loginAttempts >= this.securityConfig.maxLoginAttempts) {
        const lockoutTime = await storage.get(`lockout_${credentials.email}`);
        if (lockoutTime && Date.now() - lockoutTime < this.securityConfig.lockoutDuration) {
          return { success: false, error: 'Account temporarily locked due to multiple failed attempts' };
        }
      }

      // Generate device fingerprint for security
      const deviceFingerprint = await this.generateDeviceFingerprint();

      if (this.offlineMode) {
        return await this.handleOfflineLogin(credentials, deviceFingerprint);
      }

      // Online login
      const response = await api.post('/auth/login', {
        ...credentials,
        deviceFingerprint,
        platform: Platform.OS,
        appVersion: DeviceInfo.getVersion(),
      });

      if (response.data.requiresMFA) {
        this.state.mfaRequired = true;
        await storage.setSecure('pending_auth', this.encrypt(JSON.stringify({
          email: credentials.email,
          tempToken: response.data.tempToken,
        })));
        return { success: false, requiresMFA: true };
      }

      await this.handleSuccessfulLogin(response.data);
      await this.clearLoginAttempts(credentials.email);

      return { success: true };

    } catch (error) {
      await this.incrementLoginAttempts(credentials.email);
      analytics.trackError('login_failed', error);
      return { success: false, error: this.getErrorMessage(error) };
    } finally {
      this.state.isLoading = false;
    }
  }

  // Handle offline login using cached credentials
  private async handleOfflineLogin(credentials: LoginCredentials, deviceFingerprint: string): Promise<{ success: boolean; error?: string }> {
    try {
      const cachedCredentials = await storage.getSecure('offline_credentials');
      if (!cachedCredentials) {
        return { success: false, error: 'No offline access available. Please connect to internet.' };
      }

      const decryptedCredentials = JSON.parse(this.decrypt(cachedCredentials));
      
      // Verify credentials match
      const hashedPassword = CryptoJS.SHA256(credentials.password).toString();
      if (decryptedCredentials.email === credentials.email && 
          decryptedCredentials.passwordHash === hashedPassword &&
          decryptedCredentials.deviceFingerprint === deviceFingerprint) {
        
        // Load offline user data
        const offlineUserData = await storage.getSecure('offline_user_data');
        if (!offlineUserData) {
          return { success: false, error: 'Offline user data not available' };
        }

        const userData = JSON.parse(this.decrypt(offlineUserData));
        
        // Create offline session
        const offlineToken = this.generateOfflineToken(userData.id);
        
        this.state.sessionToken = offlineToken;
        this.state.user = {
          ...userData,
          offlineCapabilities: this.getOfflineCapabilities(userData.subscriptionTier),
        };
        this.state.isAuthenticated = true;
        this.updateLastActivity();

        analytics.trackEvent('offline_login_success', {
          userId: userData.id,
          tier: userData.subscriptionTier,
        });

        return { success: true };
      }

      return { success: false, error: 'Invalid credentials' };

    } catch (error) {
      analytics.trackError('offline_login_failed', error);
      return { success: false, error: 'Offline login failed' };
    }
  }

  // Generate offline capabilities based on subscription tier
  private getOfflineCapabilities(tier: string): OfflineCapabilities {
    switch (tier) {
      case 'enterprise':
        return {
          contentGenerationLimit: 1000,
          socialPostsLimit: 500,
          aiInfluencersLimit: 50,
          offlineAnalytics: true,
        };
      case 'premium':
        return {
          contentGenerationLimit: 100,
          socialPostsLimit: 50,
          aiInfluencersLimit: 3,
          offlineAnalytics: true,
        };
      default: // freemium
        return {
          contentGenerationLimit: 10,
          socialPostsLimit: 5,
          aiInfluencersLimit: 1,
          offlineAnalytics: false,
        };
    }
  }

  // Generate secure offline token
  private generateOfflineToken(userId: string): string {
    const timestamp = Date.now();
    const randomBytes = CryptoJS.lib.WordArray.random(32);
    const payload = {
      userId,
      timestamp,
      offline: true,
      expires: timestamp + (24 * 60 * 60 * 1000), // 24 hours
    };
    
    return CryptoJS.AES.encrypt(
      JSON.stringify(payload),
      `${this.encryptionKey}-${randomBytes}`
    ).toString();
  }

  // MFA verification
  public async verifyMFA(code: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.state.isLoading = true;

      const pendingAuth = await storage.getSecure('pending_auth');
      if (!pendingAuth) {
        return { success: false, error: 'No pending authentication found' };
      }

      const { email, tempToken } = JSON.parse(this.decrypt(pendingAuth));

      const response = await api.post('/auth/verify-mfa', {
        email,
        code,
        tempToken,
        deviceFingerprint: await this.generateDeviceFingerprint(),
      });

      await this.handleSuccessfulLogin(response.data);
      await storage.removeSecure('pending_auth');
      this.state.mfaRequired = false;

      return { success: true };

    } catch (error) {
      analytics.trackError('mfa_verification_failed', error);
      return { success: false, error: this.getErrorMessage(error) };
    } finally {
      this.state.isLoading = false;
    }
  }

  // User registration
  public async register(data: RegistrationData): Promise<{ success: boolean; error?: string }> {
    try {
      this.state.isLoading = true;

      // Comprehensive validation
      const validationErrors = this.validateRegistrationData(data);
      if (validationErrors.length > 0) {
        return { success: false, error: validationErrors.join(', ') };
      }

      if (this.offlineMode) {
        return { success: false, error: 'Registration requires internet connection' };
      }

      const deviceFingerprint = await this.generateDeviceFingerprint();

      const response = await api.post('/auth/register', {
        ...data,
        deviceFingerprint,
        platform: Platform.OS,
        appVersion: DeviceInfo.getVersion(),
        deviceInfo: await this.getDeviceInfo(),
      });

      // Handle email verification requirement
      if (response.data.requiresEmailVerification) {
        await storage.setSecure('pending_verification', this.encrypt(JSON.stringify({
          email: data.email,
          tempToken: response.data.tempToken,
        })));
        return { success: false, error: 'Please check your email to verify your account' };
      }

      await this.handleSuccessfulLogin(response.data);

      analytics.trackEvent('registration_success', {
        userId: response.data.user.id,
        tier: response.data.user.subscriptionTier,
      });

      return { success: true };

    } catch (error) {
      analytics.trackError('registration_failed', error);
      return { success: false, error: this.getErrorMessage(error) };
    } finally {
      this.state.isLoading = false;
    }
  }

  // Biometric authentication
  public async authenticateWithBiometrics(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.state.biometricSupported) {
        return { success: false, error: 'Biometric authentication not supported' };
      }

      const biometricConfig = await storage.getSecure('biometric_config');
      const config = biometricConfig ? JSON.parse(biometricConfig) : {};

      await TouchID.authenticate('Authenticate to access ONXLink', config);

      // Check if we have stored biometric credentials
      const biometricData = await storage.getSecure('biometric_auth_data');
      if (!biometricData) {
        return { success: false, error: 'No biometric data found' };
      }

      const { userId, encryptedToken } = JSON.parse(this.decrypt(biometricData));
      const sessionToken = this.decrypt(encryptedToken);

      if (this.isTokenValid(sessionToken)) {
        // Load user data
        const userData = await storage.getSecure('user_data');
        if (userData) {
          this.state.sessionToken = sessionToken;
          this.state.user = JSON.parse(this.decrypt(userData));
          this.state.isAuthenticated = true;
          this.updateLastActivity();

          analytics.trackEvent('biometric_login_success', {
            userId: this.state.user.id,
          });

          return { success: true };
        }
      }

      return { success: false, error: 'Invalid biometric authentication' };

    } catch (error) {
      analytics.trackError('biometric_auth_failed', error);
      return { success: false, error: 'Biometric authentication failed' };
    }
  }

  // Social login - Google
  public async signInWithGoogle(): Promise<{ success: boolean; error?: string }> {
    try {
      this.state.isLoading = true;

      if (this.offlineMode) {
        return { success: false, error: 'Social login requires internet connection' };
      }

      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();

      const response = await api.post('/auth/social-login', {
        provider: 'google',
        accessToken: userInfo.idToken,
        deviceFingerprint: await this.generateDeviceFingerprint(),
        platform: Platform.OS,
      });

      await this.handleSuccessfulLogin(response.data);

      analytics.trackEvent('google_login_success', {
        userId: response.data.user.id,
      });

      return { success: true };

    } catch (error) {
      analytics.trackError('google_login_failed', error);
      return { success: false, error: this.getErrorMessage(error) };
    } finally {
      this.state.isLoading = false;
    }
  }

  // Social login - Apple (iOS only)
  public async signInWithApple(): Promise<{ success: boolean; error?: string }> {
    try {
      if (Platform.OS !== 'ios') {
        return { success: false, error: 'Apple Sign-In only available on iOS' };
      }

      this.state.isLoading = true;

      if (this.offlineMode) {
        return { success: false, error: 'Social login requires internet connection' };
      }

      const appleAuthRequestResponse = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
      });

      const credentialState = await appleAuth.getCredentialStateForUser(
        appleAuthRequestResponse.user
      );

      if (credentialState === appleAuth.State.AUTHORIZED) {
        const response = await api.post('/auth/social-login', {
          provider: 'apple',
          accessToken: appleAuthRequestResponse.identityToken,
          authorizationCode: appleAuthRequestResponse.authorizationCode,
          deviceFingerprint: await this.generateDeviceFingerprint(),
          platform: Platform.OS,
        });

        await this.handleSuccessfulLogin(response.data);

        analytics.trackEvent('apple_login_success', {
          userId: response.data.user.id,
        });

        return { success: true };
      }

      return { success: false, error: 'Apple authorization failed' };

    } catch (error) {
      analytics.trackError('apple_login_failed', error);
      return { success: false, error: this.getErrorMessage(error) };
    } finally {
      this.state.isLoading = false;
    }
  }

  // Handle successful login - store tokens and user data securely
  private async handleSuccessfulLogin(loginData: any): Promise<void> {
    try {
      // Store encrypted tokens
      await storage.setSecure('session_token', this.encrypt(loginData.token));
      if (loginData.refreshToken) {
        await storage.setSecure('refresh_token', this.encrypt(loginData.refreshToken));
      }

      // Store encrypted user data
      await storage.setSecure('user_data', this.encrypt(JSON.stringify(loginData.user)));

      // Store offline credentials for offline access
      if (loginData.user.email) {
        const offlineCredentials = {
          email: loginData.user.email,
          passwordHash: loginData.passwordHash, // Should come from server
          deviceFingerprint: await this.generateDeviceFingerprint(),
        };
        await storage.setSecure('offline_credentials', this.encrypt(JSON.stringify(offlineCredentials)));
        await storage.setSecure('offline_user_data', this.encrypt(JSON.stringify(loginData.user)));
      }

      // Update state
      this.state.sessionToken = loginData.token;
      this.state.refreshToken = loginData.refreshToken;
      this.state.user = {
        ...loginData.user,
        offlineCapabilities: this.getOfflineCapabilities(loginData.user.subscriptionTier),
      };
      this.state.isAuthenticated = true;
      this.updateLastActivity();

      // Setup biometric authentication if enabled
      if (this.state.user.securitySettings?.biometricEnabled && this.state.biometricSupported) {
        await this.setupBiometricAuth();
      }

      // Start session monitoring
      this.startSessionMonitoring();

      analytics.trackEvent('login_success', {
        userId: this.state.user.id,
        tier: this.state.user.subscriptionTier,
        loginMethod: 'password',
      });

    } catch (error) {
      console.error('Failed to handle successful login:', error);
      throw error;
    }
  }

  // Setup biometric authentication
  private async setupBiometricAuth(): Promise<void> {
    try {
      if (this.state.sessionToken && this.state.user) {
        const biometricData = {
          userId: this.state.user.id,
          encryptedToken: this.encrypt(this.state.sessionToken),
        };
        await storage.setSecure('biometric_auth_data', this.encrypt(JSON.stringify(biometricData)));
      }
    } catch (error) {
      console.error('Failed to setup biometric auth:', error);
    }
  }

  // Session monitoring and automatic logout
  private startSessionMonitoring(): void {
    if (this.sessionTimer) {
      clearInterval(this.sessionTimer);
    }

    this.sessionTimer = setInterval(async () => {
      const inactiveTime = Date.now() - this.state.lastActivity;
      const sessionTimeout = this.state.user?.securitySettings?.sessionTimeout || this.securityConfig.sessionTimeout;

      if (inactiveTime > sessionTimeout) {
        await this.logout(true); // Auto logout
      } else if (this.state.sessionToken && !this.offlineMode) {
        // Refresh token if needed (when 80% of time has passed)
        const tokenAge = Date.now() - this.getTokenTimestamp(this.state.sessionToken);
        if (tokenAge > sessionTimeout * 0.8) {
          await this.refreshAccessToken();
        }
      }
    }, 60000); // Check every minute
  }

  // Refresh access token
  private async refreshAccessToken(): Promise<void> {
    try {
      if (!this.state.refreshToken || this.offlineMode) return;

      const response = await api.post('/auth/refresh', {
        refreshToken: this.state.refreshToken,
        deviceFingerprint: await this.generateDeviceFingerprint(),
      });

      await storage.setSecure('session_token', this.encrypt(response.data.token));
      this.state.sessionToken = response.data.token;

      if (response.data.refreshToken) {
        await storage.setSecure('refresh_token', this.encrypt(response.data.refreshToken));
        this.state.refreshToken = response.data.refreshToken;
      }

    } catch (error) {
      console.error('Token refresh failed:', error);
      // If refresh fails, logout user
      await this.logout();
    }
  }

  // Logout with cleanup
  public async logout(isAutoLogout: boolean = false): Promise<void> {
    try {
      // Notify server about logout (if online)
      if (!this.offlineMode && this.state.sessionToken) {
        try {
          await api.post('/auth/logout', {
            deviceFingerprint: await this.generateDeviceFingerprint(),
          });
        } catch (error) {
          console.warn('Server logout failed:', error);
        }
      }

      // Clear auth state
      await this.clearAuthState();

      // Clear session timer
      if (this.sessionTimer) {
        clearInterval(this.sessionTimer);
        this.sessionTimer = null;
      }

      analytics.trackEvent('logout', {
        isAutoLogout,
        userId: this.state.user?.id,
      });

      // Reset state
      this.state = {
        user: null,
        isAuthenticated: false,
        isLoading: false,
        isOffline: this.offlineMode,
        sessionToken: null,
        refreshToken: null,
        biometricSupported: this.state.biometricSupported,
        mfaRequired: false,
        lastActivity: Date.now(),
      };

    } catch (error) {
      console.error('Logout failed:', error);
    }
  }

  // Clear all auth-related stored data
  private async clearAuthState(): Promise<void> {
    const keysToRemove = [
      'session_token',
      'refresh_token',
      'user_data',
      'biometric_auth_data',
      'pending_auth',
      'pending_verification',
    ];

    await Promise.all(keysToRemove.map(key => storage.removeSecure(key)));
  }

  // Password reset
  public async resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.validateEmail(email)) {
        return { success: false, error: 'Invalid email format' };
      }

      if (this.offlineMode) {
        return { success: false, error: 'Password reset requires internet connection' };
      }

      await api.post('/auth/reset-password', {
        email,
        deviceFingerprint: await this.generateDeviceFingerprint(),
        platform: Platform.OS,
      });

      analytics.trackEvent('password_reset_requested', { email });

      return { success: true };

    } catch (error) {
      analytics.trackError('password_reset_failed', error);
      return { success: false, error: this.getErrorMessage(error) };
    }
  }

  // Change password
  public async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.state.isAuthenticated || this.offlineMode) {
        return { success: false, error: 'User not authenticated or offline' };
      }

      if (!this.validatePassword(newPassword)) {
        return { success: false, error: 'New password does not meet security requirements' };
      }

      await api.post('/auth/change-password', {
        currentPassword,
        newPassword,
        deviceFingerprint: await this.generateDeviceFingerprint(),
      });

      analytics.trackEvent('password_changed', {
        userId: this.state.user?.id,
      });

      return { success: true };

    } catch (error) {
      analytics.trackError('password_change_failed', error);
      return { success: false, error: this.getErrorMessage(error) };
    }
  }

  // Sync offline data when connection is restored
  private async syncOfflineData(): Promise<void> {
    try {
      if (!this.state.isAuthenticated) return;

      // Process retry queue
      const retryPromises = this.retryQueue.map(async (retryFn) => {
        try {
          await retryFn();
        } catch (error) {
          console.error('Retry operation failed:', error);
        }
      });

      await Promise.allSettled(retryPromises);
      this.retryQueue = [];

      // Sync user data
      await this.verifySession();

      analytics.trackEvent('offline_data_synced', {
        userId: this.state.user?.id,
        itemsSynced: retryPromises.length,
      });

    } catch (error) {
      console.error('Offline data sync failed:', error);
    }
  }

  // Verify session with server
  private async verifySession(): Promise<void> {
    try {
      if (!this.state.sessionToken || this.offlineMode) return;

      const response = await api.get('/auth/verify-session');
      
      if (response.data.user) {
        // Update user data
        this.state.user = {
          ...response.data.user,
          offlineCapabilities: this.getOfflineCapabilities(response.data.user.subscriptionTier),
        };
        await storage.setSecure('user_data', this.encrypt(JSON.stringify(response.data.user)));
        await storage.setSecure('offline_user_data', this.encrypt(JSON.stringify(response.data.user)));
      }

    } catch (error) {
      console.error('Session verification failed:', error);
      if (error.response?.status === 401) {
        await this.logout();
      }
    }
  }

  // Utility methods
  private validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.toLowerCase());
  }

  private validatePassword(password: string): boolean {
    return password.length >= this.securityConfig.passwordMinLength &&
           /[A-Z]/.test(password) &&
           /[a-z]/.test(password) &&
           /\d/.test(password) &&
           /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
}

// Validate registration data with comprehensive checks
private validateRegistrationData(data: RegistrationData): string[] {
    const errors: string[] = [];
    if (!this.validateEmail(data.email)) {
        errors.push('Invalid email format');
    }
    if (!this.validatePassword(data.password)) {
        errors.push('Password must contain uppercase, lowercase, number and special character');
    }
    if (!data.name || data.name.trim().length < 2) {
        errors.push('Name must be at least 2 characters');
    }
    if (!data.acceptedTerms) {
        errors.push('You must accept terms and conditions');
    }
    return errors;
}

// Generate unique device fingerprint
private async generateDeviceFingerprint(): Promise<string> {
    const deviceId = await DeviceInfo.getUniqueId();
    const deviceBrand = await DeviceInfo.getBrand();
    const deviceModel = await DeviceInfo.getModel();
    const osVersion = await DeviceInfo.getSystemVersion();
    const appVersion = await DeviceInfo.getVersion();
    
    return CryptoJS.SHA256(
        `${deviceId}-${deviceBrand}-${deviceModel}-${osVersion}-${appVersion}`
    ).toString();
}

// Get comprehensive device information
private async getDeviceInfo(): Promise<Record<string, any>> {
    return {
        uniqueId: await DeviceInfo.getUniqueId(),
        deviceId: await DeviceInfo.getDeviceId(),
        brand: await DeviceInfo.getBrand(),
        model: await DeviceInfo.getModel(),
        os: Platform.OS,
        osVersion: await DeviceInfo.getSystemVersion(),
        appVersion: await DeviceInfo.getVersion(),
        isEmulator: await DeviceInfo.isEmulator(),
        isTablet: await DeviceInfo.isTablet(),
        hasNotch: await DeviceInfo.hasNotch(),
        ipAddress: await this.getDeviceIP(),
        carrier: await DeviceInfo.getCarrier(),
        totalMemory: await DeviceInfo.getTotalMemory(),
        totalDiskCapacity: await DeviceInfo.getTotalDiskCapacity(),
        deviceLocale: await DeviceInfo.getDeviceLocale(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
}

// Extract device IP address
private async getDeviceIP(): Promise<string | null> {
    try {
        const response = await NetInfo.fetch();
        return response.details?.ipAddress || null;
    } catch {
        return null;
    }
}

// Check token validity
private isTokenValid(token: string): boolean {
    if (!token) return false;
    
    try {
        const decoded = this.decodeToken(token);
        return decoded.exp > Date.now() / 1000;
    } catch {
        return false;
    }
}

// Extract token timestamp
private getTokenTimestamp(token: string): number {
    try {
        const decoded = this.decodeToken(token);
        return decoded.iat * 1000;
    } catch {
        return Date.now();
    }
}

// Decode JWT token
private decodeToken(token: string): any {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
        atob(base64).split('').map(c => 
            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join(''));
    
    return JSON.parse(jsonPayload);
}

// Update last activity timestamp
private updateLastActivity(): void {
    this.state.lastActivity = Date.now();
    storage.set('last_activity', this.state.lastActivity.toString());
}

// Get user-friendly error messages
private getErrorMessage(error: any): string {
    if (error.response) {
        switch (error.response.status) {
            case 400: return 'Invalid request. Please check your input';
            case 401: return 'Session expired. Please login again';
            case 403: return 'Access denied for this account';
            case 429: return 'Too many requests. Please try later';
            case 500: return 'Server error. Please try later';
            default: return 'Connection error. Please try again';
        }
    }
    return error.message || 'An unexpected error occurred';
}

// Track login attempts
private async incrementLoginAttempts(email: string): Promise<void> {
    const key = `login_attempts_${email}`;
    const attempts = (await storage.get(key) || 0) + 1;
    await storage.set(key, attempts);
    
    if (attempts >= this.securityConfig.maxLoginAttempts) {
        await storage.set(`lockout_${email}`, Date.now());
        setTimeout(() => storage.remove(`lockout_${email}`), this.securityConfig.lockoutDuration);
    }
}

private async getLoginAttempts(email: string): Promise<number> {
    return (await storage.get(`login_attempts_${email}`)) || 0;
}

private async clearLoginAttempts(email: string): Promise<void> {
    await storage.remove(`login_attempts_${email}`);
    await storage.remove(`lockout_${email}`);
}

// Enhanced logout with session termination
public async terminateAllSessions(): Promise<boolean> {
    if (!this.state.isAuthenticated || this.offlineMode) return false;
    
    try {
        await api.post('/auth/terminate-all', {
            deviceFingerprint: await this.generateDeviceFingerprint()
        });
        
        // Clear local sessions except current device
        await storage.removeSecure('refresh_token');
        return true;
    } catch (error) {
        analytics.trackError('session_termination_failed', error);
        return false;
    }
}

// Update user preferences with offline sync
public async updatePreferences(prefs: Partial<UserPreferences>): Promise<boolean> {
    if (!this.state.user) return false;
    
    try {
        const newPreferences = { ...this.state.user.preferences, ...prefs };
        this.state.user.preferences = newPreferences;
        
        // Update encrypted storage
        await storage.setSecure('user_data', this.encrypt(JSON.stringify(this.state.user)));
        await storage.setSecure('offline_user_data', this.encrypt(JSON.stringify(this.state.user)));
        
        // Sync with server if online
        if (!this.offlineMode) {
            await api.patch('/user/preferences', newPreferences);
        } else {
            // Queue for later sync
            this.retryQueue.push(() => 
                api.patch('/user/preferences', newPreferences)
            );
        }
        
        analytics.trackEvent('preferences_updated', {
            userId: this.state.user.id,
            preferences: Object.keys(prefs)
        });
        
        return true;
    } catch (error) {
        analytics.trackError('preferences_update_failed', error);
        return false;
    }
}

// Handle token expiration gracefully
private async handleTokenExpiration(): Promise<void> {
    if (this.state.refreshToken) {
        try {
            await this.refreshAccessToken();
        } catch (refreshError) {
            await this.logout(true);
        }
    } else {
        await this.logout(true);
    }
}

// Session verification with exponential backoff
private async verifySessionWithRetry(attempt = 1): Promise<void> {
    try {
        await this.verifySession();
    } catch (error) {
        if (attempt <= 3) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(res => setTimeout(res, delay));
            return this.verifySessionWithRetry(attempt + 1);
        } else {
            await this.logout();
        }
    }
}

// Complete class implementation
}