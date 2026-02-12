import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { encrypt, decrypt } from '../utils/encryption';
import { api } from '../services/api';
import { analytics } from '../services/analytics';
import { User, AuthState, LoginCredentials, RegisterCredentials, BiometricData, MFAData } from '../types';

// Secure storage keys
const STORAGE_KEYS = {
  AUTH_TOKEN: '@onxlink_auth_token',
  REFRESH_TOKEN: '@onxlink_refresh_token',
  USER_DATA: '@onxlink_user_data',
  BIOMETRIC_ENABLED: '@onxlink_biometric',
  OFFLINE_ACTIONS: '@onxlink_offline_actions',
  LAST_SYNC: '@onxlink_last_sync',
  SESSION_COUNT: '@onxlink_session_count',
  USER_PREFERENCES: '@onxlink_preferences'
};

// Initial state with offline capabilities
const initialState: AuthState = {
  user: null,
  token: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: false,
  isInitializing: true,
  error: null,
  biometricEnabled: false,
  mfaRequired: false,
  mfaData: null,
  sessionCount: 0,
  lastLoginDate: null,
  offlineMode: false,
  pendingActions: [],
  lastSyncTime: null,
  retentionMetrics: {
    loginStreak: 0,
    totalSessions: 0,
    averageSessionTime: 0,
    lastActiveFeatures: [],
    engagementScore: 0
  },
  preferences: {
    theme: 'light',
    language: 'en',
    notifications: true,
    biometricAuth: false,
    autoSync: true,
    offlineMode: false
  }
};

// Async thunks for authentication actions
export const initializeAuth = createAsyncThunk(
  'auth/initialize',
  async (_, { rejectWithValue }) => {
    try {
      const [token, refreshToken, userData, biometric, sessionCount, preferences] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.USER_DATA),
        AsyncStorage.getItem(STORAGE_KEYS.BIOMETRIC_ENABLED),
        AsyncStorage.getItem(STORAGE_KEYS.SESSION_COUNT),
        AsyncStorage.getItem(STORAGE_KEYS.USER_PREFERENCES)
      ]);

      if (token && userData) {
        const decryptedToken = await decrypt(token);
        const decryptedUserData = await decrypt(userData);
        
        // Validate token expiry
        const tokenPayload = JSON.parse(atob(decryptedToken.split('.')[1]));
        const currentTime = Date.now() / 1000;
        
        if (tokenPayload.exp > currentTime) {
          return {
            token: decryptedToken,
            refreshToken: refreshToken ? await decrypt(refreshToken) : null,
            user: JSON.parse(decryptedUserData),
            biometricEnabled: biometric === 'true',
            sessionCount: parseInt(sessionCount || '0'),
            preferences: preferences ? JSON.parse(preferences) : initialState.preferences
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error('Auth initialization error:', error);
      return rejectWithValue('Failed to initialize authentication');
    }
  }
);

export const loginUser = createAsyncThunk(
  'auth/login',
  async (credentials: LoginCredentials, { rejectWithValue, dispatch }) => {
    try {
      const response = await api.post('/auth/login', {
        email: credentials.email.toLowerCase().trim(),
        password: credentials.password,
        deviceInfo: {
          platform: credentials.platform,
          deviceId: credentials.deviceId,
          biometricCapable: credentials.biometricCapable
        }
      });

      const { user, token, refreshToken, mfaRequired, mfaData } = response.data;

      if (mfaRequired) {
        return { mfaRequired: true, mfaData, tempToken: token };
      }

      // Secure storage with encryption
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, await encrypt(token)),
        AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, await encrypt(refreshToken)),
        AsyncStorage.setItem(STORAGE_KEYS.USER_DATA, await encrypt(JSON.stringify(user)))
      ]);

      // Track login analytics
      analytics.track('user_login', {
        userId: user.id,
        method: 'email',
        platform: credentials.platform,
        timestamp: new Date().toISOString()
      });

      // Update session count
      const currentCount = await AsyncStorage.getItem(STORAGE_KEYS.SESSION_COUNT);
      const newCount = (parseInt(currentCount || '0') + 1).toString();
      await AsyncStorage.setItem(STORAGE_KEYS.SESSION_COUNT, newCount);

      return { user, token, refreshToken, sessionCount: parseInt(newCount) };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Login failed';
      analytics.track('login_error', { error: errorMessage });
      return rejectWithValue(errorMessage);
    }
  }
);

