import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';
import { api } from '../services/api';
import { analytics } from '../services/analytics';
import { i18n } from '../utils/i18n';

// Types
interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  phone?: string;
  language: string;
  timezone: string;
  bio?: string;
  website?: string;
  joinedAt: string;
  lastActive: string;
  isVerified: boolean;
  preferences: UserPreferences;
  stats: UserStats;
}

interface UserPreferences {
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  appearance: AppearanceSettings;
  language: string;
  timezone: string;
  autoPost: boolean;
  offlineMode: boolean;
  dataUsage: 'low' | 'medium' | 'high';
  aiPersonality: 'professional' | 'creative' | 'casual';
}

interface NotificationSettings {
  pushEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  marketingEmails: boolean;
  productUpdates: boolean;
  weeklyReports: boolean;
  instantAlerts: boolean;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
}

interface PrivacySettings {
  profileVisibility: 'public' | 'private' | 'followers';
  showActivity: boolean;
  shareAnalytics: boolean;
  dataCollection: boolean;
  thirdPartySharing: boolean;
  biometricAuth: boolean;
  twoFactorAuth: boolean;
}

interface AppearanceSettings {
  theme: 'light' | 'dark' | 'auto';
  primaryColor: string;
  fontSize: 'small' | 'medium' | 'large';
  compactMode: boolean;
  animations: boolean;
  highContrast: boolean;
}

interface SubscriptionTier {
  id: string;
  name: 'freemium' | 'premium' | 'enterprise';
  displayName: string;
  price: number;
  currency: string;
  interval: 'monthly' | 'yearly';
  features: string[];
  limits: TierLimits;
  isActive: boolean;
  expiresAt?: string;
  renewsAt?: string;
  cancelledAt?: string;
  trialEndsAt?: string;
}

interface TierLimits {
  platforms: number;
  aiInfluencers: number;
  contentVariations: number;
  monthlyPosts: number;
  teamMembers: number;
  storageGB: number;
  apiCalls: number;
  languages: number;
  advancedFeatures: string[];
}

interface UserStats {
  totalPosts: number;
  totalViews: number;
  totalEngagement: number;
  totalRevenue: number;
  postsThisMonth: number;
  viewsThisMonth: number;
  engagementRate: number;
  bestPerformingPlatform: string;
  topContent: string[];
  growthRate: number;
  conversionRate: number;
  averageReach: number;
}

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  progress: number;
  maxProgress: number;
}

interface UserState {
  profile: UserProfile | null;
  subscription: SubscriptionTier | null;
  achievements: Achievement[];
  offlineQueue: OfflineAction[];
  lastSyncAt: string | null;
  syncInProgress: boolean;
  isLoading: boolean;
  error: string | null;
  isOffline: boolean;
  dailyStreak: number;
  totalPoints: number;
  level: number;
  experiencePoints: number;
  badges: string[];
  referralCode: string;
  referredUsers: number;
  pendingRewards: Reward[];
}

interface OfflineAction {
  id: string;
  type: 'UPDATE_PROFILE' | 'UPDATE_PREFERENCES' | 'TRACK_USAGE' | 'SAVE_CONTENT';
  payload: any;
  timestamp: string;
  retryCount: number;
  maxRetries: number;
}

interface Reward {
  id: string;
  type: 'points' | 'premium_days' | 'feature_unlock';
  value: number;
  description: string;
  expiresAt?: string;
}

// Storage keys
const STORAGE_KEYS = {
  USER_PROFILE: '@onxlink/user_profile',
  SUBSCRIPTION: '@onxlink/subscription',
  PREFERENCES: '@onxlink/preferences',
  ACHIEVEMENTS: '@onxlink/achievements',
  OFFLINE_QUEUE: '@onxlink/offline_queue',
  USER_STATS: '@onxlink/user_stats',
  ENCRYPTION_KEY: '@onxlink/encryption_key',
  LAST_SYNC: '@onxlink/last_sync',
  DAILY_STREAK: '@onxlink/daily_streak',
};

