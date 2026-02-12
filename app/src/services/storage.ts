import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

// Types
interface StorageItem {
  value: any;
  timestamp: number;
  ttl?: number;
  encrypted?: boolean;
}

interface CacheItem {
  data: any;
  lastSync: number;
  version: string;
}

interface OfflineAction {
  id: string;
  type: string;
  payload: any;
  timestamp: number;
  retry: number;
}

interface UserPreferences {
  language: string;
  theme: 'light' | 'dark' | 'auto';
  notifications: boolean;
  autoSync: boolean;
  dataUsage: 'low' | 'medium' | 'high';
  biometricEnabled: boolean;
  pushNotifications: boolean;
  emailNotifications: boolean;
  offlineMode: boolean;
}

interface UserProgress {
  contentGenerated: number;
  postsCreated: number;
  platformsConnected: string[];
  streakDays: number;
  achievements: string[];
  lastActivity: number;
  totalUsageTime: number;
  featuresUsed: Record<string, number>;
}

// Constants
const STORAGE_KEYS = {
  // Authentication
  AUTH_TOKEN: '@onxlink_auth_token',
  REFRESH_TOKEN: '@onxlink_refresh_token',
  USER_SESSION: '@onxlink_user_session',
  BIOMETRIC_ENABLED: '@onxlink_biometric_enabled',
  
  // User Data
  USER_PROFILE: '@onxlink_user_profile',
  USER_PREFERENCES: '@onxlink_user_preferences',
  USER_PROGRESS: '@onxlink_user_progress',
  SUBSCRIPTION_DATA: '@onxlink_subscription_data',
  
  // Content & Cache
  DRAFT_CONTENT: '@onxlink_draft_content',
  GENERATED_CONTENT: '@onxlink_generated_content',
  SOCIAL_ACCOUNTS: '@onxlink_social_accounts',
  AI_INFLUENCERS: '@onxlink_ai_influencers',
  CONTENT_TEMPLATES: '@onxlink_content_templates',
  
  // Offline Data
  OFFLINE_QUEUE: '@onxlink_offline_queue',
  CACHED_ANALYTICS: '@onxlink_cached_analytics',
  OFFLINE_CONTENT: '@onxlink_offline_content',
  SYNC_STATUS: '@onxlink_sync_status',
  
  // App State
  APP_VERSION: '@onxlink_app_version',
  FIRST_LAUNCH: '@onxlink_first_launch',
  LAST_SYNC: '@onxlink_last_sync',
  FEATURE_FLAGS: '@onxlink_feature_flags',
  
  // Security
  ENCRYPTION_KEY: '@onxlink_encryption_key',
  PIN_HASH: '@onxlink_pin_hash',
  FAILED_ATTEMPTS: '@onxlink_failed_attempts',
  LAST_BACKUP: '@onxlink_last_backup'
} as const;

const ENCRYPTION_SECRET = Platform.select({
  ios: 'ONXLink_iOS_2024_Secure',
  android: 'ONXLink_Android_2024_Secure',
  default: 'ONXLink_Web_2024_Secure'
});

const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const SYNC_BATCH_SIZE = 50;
const MAX_RETRY_ATTEMPTS = 3;

class StorageService {
  private encryptionKey: string;
  private isOnline: boolean = true;
  private syncInProgress: boolean = false;
  private offlineQueue: OfflineAction[] = [];

  constructor() {
    this.encryptionKey = this.generateEncryptionKey();
    this.initializeNetworkListener();
    this.initializeOfflineQueue();
  }

  // Initialize network listener
  private initializeNetworkListener(): void {
    NetInfo.addEventListener(state => {
      const wasOnline = this.isOnline;
      this.isOnline = state.isConnected ?? false;
      
      if (!wasOnline && this.isOnline) {
        this.processPendingSync();
      }
    });
  }

  // Generate or retrieve encryption key
  private generateEncryptionKey(): string {
    try {
      const stored = AsyncStorage.getItem(STORAGE_KEYS.ENCRYPTION_KEY);
      if (stored) return stored;
      
      const key = CryptoJS.lib.WordArray.random(256/8).toString();
      AsyncStorage.setItem(STORAGE_KEYS.ENCRYPTION_KEY, key);
      return key;
    } catch {
      return ENCRYPTION_SECRET || 'fallback_key_2024';
    }
  }

