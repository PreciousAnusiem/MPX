import { configureStore, combineReducers } from '@reduxjs/toolkit';
import { persistStore, persistReducer, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { encryptTransform } from 'redux-persist-transform-encrypt';
import { createOfflineMiddleware } from './middleware/offlineMiddleware';
import authSlice from './authSlice';
import userSlice from './userSlice';
import contentSlice from './contentSlice';
import settingsSlice from './settingsSlice';
import offlineSlice from './offlineSlice';
import analyticsSlice from './analyticsSlice';

// Encryption transform for sensitive data
const encryptTransform = encryptTransform({
  secretKey: 'ONXLink-2024-SecureKey-Encrypted',
  onError: (error) => {
    console.error('Redux persist encryption error:', error);
  },
});

// Root reducer configuration
const rootReducer = combineReducers({
  auth: authSlice,
  user: userSlice,
  content: contentSlice,
  settings: settingsSlice,
  offline: offlineSlice,
  analytics: analyticsSlice,
});

// Persist configuration with selective persistence
const persistConfig = {
  key: 'onxlink-root',
  storage: AsyncStorage,
  version: 1,
  whitelist: ['auth', 'user', 'settings', 'content', 'offline'], // Only persist necessary slices
  blacklist: ['analytics'], // Don't persist analytics data
  transforms: [encryptTransform],
  timeout: 10000, // 10 second timeout
  throttle: 500, // Throttle persist operations
};

// Create persisted reducer
const persistedReducer = persistReducer(persistConfig, rootReducer);

// Offline middleware configuration
const offlineMiddleware = createOfflineMiddleware({
  syncInterval: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 5000, // 5 seconds
});

// Store configuration with enhanced middleware
export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [
          FLUSH,
          REHYDRATE,
          PAUSE,
          PERSIST,
          PURGE,
          REGISTER,
          'offline/queueAction',
          'offline/syncPending',
        ],
        ignoredPaths: [
          'register',
          'rehydrate',
          'offline.queue',
          'analytics.events',
        ],
      },
      immutableCheck: {
        warnAfter: 128, // Warn after 128ms
      },
    }).concat([
      offlineMiddleware,
      // Custom analytics middleware
      (store) => (next) => (action) => {
        const result = next(action);
        
        // Track user actions for retention analytics
        if (action.type.startsWith('content/') || 
            action.type.startsWith('user/') ||
            action.type === 'auth/loginSuccess') {
          store.dispatch({
            type: 'analytics/trackEvent',
            payload: {
              event: action.type,
              timestamp: Date.now(),
              userId: store.getState().auth?.user?.id,
              tier: store.getState().user?.subscriptionTier,
            },
          });
        }
        
        return result;
      },
    ]),
  devTools: __DEV__ && {
    name: 'ONXLink Store',
    trace: true,
    traceLimit: 25,
  },
  preloadedState: undefined,
});

// Create persistor
export const persistor = persistStore(store, null, () => {
  console.log('Redux store rehydrated successfully');
});

// Enhanced store types with proper typing
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export type AppStore = typeof store;

// Selector helpers with memoization
export const selectAuthState = (state: RootState) => state.auth;
export const selectUserState = (state: RootState) => state.user;
export const selectContentState = (state: RootState) => state.content;
export const selectSettingsState = (state: RootState) => state.settings;
export const selectOfflineState = (state: RootState) => state.offline;
export const selectAnalyticsState = (state: RootState) => state.analytics;

// Computed selectors for common use cases
export const selectIsAuthenticated = (state: RootState) => 
  state.auth.isAuthenticated && !!state.auth.user;

export const selectUserTier = (state: RootState) => 
  state.user.subscriptionTier || 'freemium';

export const selectIsOffline = (state: RootState) => 
  state.offline.isOffline;

export const selectPendingSync = (state: RootState) => 
  state.offline.queue.length > 0;

export const selectContentGenerationCount = (state: RootState) => 
  state.content.generationCount;

export const selectCanGenerateContent = (state: RootState) => {
  const tier = selectUserTier(state);
  const count = selectContentGenerationCount(state);
  
  switch (tier) {
    case 'freemium':
      return count < 10; // 10 generations per day for freemium
    case 'premium':
      return count < 100; // 100 generations per day for premium
    case 'enterprise':
      return true; // Unlimited for enterprise
    default:
      return false;
  }
};