// Encryption utilities
const generateEncryptionKey = (): string => {
  return CryptoJS.lib.WordArray.random(256/8).toString();
};

const encryptData = (data: any, key: string): string => {
  return CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();
};

const decryptData = (encryptedData: string, key: string): any => {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedData, key);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
};

// Async storage utilities
const secureStore = {
  async getEncryptionKey(): Promise<string> {
    let key = await AsyncStorage.getItem(STORAGE_KEYS.ENCRYPTION_KEY);
    if (!key) {
      key = generateEncryptionKey();
      await AsyncStorage.setItem(STORAGE_KEYS.ENCRYPTION_KEY, key);
    }
    return key;
  },

  async setSecure(key: string, data: any): Promise<void> {
    const encryptionKey = await this.getEncryptionKey();
    const encrypted = encryptData(data, encryptionKey);
    await AsyncStorage.setItem(key, encrypted);
  },

  async getSecure(key: string): Promise<any> {
    try {
      const encrypted = await AsyncStorage.getItem(key);
      if (!encrypted) return null;
      
      const encryptionKey = await this.getEncryptionKey();
      return decryptData(encrypted, encryptionKey);
    } catch (error) {
      console.error(`Failed to get secure data for key ${key}:`, error);
      return null;
    }
  },

  async removeSecure(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  }
};

// Default values
const defaultPreferences: UserPreferences = {
  notifications: {
    pushEnabled: true,
    emailEnabled: true,
    smsEnabled: false,
    marketingEmails: false,
    productUpdates: true,
    weeklyReports: true,
    instantAlerts: true,
    quietHours: {
      enabled: false,
      start: '22:00',
      end: '08:00',
    },
  },
  privacy: {
    profileVisibility: 'public',
    showActivity: true,
    shareAnalytics: true,
    dataCollection: true,
    thirdPartySharing: false,
    biometricAuth: false,
    twoFactorAuth: false,
  },
  appearance: {
    theme: 'auto',
    primaryColor: '#6C5CE7',
    fontSize: 'medium',
    compactMode: false,
    animations: true,
    highContrast: false,
  },
  language: 'en',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  autoPost: false,
  offlineMode: true,
  dataUsage: 'medium',
  aiPersonality: 'professional',
};

const defaultStats: UserStats = {
  totalPosts: 0,
  totalViews: 0,
  totalEngagement: 0,
  totalRevenue: 0,
  postsThisMonth: 0,
  viewsThisMonth: 0,
  engagementRate: 0,
  bestPerformingPlatform: '',
  topContent: [],
  growthRate: 0,
  conversionRate: 0,
  averageReach: 0,
};

// Initial state
const initialState: UserState = {
  profile: null,
  subscription: null,
  achievements: [],
  offlineQueue: [],
  lastSyncAt: null,
  syncInProgress: false,
  isLoading: false,
  error: null,
  isOffline: false,
  dailyStreak: 0,
  totalPoints: 0,
  level: 1,
  experiencePoints: 0,
  badges: [],
  referralCode: '',
  referredUsers: 0,
  pendingRewards: [],
};

// Async thunks
export const loadUserFromStorage = createAsyncThunk(
  'user/loadFromStorage',
  async (_, { rejectWithValue }) => {
    try {
      const [profile, subscription, achievements, stats, streak] = await Promise.all([
        secureStore.getSecure(STORAGE_KEYS.USER_PROFILE),
        secureStore.getSecure(STORAGE_KEYS.SUBSCRIPTION),
        secureStore.getSecure(STORAGE_KEYS.ACHIEVEMENTS),
        secureStore.getSecure(STORAGE_KEYS.USER_STATS),
        AsyncStorage.getItem(STORAGE_KEYS.DAILY_STREAK),
      ]);

      return {
        profile,
        subscription,
        achievements: achievements || [],
        stats: stats || defaultStats,
        dailyStreak: parseInt(streak || '0', 10),
      };
    } catch (error) {
      return rejectWithValue('Failed to load user data from storage');
    }
  }
);