export const registerUser = createAsyncThunk(
  'auth/register',
  async (credentials: RegisterCredentials, { rejectWithValue }) => {
    try {
      const response = await api.post('/auth/register', {
        ...credentials,
        email: credentials.email.toLowerCase().trim(),
        acceptedTerms: true,
        acceptedPrivacy: true,
        marketingConsent: credentials.marketingConsent || false
      });

      const { user, token, refreshToken } = response.data;

      // Secure storage
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, await encrypt(token)),
        AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, await encrypt(refreshToken)),
        AsyncStorage.setItem(STORAGE_KEYS.USER_DATA, await encrypt(JSON.stringify(user))),
        AsyncStorage.setItem(STORAGE_KEYS.SESSION_COUNT, '1')
      ]);

      analytics.track('user_register', {
        userId: user.id,
        subscriptionTier: user.subscriptionTier,
        timestamp: new Date().toISOString()
      });

      return { user, token, refreshToken, sessionCount: 1 };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Registration failed';
      return rejectWithValue(errorMessage);
    }
  }
);

export const verifyMFA = createAsyncThunk(
  'auth/verifyMFA',
  async ({ code, tempToken }: { code: string; tempToken: string }, { rejectWithValue }) => {
    try {
      const response = await api.post('/auth/verify-mfa', {
        code,
        tempToken
      });

      const { user, token, refreshToken } = response.data;

      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, await encrypt(token)),
        AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, await encrypt(refreshToken)),
        AsyncStorage.setItem(STORAGE_KEYS.USER_DATA, await encrypt(JSON.stringify(user)))
      ]);

      analytics.track('mfa_verified', { userId: user.id });

      return { user, token, refreshToken };
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.message || 'MFA verification failed');
    }
  }
);

export const enableBiometric = createAsyncThunk(
  'auth/enableBiometric',
  async (biometricData: BiometricData, { rejectWithValue }) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.BIOMETRIC_ENABLED, 'true');
      
      analytics.track('biometric_enabled', {
        biometricType: biometricData.type
      });

      return true;
    } catch (error) {
      return rejectWithValue('Failed to enable biometric authentication');
    }
  }
);

export const refreshAuthToken = createAsyncThunk(
  'auth/refreshToken',
  async (_, { rejectWithValue, getState }) => {
    try {
      const state = getState() as { auth: AuthState };
      const refreshToken = state.auth.refreshToken;

      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await api.post('/auth/refresh', {
        refreshToken
      });

      const { token: newToken, refreshToken: newRefreshToken } = response.data;

      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, await encrypt(newToken)),
        AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, await encrypt(newRefreshToken))
      ]);

      return { token: newToken, refreshToken: newRefreshToken };
    } catch (error: any) {
      return rejectWithValue('Token refresh failed');
    }
  }
);

export const logoutUser = createAsyncThunk(
  'auth/logout',
  async (_, { getState }) => {
    try {
      const state = getState() as { auth: AuthState };
      
      // Track session end
      if (state.auth.user) {
        analytics.track('user_logout', {
          userId: state.auth.user.id,
          sessionDuration: Date.now() - (state.auth.lastLoginDate || Date.now())
        });
      }

      // Clear secure storage
      await Promise.all([
        AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN),
        AsyncStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN),
        AsyncStorage.removeItem(STORAGE_KEYS.USER_DATA),
        AsyncStorage.removeItem(STORAGE_KEYS.BIOMETRIC_ENABLED)
      ]);

      // Keep session count and preferences for better UX
      return null;
    } catch (error) {
      console.error('Logout error:', error);
      return null;
    }
  }
);