  // Encryption utilities
  private encrypt(data: string): string {
    try {
      return CryptoJS.AES.encrypt(data, this.encryptionKey).toString();
    } catch {
      return data; // Fallback to unencrypted if encryption fails
    }
  }

  private decrypt(encryptedData: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedData, this.encryptionKey);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch {
      return encryptedData; // Return as-is if decryption fails
    }
  }

  // Core storage methods
  async setItem<T>(
    key: string, 
    value: T, 
    options: { 
      ttl?: number; 
      encrypted?: boolean; 
      sync?: boolean 
    } = {}
  ): Promise<boolean> {
    try {
      const item: StorageItem = {
        value,
        timestamp: Date.now(),
        ttl: options.ttl,
        encrypted: options.encrypted
      };

      let serialized = JSON.stringify(item);
      
      if (options.encrypted) {
        serialized = this.encrypt(serialized);
      }

      await AsyncStorage.setItem(key, serialized);

      // Queue for sync if needed
      if (options.sync && this.isOnline) {
        this.queueForSync(key, value);
      }

      return true;
    } catch (error) {
      console.error('Storage setItem error:', error);
      return false;
    }
  }

  async getItem<T>(key: string): Promise<T | null> {
    try {
      let data = await AsyncStorage.getItem(key);
      if (!data) return null;

      // Try to decrypt if it looks encrypted
      if (data.includes('U2FsdGVkX1')) {
        data = this.decrypt(data);
      }

      const item: StorageItem = JSON.parse(data);

      // Check TTL
      if (item.ttl && Date.now() - item.timestamp > item.ttl) {
        await this.removeItem(key);
        return null;
      }

      return item.value as T;
    } catch (error) {
      console.error('Storage getItem error:', error);
      return null;
    }
  }

  async removeItem(key: string): Promise<boolean> {
    try {
      await AsyncStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error('Storage removeItem error:', error);
      return false;
    }
  }

  async clear(): Promise<boolean> {
    try {
      await AsyncStorage.clear();
      return true;
    } catch (error) {
      console.error('Storage clear error:', error);
      return false;
    }
  }

  // Authentication storage
  async setAuthToken(token: string): Promise<boolean> {
    return this.setItem(STORAGE_KEYS.AUTH_TOKEN, token, { 
      encrypted: true, 
      ttl: 24 * 60 * 60 * 1000 // 24 hours
    });
  }

  async getAuthToken(): Promise<string | null> {
    return this.getItem<string>(STORAGE_KEYS.AUTH_TOKEN);
  }

  async setRefreshToken(token: string): Promise<boolean> {
    return this.setItem(STORAGE_KEYS.REFRESH_TOKEN, token, { 
      encrypted: true, 
      ttl: 30 * 24 * 60 * 60 * 1000 // 30 days
    });
  }

  async getRefreshToken(): Promise<string | null> {
    return this.getItem<string>(STORAGE_KEYS.REFRESH_TOKEN);
  }

  async clearAuthData(): Promise<boolean> {
    const keys = [
      STORAGE_KEYS.AUTH_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN,
      STORAGE_KEYS.USER_SESSION
    ];
    
    try {
      await Promise.all(keys.map(key => this.removeItem(key)));
      return true;
    } catch {
      return false;
    }
  }

  // User preferences
  async setUserPreferences(preferences: Partial<UserPreferences>): Promise<boolean> {
    const current = await this.getUserPreferences();
    const updated = { ...current, ...preferences };
    return this.setItem(STORAGE_KEYS.USER_PREFERENCES, updated);
  }

  async getUserPreferences(): Promise<UserPreferences> {
    const stored = await this.getItem<UserPreferences>(STORAGE_KEYS.USER_PREFERENCES);
    return {
      language: 'en',
      theme: 'auto',
      notifications: true,
      autoSync: true,
      dataUsage: 'medium',
      biometricEnabled: false,
      pushNotifications: true,
      emailNotifications: true,
      offlineMode: false,
      ...stored
    };
  }

  // User progress tracking
  async updateUserProgress(updates: Partial<UserProgress>): Promise<boolean> {
    const current = await this.getUserProgress();
    const updated = { 
      ...current, 
      ...updates,
      lastActivity: Date.now()
    };
    return this.setItem(STORAGE_KEYS.USER_PROGRESS, updated);
  }

  async getUserProgress(): Promise<UserProgress> {
    const stored = await this.getItem<UserProgress>(STORAGE_KEYS.USER_PROGRESS);
    return {
      contentGenerated: 0,
      postsCreated: 0,
      platformsConnected: [],
      streakDays: 0,
      achievements: [],
      lastActivity: Date.now(),
      totalUsageTime: 0,
      featuresUsed: {},
      ...stored
    };
  }

  async incrementFeatureUsage(feature: string): Promise<void> {
    const progress = await this.getUserProgress();
    const featuresUsed = { ...progress.featuresUsed };
    featuresUsed[feature] = (featuresUsed[feature] || 0) + 1;
    
    await this.updateUserProgress({ featuresUsed });
  }

  // Content management
  async saveDraftContent(contentId: string, content: any): Promise<boolean> {
    const drafts = await this.getDraftContent();
    drafts[contentId] = {
      ...content,
      lastModified: Date.now(),
      id: contentId
    };
    return this.setItem(STORAGE_KEYS.DRAFT_CONTENT, drafts);
  }

  async getDraftContent(): Promise<Record<string, any>> {
    return await this.getItem<Record<string, any>>(STORAGE_KEYS.DRAFT_CONTENT) || {};
  }

  async removeDraftContent(contentId: string): Promise<boolean> {
    const drafts = await this.getDraftContent();
    delete drafts[contentId];
    return this.setItem(STORAGE_KEYS.DRAFT_CONTENT, drafts);
  }

  // Generated content cache
  async cacheGeneratedContent(prompt: string, content: any[]): Promise<boolean> {
    const cache = await this.getItem<Record<string, CacheItem>>(STORAGE_KEYS.GENERATED_CONTENT) || {};
    const key = CryptoJS.SHA256(prompt).toString();
    
    cache[key] = {
      data: content,
      lastSync: Date.now(),
      version: '1.0'
    };

    return this.setItem(STORAGE_KEYS.GENERATED_CONTENT, cache, { ttl: DEFAULT_TTL });
  }

  async getCachedContent(prompt: string): Promise<any[] | null> {
    const cache = await this.getItem<Record<string, CacheItem>>(STORAGE_KEYS.GENERATED_CONTENT);
    if (!cache) return null;

    const key = CryptoJS.SHA256(prompt).toString();
    const item = cache[key];
    
    if (!item) return null;

    // Check if cache is still valid (24 hours)
    if (Date.now() - item.lastSync > 24 * 60 * 60 * 1000) {
      return null;
    }

    return item.data;
  }

  // Offline queue management
  private async initializeOfflineQueue(): Promise<void> {
    this.offlineQueue = await this.getItem<OfflineAction[]>(STORAGE_KEYS.OFFLINE_QUEUE) || [];
  }

  async queueOfflineAction(type: string, payload: any): Promise<boolean> {
    const action: OfflineAction = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      payload,
      timestamp: Date.now(),
      retry: 0
    };

    this.offlineQueue.push(action);
    return this.setItem(STORAGE_KEYS.OFFLINE_QUEUE, this.offlineQueue);
  }

  private async queueForSync(key: string, value: any): Promise<void> {
    if (!this.isOnline) {
      await this.queueOfflineAction('SYNC_DATA', { key, value });
    }
  }

  async processPendingSync(): Promise<void> {
    if (this.syncInProgress || !this.isOnline) return;

    this.syncInProgress = true;
    
    try {
      const queue = [...this.offlineQueue];
      const processed: string[] = [];

      for (let i = 0; i < Math.min(queue.length, SYNC_BATCH_SIZE); i++) {
        const action = queue[i];
        
        try {
          await this.processOfflineAction(action);
          processed.push(action.id);
        } catch (error) {
          action.retry++;
          if (action.retry >= MAX_RETRY_ATTEMPTS) {
            processed.push(action.id);
          }
        }
      }

      // Remove processed actions
      this.offlineQueue = this.offlineQueue.filter(
        action => !processed.includes(action.id)
      );
      
      await this.setItem(STORAGE_KEYS.OFFLINE_QUEUE, this.offlineQueue);
      await this.setItem(STORAGE_KEYS.LAST_SYNC, Date.now());
      
    } finally {
      this.syncInProgress = false;
    }
  }

  private async processOfflineAction(action: OfflineAction): Promise<void> {
    // This would integrate with API service to sync data
    switch (action.type) {
      case 'SYNC_DATA':
        // Sync data to server
        break;
      case 'POST_CONTENT':
        // Post content to social platforms
        break;
      case 'UPDATE_PROFILE':
        // Update user profile
        break;
      default:
        break;
    }
  }

  // AI Influencers storage
  async saveAIInfluencer(influencer: any): Promise<boolean> {
    const influencers = await this.getAIInfluencers();
    influencers[influencer.id] = {
      ...influencer,
      lastModified: Date.now(),
      offline: true
    };
    return this.setItem(STORAGE_KEYS.AI_INFLUENCERS, influencers);
  }

  async getAIInfluencers(): Promise<Record<string, any>> {
    return await this.getItem<Record<string, any>>(STORAGE_KEYS.AI_INFLUENCERS) || {};
  }

  async removeAIInfluencer(influencerId: string): Promise<boolean> {
    const influencers = await this.getAIInfluencers();
    delete influencers[influencerId];
    return this.setItem(STORAGE_KEYS.AI_INFLUENCERS, influencers);
  }

  // Content templates for offline use
  async cacheContentTemplates(templates: any[]): Promise<boolean> {
    return this.setItem(STORAGE_KEYS.CONTENT_TEMPLATES, templates, { 
      ttl: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
  }

  async getContentTemplates(): Promise<any[]> {
    return await this.getItem<any[]>(STORAGE_KEYS.CONTENT_TEMPLATES) || [];
  }

  // Biometric authentication
  async setBiometricEnabled(enabled: boolean): Promise<boolean> {
    return this.setItem(STORAGE_KEYS.BIOMETRIC_ENABLED, enabled);
  }

  async isBiometricEnabled(): Promise<boolean> {
    return await this.getItem<boolean>(STORAGE_KEYS.BIOMETRIC_ENABLED) || false;
  }

  // PIN security
  async setPINHash(pin: string): Promise<boolean> {
    const hash = CryptoJS.SHA256(pin + this.encryptionKey).toString();
    return this.setItem(STORAGE_KEYS.PIN_HASH, hash, { encrypted: true });
  }

  async verifyPIN(pin: string): Promise<boolean> {
    const storedHash = await this.getItem<string>(STORAGE_KEYS.PIN_HASH);
    if (!storedHash) return false;
    
    const hash = CryptoJS.SHA256(pin + this.encryptionKey).toString();
    return hash === storedHash;
  }

  // Security tracking
  async incrementFailedAttempts(): Promise<number> {
    const attempts = await this.getItem<number>(STORAGE_KEYS.FAILED_ATTEMPTS) || 0;
    const newAttempts = attempts + 1;
    await this.setItem(STORAGE_KEYS.FAILED_ATTEMPTS, newAttempts);
    return newAttempts;
  }

  async resetFailedAttempts(): Promise<boolean> {
    return this.removeItem(STORAGE_KEYS.FAILED_ATTEMPTS);
  }

  async getFailedAttempts(): Promise<number> {
    return await this.getItem<number>(STORAGE_KEYS.FAILED_ATTEMPTS) || 0;
  }

  // Backup and restore
  async createBackup(): Promise<string | null> {
    try {
      const backupData = {
        userPreferences: await this.getUserPreferences(),
        userProgress: await this.getUserProgress(),
        draftContent: await this.getDraftContent(),
        aiInfluencers: await this.getAIInfluencers(),
        contentTemplates: await this.getContentTemplates(),
        timestamp: Date.now(),
        version: '1.0'
      };

      const compressed = this.encrypt(JSON.stringify(backupData));
      await this.setItem(STORAGE_KEYS.LAST_BACKUP, Date.now());
      return compressed;
    } catch (error) {
      console.error('Backup creation failed:', error);
      return null;
    }
  }

  async restoreFromBackup(backupData: string): Promise<boolean> {
    try {
      const decrypted = this.decrypt(backupData);
      const data = JSON.parse(decrypted);

      // Validate backup structure
      if (!data.timestamp || !data.version) {
        throw new Error('Invalid backup format');
      }

      // Restore data
      await Promise.all([
        this.setItem(STORAGE_KEYS.USER_PREFERENCES, data.userPreferences),
        this.setItem(STORAGE_KEYS.USER_PROGRESS, data.userProgress),
        this.setItem(STORAGE_KEYS.DRAFT_CONTENT, data.draftContent),
        this.setItem(STORAGE_KEYS.AI_INFLUENCERS, data.aiInfluencers),
        this.setItem(STORAGE_KEYS.CONTENT_TEMPLATES, data.contentTemplates)
      ]);

      return true;
    } catch (error) {
      console.error('Backup restoration failed:', error);
      return false;
    }
  }

  // Storage analytics
  async getStorageUsage(): Promise<{
    totalKeys: number;
    encryptedKeys: number;
    oldestItem: number;
    newestItem: number;
    estimatedSize: number;
  }> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      let encryptedCount = 0;
      let oldestTimestamp = Date.now();
      let newestTimestamp = 0;
      let totalSize = 0;

      for (const key of keys) {
        const value = await AsyncStorage.getItem(key);
        if (value) {
          totalSize += value.length * 2; // Rough UTF-16 estimation

          if (value.includes('U2FsdGVkX1')) {
            encryptedCount++;
          }

          try {
            const item: StorageItem = JSON.parse(
              value.includes('U2FsdGVkX1') ? this.decrypt(value) : value
            );
            if (item.timestamp) {
              oldestTimestamp = Math.min(oldestTimestamp, item.timestamp);
              newestTimestamp = Math.max(newestTimestamp, item.timestamp);
            }
          } catch {
            // Skip invalid items
          }
        }
      }

      return {
        totalKeys: keys.length,
        encryptedKeys: encryptedCount,
        oldestItem: oldestTimestamp,
        newestItem: newestTimestamp,
        estimatedSize: totalSize
      };
    } catch {
      return {
        totalKeys: 0,
        encryptedKeys: 0,
        oldestItem: 0,
        newestItem: 0,
        estimatedSize: 0
      };
    }
  }

  // Cleanup old data
  async cleanup(olderThanDays: number = 30): Promise<boolean> {
    try {
      const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
      const keys = await AsyncStorage.getAllKeys();
      const keysToRemove: string[] = [];

      for (const key of keys) {
        // Skip critical keys
        if (Object.values(STORAGE_KEYS).includes(key as any)) {
          continue;
        }

        const value = await AsyncStorage.getItem(key);
        if (value) {
          try {
            const item: StorageItem = JSON.parse(
              value.includes('U2FsdGVkX1') ? this.decrypt(value) : value
            );
            
            if (item.timestamp && item.timestamp < cutoffTime) {
              keysToRemove.push(key);
            }
          } catch {
            // Remove invalid items
            keysToRemove.push(key);
          }
        }
      }

      await AsyncStorage.multiRemove(keysToRemove);
      return true;
    } catch {
      return false;
    }
  }

  // Network status
  isNetworkAvailable(): boolean {
    return this.isOnline;
  }

  // Sync status
  async getSyncStatus(): Promise<{
    lastSync: number;
    pendingActions: number;
    syncInProgress: boolean;
  }> {
    const lastSync = await this.getItem<number>(STORAGE_KEYS.LAST_SYNC) || 0;
    return {
      lastSync,
      pendingActions: this.offlineQueue.length,
      syncInProgress: this.syncInProgress
    };
  }
}

// Singleton instance
const storageService = new StorageService();

export default storageService;
export { StorageService, STORAGE_KEYS };
export type { 
  UserPreferences, 
  UserProgress, 
  StorageItem, 
  CacheItem, 
  OfflineAction 
};