export const fetchUserProfile = createAsyncThunk(
  'user/fetchProfile',
  async (userId: string, { rejectWithValue, dispatch }) => {
    try {
      const response = await api.get(`/users/${userId}`);
      const profile = response.data;

      // Cache profile securely
      await secureStore.setSecure(STORAGE_KEYS.USER_PROFILE, profile);

      // Track user activity
      analytics.trackEvent('profile_loaded', {
        userId: profile.id,
        subscription: profile.subscription?.name || 'freemium',
      });

      return profile;
    } catch (error: any) {
      // Try to load from offline storage
      const cachedProfile = await secureStore.getSecure(STORAGE_KEYS.USER_PROFILE);
      if (cachedProfile) {
        dispatch(setOfflineMode(true));
        return cachedProfile;
      }
      
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch user profile');
    }
  }
);

export const fetchSubscription = createAsyncThunk(
  'user/fetchSubscription',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.get('/subscription/current');
      const subscription = response.data;

      // Cache subscription securely
      await secureStore.setSecure(STORAGE_KEYS.SUBSCRIPTION, subscription);

      return subscription;
    } catch (error: any) {
      // Try to load from offline storage
      const cachedSubscription = await secureStore.getSecure(STORAGE_KEYS.SUBSCRIPTION);
      if (cachedSubscription) {
        return cachedSubscription;
      }

      return rejectWithValue(error.response?.data?.message || 'Failed to fetch subscription');
    }
  }
);

export const updateProfile = createAsyncThunk(
  'user/updateProfile',
  async (updates: Partial<UserProfile>, { getState, rejectWithValue, dispatch }) => {
    try {
      const state = getState() as { user: UserState };
      const isOffline = state.user.isOffline;

      if (isOffline) {
        // Queue for offline sync
        await dispatch(addToOfflineQueue({
          type: 'UPDATE_PROFILE',
          payload: updates,
        }));
        
        // Update local cache immediately for better UX
        const currentProfile = state.user.profile;
        if (currentProfile) {
          const updatedProfile = { ...currentProfile, ...updates };
          await secureStore.setSecure(STORAGE_KEYS.USER_PROFILE, updatedProfile);
          return updatedProfile;
        }
      }

      const response = await api.patch('/users/profile', updates);
      const updatedProfile = response.data;

      // Update cache
      await secureStore.setSecure(STORAGE_KEYS.USER_PROFILE, updatedProfile);

      // Track profile update
      analytics.trackEvent('profile_updated', {
        fields: Object.keys(updates),
        userId: updatedProfile.id,
      });

      return updatedProfile;
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update profile');
    }
  }
);

export const updatePreferences = createAsyncThunk(
  'user/updatePreferences',
  async (preferences: Partial<UserPreferences>, { getState, dispatch }) => {
    try {
      const state = getState() as { user: UserState };
      const currentProfile = state.user.profile;
      
      if (!currentProfile) throw new Error('No user profile found');

      const updatedPreferences = {
        ...currentProfile.preferences,
        ...preferences,
      };

      // Update language if changed
      if (preferences.language && preferences.language !== currentProfile.preferences.language) {
        i18n.changeLanguage(preferences.language);
      }

      // Update theme if changed
      if (preferences.appearance?.theme) {
        // Theme update will be handled by theme slice
      }

      const updatedProfile = {
        ...currentProfile,
        preferences: updatedPreferences,
      };

      // Update profile with new preferences
      return await dispatch(updateProfile(updatedProfile)).unwrap();
    } catch (error: any) {
      throw error;
    }
  }
);