export const syncOfflineActions = createAsyncThunk(
  'auth/syncOfflineActions',
  async (_, { getState, dispatch }) => {
    try {
      const state = getState() as { auth: AuthState };
      const offlineActions = state.auth.pendingActions;

      if (offlineActions.length === 0) return [];

      const results = [];
      for (const action of offlineActions) {
        try {
          const response = await api.post('/sync/offline-action', action);
          results.push({ ...action, status: 'synced', result: response.data });
        } catch (error) {
          results.push({ ...action, status: 'failed', error });
        }
      }

      await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
      
      return results;
    } catch (error) {
      console.error('Sync error:', error);
      return [];
    }
  }
);

// Auth slice
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setOfflineMode: (state, action: PayloadAction<boolean>) => {
      state.offlineMode = action.payload;
    },
    addOfflineAction: (state, action: PayloadAction<any>) => {
      state.pendingActions.push({
        ...action.payload,
        timestamp: new Date().toISOString(),
        id: Date.now().toString()
      });
    },
    updateRetentionMetrics: (state, action: PayloadAction<Partial<typeof initialState.retentionMetrics>>) => {
      state.retentionMetrics = { ...state.retentionMetrics, ...action.payload };
    },
    updatePreferences: (state, action: PayloadAction<Partial<typeof initialState.preferences>>) => {
      state.preferences = { ...state.preferences, ...action.payload };
      AsyncStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, JSON.stringify(state.preferences));
    },
    incrementEngagement: (state, action: PayloadAction<{ feature: string; points: number }>) => {
      const { feature, points } = action.payload;
      state.retentionMetrics.engagementScore += points;
      
      if (!state.retentionMetrics.lastActiveFeatures.includes(feature)) {
        state.retentionMetrics.lastActiveFeatures.push(feature);
        if (state.retentionMetrics.lastActiveFeatures.length > 10) {
          state.retentionMetrics.lastActiveFeatures.shift();
        }
      }
    },
    updateLoginStreak: (state) => {
      const today = new Date().toDateString();
      const lastLogin = state.lastLoginDate ? new Date(state.lastLoginDate).toDateString() : null;
      
      if (lastLogin !== today) {
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        if (lastLogin === yesterday) {
          state.retentionMetrics.loginStreak += 1;
        } else if (lastLogin !== today) {
          state.retentionMetrics.loginStreak = 1;
        }
        state.lastLoginDate = new Date().toISOString();
      }
    },
    resetMFA: (state) => {
      state.mfaRequired = false;
      state.mfaData = null;
    }
  },
  extraReducers: (builder) => {
    builder
      // Initialize auth
      .addCase(initializeAuth.pending, (state) => {
        state.isInitializing = true;
      })
      .addCase(initializeAuth.fulfilled, (state, action) => {
        state.isInitializing = false;
        if (action.payload) {
          state.user = action.payload.user;
          state.token = action.payload.token;
          state.refreshToken = action.payload.refreshToken;
          state.isAuthenticated = true;
          state.biometricEnabled = action.payload.biometricEnabled;
          state.sessionCount = action.payload.sessionCount;
          state.preferences = action.payload.preferences;
          state.retentionMetrics.totalSessions = action.payload.sessionCount;
        }
      })
      .addCase(initializeAuth.rejected, (state, action) => {
        state.isInitializing = false;
        state.error = action.payload as string;
      })
      
      // Login
      .addCase(loginUser.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.isLoading = false;
        if (action.payload.mfaRequired) {
          state.mfaRequired = true;
          state.mfaData = action.payload.mfaData;
        } else {
          state.user = action.payload.user;
          state.token = action.payload.token;
          state.refreshToken = action.payload.refreshToken;
          state.isAuthenticated = true;
          state.sessionCount = action.payload.sessionCount;
          state.lastLoginDate = new Date().toISOString();
          state.retentionMetrics.totalSessions = action.payload.sessionCount;
        }
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      
      // Register
      .addCase(registerUser.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(registerUser.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.token = action.payload.token;
        state.refreshToken = action.payload.refreshToken;
        state.isAuthenticated = true;
        state.sessionCount = 1;
        state.lastLoginDate = new Date().toISOString();
        state.retentionMetrics.totalSessions = 1;
        state.retentionMetrics.loginStreak = 1;
      })
      .addCase(registerUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      
      // MFA verification
      .addCase(verifyMFA.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(verifyMFA.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.token = action.payload.token;
        state.refreshToken = action.payload.refreshToken;
        state.isAuthenticated = true;
        state.mfaRequired = false;
        state.mfaData = null;
        state.lastLoginDate = new Date().toISOString();
      })
      .addCase(verifyMFA.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      
      // Biometric enable
      .addCase(enableBiometric.fulfilled, (state) => {
        state.biometricEnabled = true;
        state.preferences.biometricAuth = true;
      })
      
      // Token refresh
      .addCase(refreshAuthToken.fulfilled, (state, action) => {
        state.token = action.payload.token;
        state.refreshToken = action.payload.refreshToken;
      })
      .addCase(refreshAuthToken.rejected, (state) => {
        // Force logout on refresh failure
        state.user = null;
        state.token = null;
        state.refreshToken = null;
        state.isAuthenticated = false;
      })
      
      // Logout
      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null;
        state.token = null;
        state.refreshToken = null;
        state.isAuthenticated = false;
        state.mfaRequired = false;
        state.mfaData = null;
        state.biometricEnabled = false;
        state.error = null;
        state.pendingActions = [];
      })
      
      // Sync offline actions
      .addCase(syncOfflineActions.fulfilled, (state, action) => {
        const syncedActionIds = action.payload
          .filter(result => result.status === 'synced')
          .map(result => result.id);
        
        state.pendingActions = state.pendingActions.filter(
          action => !syncedActionIds.includes(action.id)
        );
        state.lastSyncTime = new Date().toISOString();
      });
  }
});