export const selectAvailableLanguages = (state: RootState) => 
  state.settings.availableLanguages || ['en'];

export const selectCurrentLanguage = (state: RootState) => 
  state.settings.currentLanguage || 'en';

export const selectThemeMode = (state: RootState) => 
  state.settings.themeMode || 'light';

export const selectNotificationSettings = (state: RootState) => 
  state.settings.notifications || {
    push: true,
    email: true,
    marketing: false,
    analytics: true,
  };

// Store enhancement for offline capabilities
export const enhanceStoreForOffline = () => {
  // Listen for network changes
  if (typeof window !== 'undefined' && 'navigator' in window) {
    window.addEventListener('online', () => {
      store.dispatch({ type: 'offline/setOnline' });
      store.dispatch({ type: 'offline/syncPending' });
    });
    
    window.addEventListener('offline', () => {
      store.dispatch({ type: 'offline/setOffline' });
    });
  }
  
  // Auto-sync pending actions when online
  setInterval(() => {
    const state = store.getState();
    if (!state.offline.isOffline && state.offline.queue.length > 0) {
      store.dispatch({ type: 'offline/syncPending' });
    }
  }, 30000); // Check every 30 seconds
};

// Store cleanup and optimization
export const optimizeStore = () => {
  // Clear old analytics data (keep only last 7 days)
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  store.dispatch({
    type: 'analytics/clearOldEvents',
    payload: { before: sevenDaysAgo },
  });
  
  // Clear old cached content (keep only last 30 items)
  store.dispatch({
    type: 'content/clearOldCache',
    payload: { maxItems: 30 },
  });
  
  // Optimize offline queue (remove duplicate actions)
  store.dispatch({
    type: 'offline/optimizeQueue',
  });
};

// Store error handling
export const handleStoreError = (error: Error) => {
  console.error('Redux store error:', error);
  
  // Track error for analytics
  store.dispatch({
    type: 'analytics/trackError',
    payload: {
      error: error.message,
      stack: error.stack,
      timestamp: Date.now(),
    },
  });
  
  // Attempt to recover
  if (error.message.includes('persist')) {
    // Persistence error - try to restore from backup
    store.dispatch({ type: 'offline/restoreFromBackup' });
  }
};

// Initialize store enhancements
if (typeof window !== 'undefined') {
  enhanceStoreForOffline();
  
  // Run optimization every hour
  setInterval(optimizeStore, 60 * 60 * 1000);
  
  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    handleStoreError(new Error(`Unhandled promise rejection: ${event.reason}`));
  });
}

// Export store instance and utilities
export default store;

// Type-safe hooks (to be used with react-redux)
export interface StoreHooks {
  useAppDispatch: () => AppDispatch;
  useAppSelector: <TSelected>(selector: (state: RootState) => TSelected) => TSelected;
}

// Store health check
export const checkStoreHealth = (): boolean => {
  try {
    const state = store.getState();
    
    // Basic health checks
    const hasAuth = typeof state.auth === 'object';
    const hasUser = typeof state.user === 'object';
    const hasSettings = typeof state.settings === 'object';
    const hasContent = typeof state.content === 'object';
    const hasOffline = typeof state.offline === 'object';
    
    return hasAuth && hasUser && hasSettings && hasContent && hasOffline;
  } catch (error) {
    handleStoreError(error as Error);
    return false;
  }
};

// Performance monitoring
export const monitorStorePerformance = () => {
  let actionCount = 0;
  let lastReset = Date.now();
  
  store.subscribe(() => {
    actionCount++;
    
    // Reset counter every minute and log if high
    const now = Date.now();
    if (now - lastReset > 60000) {
      if (actionCount > 100) {
        console.warn(`High action count: ${actionCount} actions in last minute`);
        store.dispatch({
          type: 'analytics/trackPerformance',
          payload: {
            metric: 'high_action_count',
            value: actionCount,
            timestamp: now,
          },
        });
      }
      actionCount = 0;
      lastReset = now;
    }
  });
};

// Initialize performance monitoring in development
if (__DEV__) {
  monitorStorePerformance();
}