export const syncOfflineData = createAsyncThunk(
  'user/syncOfflineData',
  async (_, { getState, dispatch, rejectWithValue }) => {
    try {
      const state = getState() as { user: UserState };
      const offlineQueue = state.user.offlineQueue;

      if (offlineQueue.length === 0) return { synced: 0 };

      let syncedCount = 0;
      const failedActions: OfflineAction[] = [];

      for (const action of offlineQueue) {
        try {
          switch (action.type) {
            case 'UPDATE_PROFILE':
              await api.patch('/users/profile', action.payload);
              break;
            case 'UPDATE_PREFERENCES':
              await api.patch('/users/preferences', action.payload);
              break;
            case 'TRACK_USAGE':
              await api.post('/analytics/usage', action.payload);
              break;
            default:
              console.warn('Unknown offline action type:', action.type);
          }
          syncedCount++;
        } catch (error) {
          console.error('Failed to sync action:', action.id, error);
          
          if (action.retryCount < action.maxRetries) {
            failedActions.push({
              ...action,
              retryCount: action.retryCount + 1,
            });
          }
        }
      }

      // Update offline queue with failed actions
      await AsyncStorage.setItem(
        STORAGE_KEYS.OFFLINE_QUEUE,
        JSON.stringify(failedActions)
      );

      // Update last sync time
      const now = new Date().toISOString();
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC, now);

      return { synced: syncedCount, failed: failedActions.length };
    } catch (error: any) {
      return rejectWithValue('Failed to sync offline data');
    }
  }
);

export const addToOfflineQueue = createAsyncThunk(
  'user/addToOfflineQueue',
  async (action: Omit<OfflineAction, 'id' | 'timestamp' | 'retryCount' | 'maxRetries'>) => {
    const offlineAction: OfflineAction = {
      id: Date.now().toString() + Math.random().toString(36),
      timestamp: new Date().toISOString(),
      retryCount: 0,
      maxRetries: 3,
      ...action,
    };

    // Load existing queue
    const existingQueue = await AsyncStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE);
    const queue: OfflineAction[] = existingQueue ? JSON.parse(existingQueue) : [];
    
    // Add new action
    queue.push(offlineAction);
    
    // Save updated queue
    await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue));

    return offlineAction;
  }
);

export const unlockAchievement = createAsyncThunk(
  'user/unlockAchievement',
  async (achievementId: string, { getState, dispatch }) => {
    try {
      const state = getState() as { user: UserState };
      const existingAchievements = state.user.achievements;

      // Check if already unlocked
      if (existingAchievements.some(a => a.id === achievementId)) {
        return null;
      }

      const response = await api.post(`/achievements/${achievementId}/unlock`);
      const achievement = response.data;

      // Cache achievements
      const updatedAchievements = [...existingAchievements, achievement];
      await secureStore.setSecure(STORAGE_KEYS.ACHIEVEMENTS, updatedAchievements);

      // Track achievement unlock
      analytics.trackEvent('achievement_unlocked', {
        achievementId,
        rarity: achievement.rarity,
        userId: state.user.profile?.id,
      });

      return achievement;
    } catch (error: any) {
      console.error('Failed to unlock achievement:', error);
      return null;
    }
  }
);

export const calculateLevel = createAsyncThunk(
  'user/calculateLevel',
  async (_, { getState }) => {
    const state = getState() as { user: UserState };
    const experiencePoints = state.user.experiencePoints;
    
    // Level calculation: Level = floor(sqrt(XP / 100))
    const level = Math.floor(Math.sqrt(experiencePoints / 100)) + 1;
    const nextLevelXP = Math.pow(level, 2) * 100;
    const progressToNext = ((experiencePoints - Math.pow(level - 1, 2) * 100) / 
                           (nextLevelXP - Math.pow(level - 1, 2) * 100)) * 100;

    return {
      level,
      experiencePoints,
      nextLevelXP,
      progressToNext: Math.round(progressToNext),
    };
  }
);