export const {
  clearError,
  setOfflineMode,
  addOfflineAction,
  updateRetentionMetrics,
  updatePreferences,
  incrementEngagement,
  updateLoginStreak,
  resetMFA
} = authSlice.actions;

// Selectors
export const selectAuth = (state: { auth: AuthState }) => state.auth;
export const selectUser = (state: { auth: AuthState }) => state.auth.user;
export const selectIsAuthenticated = (state: { auth: AuthState }) => state.auth.isAuthenticated;
export const selectIsLoading = (state: { auth: AuthState }) => state.auth.isLoading;
export const selectError = (state: { auth: AuthState }) => state.auth.error;
export const selectBiometricEnabled = (state: { auth: AuthState }) => state.auth.biometricEnabled;
export const selectMFARequired = (state: { auth: AuthState }) => state.auth.mfaRequired;
export const selectOfflineMode = (state: { auth: AuthState }) => state.auth.offlineMode;
export const selectPendingActions = (state: { auth: AuthState }) => state.auth.pendingActions;
export const selectRetentionMetrics = (state: { auth: AuthState }) => state.auth.retentionMetrics;
export const selectPreferences = (state: { auth: AuthState }) => state.auth.preferences;
export const selectSubscriptionTier = (state: { auth: AuthState }) => 
  state.auth.user?.subscriptionTier || 'freemium';

// Advanced selectors for user retention
export const selectUserEngagementLevel = (state: { auth: AuthState }) => {
  const score = state.auth.retentionMetrics.engagementScore;
  if (score >= 1000) return 'high';
  if (score >= 500) return 'medium';
  return 'low';
};

export const selectShouldShowRetentionPrompt = (state: { auth: AuthState }) => {
  const { loginStreak, lastActiveFeatures, engagementScore } = state.auth.retentionMetrics;
  return loginStreak >= 3 && lastActiveFeatures.length >= 5 && engagementScore >= 200;
};

export const selectCanUseFeature = (featureName: string) => (state: { auth: AuthState }) => {
  const tier = state.auth.user?.subscriptionTier || 'freemium';
  const featureMap: Record<string, string[]> = {
    'ai-influencer': ['premium', 'enterprise'],
    'bulk-posting': ['premium', 'enterprise'],
    'predictive-inventory': ['premium', 'enterprise'],
    'cultural-adaptation': ['premium', 'enterprise'],
    'voice-cloning': ['enterprise'],
    'api-access': ['enterprise'],
    'team-management': ['enterprise']
  };
  
  return !featureMap[featureName] || featureMap[featureName].includes(tier);
};

export default authSlice.reducer;