// Slice
const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setOfflineMode: (state, action: PayloadAction<boolean>) => {
      state.isOffline = action.payload;
    },
    
    clearError: (state) => {
      state.error = null;
    },
    
    addExperiencePoints: (state, action: PayloadAction<number>) => {
      state.experiencePoints += action.payload;
      state.totalPoints += action.payload;
    },
    
    incrementDailyStreak: (state) => {
      state.dailyStreak += 1;
      // Save to storage
      AsyncStorage.setItem(STORAGE_KEYS.DAILY_STREAK, state.dailyStreak.toString());
    },
    
    resetDailyStreak: (state) => {
      state.dailyStreak = 0;
      AsyncStorage.setItem(STORAGE_KEYS.DAILY_STREAK, '0');
    },
    
    addBadge: (state, action: PayloadAction<string>) => {
      if (!state.badges.includes(action.payload)) {
        state.badges.push(action.payload);
      }
    },
    
    setReferralCode: (state, action: PayloadAction<string>) => {
      state.referralCode = action.payload;
    },
    
    incrementReferredUsers: (state) => {
      state.referredUsers += 1;
    },
    
    addPendingReward: (state, action: PayloadAction<Reward>) => {
      state.pendingRewards.push(action.payload);
    },
    
    claimReward: (state, action: PayloadAction<string>) => {
      const rewardIndex = state.pendingRewards.findIndex(r => r.id === action.payload);
      if (rewardIndex !== -1) {
        const reward = state.pendingRewards[rewardIndex];
        
        // Apply reward
        switch (reward.type) {
          case 'points':
            state.totalPoints += reward.value;
            state.experiencePoints += reward.value;
            break;
          case 'premium_days':
            // This would be handled by subscription logic
            break;
          case 'feature_unlock':
            // This would unlock specific features
            break;
        }
        
        // Remove from pending
        state.pendingRewards.splice(rewardIndex, 1);
      }
    },
    
    updateStats: (state, action: PayloadAction<Partial<UserStats>>) => {
      if (state.profile) {
        state.profile.stats = {
          ...state.profile.stats,
          ...action.payload,
        };
        
        // Cache updated stats
        secureStore.setSecure(STORAGE_KEYS.USER_STATS, state.profile.stats);
      }
    },
    
    clearOfflineQueue: (state) => {
      state.offlineQueue = [];
      AsyncStorage.removeItem(STORAGE_KEYS.OFFLINE_QUEUE);
    },
    
    logout: (state) => {
      // Clear all user data
      state.profile = null;
      state.subscription = null;
      state.achievements = [];
      state.offlineQueue = [];
      state.lastSyncAt = null;
      state.dailyStreak = 0;
      state.totalPoints = 0;
      state.level = 1;
      state.experiencePoints = 0;
      state.badges = [];
      state.referralCode = '';
      state.referredUsers = 0;
      state.pendingRewards = [];
      state.error = null;
      state.isLoading = false;
      state.syncInProgress = false;
      
      // Clear secure storage
      Object.values(STORAGE_KEYS).forEach(key => {
        secureStore.removeSecure(key);
      });
    },
  },
  
  extraReducers: (builder) => {
    // Load from storage
    builder
      .addCase(loadUserFromStorage.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(loadUserFromStorage.fulfilled, (state, action) => {
        state.isLoading = false;
        state.profile = action.payload.profile;
        state.subscription = action.payload.subscription;
        state.achievements = action.payload.achievements;
        state.dailyStreak = action.payload.dailyStreak;
        
        if (state.profile) {
          state.profile.stats = action.payload.stats;
        }
      })
      .addCase(loadUserFromStorage.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    // Fetch profile
    builder
      .addCase(fetchUserProfile.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchUserProfile.fulfilled, (state, action) => {
        state.isLoading = false;
        state.profile = action.payload;
        state.isOffline = false;
      })
      .addCase(fetchUserProfile.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    // Fetch subscription
    builder
      .addCase(fetchSubscription.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchSubscription.fulfilled, (state, action) => {
        state.isLoading = false;
        state.subscription = action.payload;
      })
      .addCase(fetchSubscription.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    // Update profile
    builder
      .addCase(updateProfile.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(updateProfile.fulfilled, (state, action) => {
        state.isLoading = false;
        state.profile = action.payload;
      })
      .addCase(updateProfile.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    // Update preferences
    builder
      .addCase(updatePreferences.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(updatePreferences.fulfilled, (state, action) => {
        state.isLoading = false;
        state.profile = action.payload;
      })
      .addCase(updatePreferences.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to update preferences';
      });

    // Sync offline data
    builder
      .addCase(syncOfflineData.pending, (state) => {
        state.syncInProgress = true;
      })
      .addCase(syncOfflineData.fulfilled, (state, action) => {
        state.syncInProgress = false;
        state.lastSyncAt = new Date().toISOString();
        
        // Remove synced actions from queue
        const { synced } = action.payload;
        if (synced > 0) {
          state.offlineQueue = state.offlineQueue.slice(synced);
        }
      })
      .addCase(syncOfflineData.rejected, (state, action) => {
        state.syncInProgress = false;
        state.error = action.payload as string;
      });

    // Add to offline queue
    builder
      .addCase(addToOfflineQueue.fulfilled, (state, action) => {
        state.offlineQueue.push(action.payload);
      });

    // Unlock achievement
    builder
      .addCase(unlockAchievement.fulfilled, (state, action) => {
        if (action.payload) {
          state.achievements.push(action.payload);
          
          // Award experience points based on rarity
          const xpRewards = {
            common: 10,
            rare: 25,
            epic: 50,
            legendary: 100,
          };
          
          const xp = xpRewards[action.payload.rarity];
          state.experiencePoints += xp;
          state.totalPoints += xp;
        }
      });

    // Calculate level
    builder
      .addCase(calculateLevel.fulfilled, (state, action) => {
        state.level = action.payload.level;
        state.experiencePoints = action.payload.experiencePoints;
      });
  },
});

// Actions
export const {
  setOfflineMode,
  clearError,
  addExperiencePoints,
  incrementDailyStreak,
  resetDailyStreak,
  addBadge,
  setReferralCode,
  incrementReferredUsers,
  addPendingReward,
  claimReward,
  updateStats,
  clearOfflineQueue,
  logout,
} = userSlice.actions;

// Selectors
export const selectUser = (state: { user: UserState }) => state.user;
export const selectProfile = (state: { user: UserState }) => state.user.profile;
export const selectSubscription = (state: { user: UserState }) => state.user.subscription;
export const selectPreferences = (state: { user: UserState }) => state.user.profile?.preferences;
export const selectStats = (state: { user: UserState }) => state.user.profile?.stats;
export const selectAchievements = (state: { user: UserState }) => state.user.achievements;
export const selectIsOffline = (state: { user: UserState }) => state.user.isOffline;
export const selectOfflineQueue = (state: { user: UserState }) => state.user.offlineQueue;
export const selectDailyStreak = (state: { user: UserState }) => state.user.dailyStreak;
export const selectLevel = (state: { user: UserState }) => state.user.level;
export const selectExperiencePoints = (state: { user: UserState }) => state.user.experiencePoints;
export const selectTotalPoints = (state: { user: UserState }) => state.user.totalPoints;
export const selectBadges = (state: { user: UserState }) => state.user.badges;
export const selectPendingRewards = (state: { user: UserState }) => state.user.pendingRewards;

// Advanced selectors
export const selectTierLimits = (state: { user: UserState }) => 
  state.user.subscription?.limits;

export const selectHasFeature = (feature: string) => (state: { user: UserState }) => {
  const subscription = state.user.subscription;
  if (!subscription) return false;
  return subscription.features.includes(feature) || 
         subscription.limits.advancedFeatures.includes(feature);
};

export const selectUsagePercentage = (type: keyof TierLimits) => (state: { user: UserState }) => {
  const subscription = state.user.subscription;
  const stats = state.user.profile?.stats;
  
  if (!subscription || !stats) return 0;
  
  const limit = subscription.limits[type] as number;
  if (limit === -1) return 0; // Unlimited
  
  let usage = 0;
  switch (type) {
    case 'monthlyPosts':
      usage = stats.postsThisMonth;
      break;
    case 'platforms':
      usage = 1; // This would come from connected platforms
      break;
    default:
      return 0;
  }
  
  return Math.min((usage / limit) * 100, 100);
};

export const selectNextLevelProgress = (state: { user: UserState }) => {
  const level = state.user.level;
  const xp = state.user.experiencePoints;
  
  if (level <= 0) return 0;
  
  const minXP = Math.pow(level - 1, 2) * 100;
  const nextLevelXP = Math.pow(level, 2) * 100;
  
  if (xp <= minXP) return 0;
  if (xp >= nextLevelXP) return 100;
  
  const progress = (xp - minXP) / (nextLevelXP - minXP) * 100;
  return Math.round(progress * 100) / 100;
};

// Export reducer
export default userSlice.reducer;

// Offline content utilities
export const saveContentOffline = (content: any) => async (dispatch: any) => {
  const action: OfflineAction = {
    type: 'SAVE_CONTENT',
    payload: content,
    timestamp: new Date().toISOString(),
    id: `content_${Date.now()}`,
    retryCount: 0,
    maxRetries: 5
  };
  
  dispatch(addToOfflineQueue(action));
  
  // For immediate UX update
  const offlineContent = await AsyncStorage.getItem('@offline_content');
  const contentList = offlineContent ? JSON.parse(offlineContent) : [];
  contentList.push(content);
  await AsyncStorage.setItem('@offline_content', JSON.stringify(contentList));
};

export const schedulePostOffline = (post: any) => async (dispatch: any) => {
  const action: OfflineAction = {
    type: 'SCHEDULE_POST',
    payload: post,
    timestamp: new Date().toISOString(),
    id: `post_${Date.now()}`,
    retryCount: 0,
    maxRetries: 3
  };
  
  dispatch(addToOfflineQueue(action));
  
  // For immediate UX update
  const scheduledPosts = await AsyncStorage.getItem('@scheduled_posts');
  const posts = scheduledPosts ? JSON.parse(scheduledPosts) : [];
  posts.push(post);
  await AsyncStorage.setItem('@scheduled_posts', JSON.stringify(posts));
};

// Engagement tracking
export const trackUserEngagement = (event: string, value: number = 1) => async (dispatch: any, getState: any) => {
  const state = getState().user;
  
  // Update in-memory state
  dispatch(incrementEngagement(value));
  
  if (!state.isOffline) {
    try {
      // Send to analytics service
      await analytics.trackEvent(event, { value });
    } catch (error) {
      // If network fails, add to offline queue
      dispatch(addToOfflineQueue({
        type: 'TRACK_ENGAGEMENT',
        payload: { event, value },
        timestamp: new Date().toISOString(),
        id: `engagement_${Date.now()}`,
        retryCount: 0,
        maxRetries: 5
      }));
      
      dispatch(setOfflineMode(true));
    }
  } else {
    // Add to offline queue
    dispatch(addToOfflineQueue({
      type: 'TRACK_ENGAGEMENT',
      payload: { event, value },
      timestamp: new Date().toISOString(),
      id: `engagement_${Date.now()}`,
      retryCount: 0,
      maxRetries: 5
    }));
  }
  
  // Check for achievements
  if (state.profile?.stats.totalEngagement > 1000) {
    dispatch(unlockAchievement('engagement_master'));
  }
};

// Daily streak management
export const checkDailyStreak = () => async (dispatch: any) => {
  const lastActive = await AsyncStorage.getItem('@last_active');
  const today = new Date().toISOString().split('T')[0];
  
  if (!lastActive || lastActive !== today) {
    // New day
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    if (lastActive === yesterdayStr) {
      // Consecutive day
      dispatch(incrementDailyStreak());
    } else {
      // Broken streak
      dispatch(resetDailyStreak());
    }
    
    // Update last active
    await AsyncStorage.setItem('@last_active', today);
    dispatch(updateLastActive());
    
    // Award streak bonus
    const streak = (await AsyncStorage.getItem(STORAGE_KEYS.DAILY_STREAK)) || '0';
    const points = Math.min(parseInt(streak, 10) * 10, 100); // Max 100 points
    dispatch(addExperiencePoints(points));
  }
};

// Referral system
export const applyReferralCode = (code: string) => async (dispatch: any) => {
  try {
    const response = await api.post('/referrals/apply', { code });
    const { reward } = response.data;
    
    dispatch(addPendingReward(reward));
    dispatch(incrementReferredUsers());
    
    // Award referrer
    dispatch(addExperiencePoints(50));
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error('Invalid referral code');
    }
    throw error;
  }
};