import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import CryptoJS from 'crypto-js';
import { Platform } from 'react-native';
import { store } from '../store';
import { logout, refreshToken } from '../store/authSlice';
import { showNotification } from '../store/uiSlice';
import { Alert } from 'react-native';

// Types
interface ApiResponse<T = any> {
  data: T;
  message?: string;
  success: boolean;
  timestamp: number;
}

interface QueuedRequest {
  id: string;
  config: AxiosRequestConfig;
  timestamp: number;
  retryCount: number;
}

interface OfflineData {
  [key: string]: {
    data: any;
    timestamp: number;
    ttl: number;
  };
}

interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  retryCondition?: (error: AxiosError) => boolean;
}

// Constants
const API_BASE_URL = __DEV__ 
  ? 'http://localhost:8000/api' 
  : 'https://api.onxlink.com/api';

const ENCRYPTION_KEY = 'ONXLink_Secure_Key_2024';
const OFFLINE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_QUEUE_SIZE = 100;
const REQUEST_TIMEOUT = 15000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;

// Endpoints
export const ENDPOINTS = {
  // Authentication
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    REFRESH: '/auth/refresh',
    LOGOUT: '/auth/logout',
    VERIFY_EMAIL: '/auth/verify-email',
    RESET_PASSWORD: '/auth/reset-password',
    CHANGE_PASSWORD: '/auth/change-password',
    BIOMETRIC_SETUP: '/auth/biometric-setup',
    MFA_SETUP: '/auth/mfa-setup',
    MFA_VERIFY: '/auth/mfa-verify',
  },
  
  // User Management
  USER: {
    PROFILE: '/user/profile',
    UPDATE_PROFILE: '/user/profile',
    PREFERENCES: '/user/preferences',
    ACTIVITY: '/user/activity',
    SETTINGS: '/user/settings',
    DELETE_ACCOUNT: '/user/delete',
  },
  
  // Subscription & Payments
  SUBSCRIPTION: {
    PLANS: '/subscription/plans',
    CURRENT: '/subscription/current',
    UPGRADE: '/subscription/upgrade',
    CANCEL: '/subscription/cancel',
    INVOICE: '/subscription/invoice',
    USAGE: '/subscription/usage',
    VERIFY_PURCHASE: '/subscription/verify-purchase',
  },
  
  // Content Generation
  CONTENT: {
    GENERATE: '/content/generate',
    TEMPLATES: '/content/templates',
    HISTORY: '/content/history',
    SAVE: '/content/save',
    DELETE: '/content/delete',
    OPTIMIZE: '/content/optimize',
    TRANSLATE: '/content/translate',
    ANALYZE: '/content/analyze',
  },
  
  // Social Media Management
  SOCIAL: {
    PLATFORMS: '/social/platforms',
    CONNECT: '/social/connect',
    DISCONNECT: '/social/disconnect',
    ACCOUNTS: '/social/accounts',
    POST: '/social/post',
    SCHEDULE: '/social/schedule',
    ANALYTICS: '/social/analytics',
    BULK_DELETE: '/social/bulk-delete',
  },
  
  // AI Influencer
  INFLUENCER: {
    CREATE: '/influencer/create',
    LIST: '/influencer/list',
    UPDATE: '/influencer/update',
    DELETE: '/influencer/delete',
    GENERATE_CONTENT: '/influencer/generate-content',
    VOICE_CLONE: '/influencer/voice-clone',
    ANALYTICS: '/influencer/analytics',
  },
  
  // E-commerce
  ECOMMERCE: {
    PRODUCTS: '/ecommerce/products',
    INVENTORY: '/ecommerce/inventory',
    PRICING: '/ecommerce/pricing',
    ORDERS: '/ecommerce/orders',
    ANALYTICS: '/ecommerce/analytics',
    TRENDS: '/ecommerce/trends',
  },
  
  // Analytics
  ANALYTICS: {
    OVERVIEW: '/analytics/overview',
    PERFORMANCE: '/analytics/performance',
    ENGAGEMENT: '/analytics/engagement',
    REVENUE: '/analytics/revenue',
    EXPORT: '/analytics/export',
  },
  
  // Admin (Enterprise)
  ADMIN: {
    USERS: '/admin/users',
    TEAMS: '/admin/teams',
    BILLING: '/admin/billing',
    SETTINGS: '/admin/settings',
    LOGS: '/admin/logs',
  },
};

class ApiClient {
  private client: AxiosInstance;
  private requestQueue: QueuedRequest[] = [];
  private isOnline: boolean = true;
  private offlineCache: OfflineData = {};
  private retryConfig: RetryConfig;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Client-Platform': Platform.OS,
        'X-Client-Version': '1.0.0',
      },
    });

    this.retryConfig = {
      maxRetries: MAX_RETRY_ATTEMPTS,
      retryDelay: RETRY_DELAY,
      retryCondition: (error: AxiosError) => {
        return !error.response || error.response.status >= 500;
      },
    };

    this.setupInterceptors();
    this.initializeNetworkListener();
    this.loadOfflineCache();
    this.processQueuedRequests();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        // Add authentication token
        const token = await this.getSecureToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }

        // Add request ID for tracking
        config.headers['X-Request-ID'] = this.generateRequestId();

        // Add offline handling
        if (!this.isOnline && this.isGetRequest(config)) {
          const cachedData = await this.getCachedData(config.url || '');
          if (cachedData) {
            return Promise.reject({
              isOfflineResponse: true,
              data: cachedData,
              config,
            });
          }
        }

        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        // Cache successful GET requests
        if (this.isGetRequest(response.config)) {
          this.cacheResponse(response.config.url || '', response.data);
        }

        return response;
      },
      async (error: AxiosError) => {
        // Handle offline responses
        if (error.isOfflineResponse) {
          return Promise.resolve({
            data: error.data,
            status: 200,
            statusText: 'OK (Offline)',
            headers: {},
            config: error.config,
          });
        }

        // Handle authentication errors
        if (error.response?.status === 401) {
          await this.handleAuthError();
          return Promise.reject(error);
        }

        // Handle network errors
        if (!error.response && !this.isOnline) {
          await this.queueRequest(error.config);
          return Promise.reject({
            ...error,
            message: 'Request queued for when connection is restored',
            isQueued: true,
          });
        }

        // Retry logic
        if (this.shouldRetry(error)) {
          return this.retryRequest(error);
        }

        return Promise.reject(error);
      }
    );
  }

  private async getSecureToken(): Promise<string | null> {
    try {
      const encryptedToken = await AsyncStorage.getItem('auth_token');
      if (!encryptedToken) return null;

      const decryptedToken = CryptoJS.AES.decrypt(encryptedToken, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
      return decryptedToken || null;
    } catch (error) {
      console.error('Error retrieving token:', error);
      return null;
    }
  }

  private async setSecureToken(token: string): Promise<void> {
    try {
      const encryptedToken = CryptoJS.AES.encrypt(token, ENCRYPTION_KEY).toString();
      await AsyncStorage.setItem('auth_token', encryptedToken);
    } catch (error) {
      console.error('Error storing token:', error);
    }
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private isGetRequest(config: any): boolean {
    return config && config.method?.toLowerCase() === 'get';
  }

  private initializeNetworkListener(): void {
    NetInfo.addEventListener(state => {
      const wasOffline = !this.isOnline;
      this.isOnline = state.isConnected ?? true;

      if (wasOffline && this.isOnline) {
        this.processQueuedRequests();
        store.dispatch(showNotification({
          type: 'success',
          message: 'Connection restored. Syncing data...',
        }));
      } else if (!this.isOnline) {
        store.dispatch(showNotification({
          type: 'info',
          message: 'Working offline. Changes will sync when connected.',
        }));
      }
    });
  }

  private async loadOfflineCache(): Promise<void> {
    try {
      const cached = await AsyncStorage.getItem('offline_cache');
      if (cached) {
        this.offlineCache = JSON.parse(cached);
      }
    } catch (error) {
      console.error('Error loading offline cache:', error);
    }
  }

  private async saveOfflineCache(): Promise<void> {
    try {
      await AsyncStorage.setItem('offline_cache', JSON.stringify(this.offlineCache));
    } catch (error) {
      console.error('Error saving offline cache:', error);
    }
  }

  private async getCachedData(url: string): Promise<any | null> {
    const cached = this.offlineCache[url];
    if (cached && (Date.now() - cached.timestamp) < cached.ttl) {
      return cached.data;
    }
    return null;
  }

  private async cacheResponse(url: string, data: any): Promise<void> {
    this.offlineCache[url] = {
      data,
      timestamp: Date.now(),
      ttl: OFFLINE_TTL,
    };
    await this.saveOfflineCache();
  }

  private async queueRequest(config: any): Promise<void> {
    if (this.requestQueue.length >= MAX_QUEUE_SIZE) {
      this.requestQueue.shift(); // Remove oldest request
    }

    const queuedRequest: QueuedRequest = {
      id: this.generateRequestId(),
      config,
      timestamp: Date.now(),
      retryCount: 0,
    };

    this.requestQueue.push(queuedRequest);
    await AsyncStorage.setItem('request_queue', JSON.stringify(this.requestQueue));
  }

  private async processQueuedRequests(): Promise<void> {
    if (!this.isOnline || this.requestQueue.length === 0) return;

    const queue = [...this.requestQueue];
    this.requestQueue = [];

    for (const request of queue) {
      try {
        await this.client.request(request.config);
      } catch (error) {
        if (request.retryCount < MAX_RETRY_ATTEMPTS) {
          request.retryCount++;
          this.requestQueue.push(request);
        }
      }
    }

    await AsyncStorage.setItem('request_queue', JSON.stringify(this.requestQueue));
  }

  private async handleAuthError(): Promise<void> {
    try {
      const refreshTokenValue = await this.getSecureRefreshToken();
      if (refreshTokenValue) {
        const response = await this.client.post(ENDPOINTS.AUTH.REFRESH, {
          refresh_token: refreshTokenValue,
        });
        
        await this.setSecureToken(response.data.access_token);
        if (response.data.refresh_token) {
          await this.setSecureRefreshToken(response.data.refresh_token);
        }
      } else {
        store.dispatch(logout());
      }
    } catch (error) {
      store.dispatch(logout());
    }
  }

  private async getSecureRefreshToken(): Promise<string | null> {
    try {
      const encryptedToken = await AsyncStorage.getItem('refresh_token');
      if (!encryptedToken) return null;

      const decryptedToken = CryptoJS.AES.decrypt(encryptedToken, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
      return decryptedToken || null;
    } catch (error) {
      console.error('Error retrieving refresh token:', error);
      return null;
    }
  }

  private async setSecureRefreshToken(token: string): Promise<void> {
    try {
      const encryptedToken = CryptoJS.AES.encrypt(token, ENCRYPTION_KEY).toString();
      await AsyncStorage.setItem('refresh_token', encryptedToken);
    } catch (error) {
      console.error('Error storing refresh token:', error);
    }
  }

  private shouldRetry(error: AxiosError): boolean {
    return this.retryConfig.retryCondition?.(error) ?? false;
  }

  private async retryRequest(error: AxiosError): Promise<any> {
    const config = error.config as any;
    config.__retryCount = config.__retryCount || 0;

    if (config.__retryCount >= this.retryConfig.maxRetries) {
      return Promise.reject(error);
    }

    config.__retryCount++;

    await new Promise(resolve => 
      setTimeout(resolve, this.retryConfig.retryDelay * config.__retryCount)
    );

    return this.client.request(config);
  }

  // Public API methods
  public async get<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.get(url, config);
      return this.formatResponse(response);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  public async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.post(url, data, config);
      return this.formatResponse(response);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  public async put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.put(url, data, config);
      return this.formatResponse(response);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  public async patch<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.patch(url, data, config);
      return this.formatResponse(response);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  public async delete<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.delete(url, config);
      return this.formatResponse(response);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  public async upload<T>(
    url: string, 
    file: any, 
    onProgress?: (progress: number) => void
  ): Promise<ApiResponse<T>> {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await this.client.post(url, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress(progress);
          }
        },
      });

      return this.formatResponse(response);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private formatResponse<T>(response: AxiosResponse): ApiResponse<T> {
    return {
      data: response.data,
      message: response.data?.message,
      success: response.status >= 200 && response.status < 300,
      timestamp: Date.now(),
    };
  }

  private handleError(error: any): Error {
    if (error.isQueued) {
      return new Error('Request queued for offline processing');
    }

    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.message || error.message;
      
      switch (status) {
        case 400:
          return new Error(`Bad Request: ${message}`);
        case 401:
          return new Error('Authentication required');
        case 403:
          return new Error('Access denied');
        case 404:
          return new Error('Resource not found');
        case 429:
          return new Error('Rate limit exceeded. Please try again later.');
        case 500:
          return new Error('Server error. Please try again later.');
        default:
          return new Error(`Request failed: ${message}`);
      }
    }

    if (error.request) {
      return new Error('Network error. Please check your connection.');
    }

    return new Error(error.message || 'An unexpected error occurred');
  }

  // Utility methods
  public isOnlineMode(): boolean {
    return this.isOnline;
  }

  public getQueueSize(): number {
    return this.requestQueue.length;
  }

  public async clearCache(): Promise<void> {
    this.offlineCache = {};
    await AsyncStorage.removeItem('offline_cache');
  }

  public async clearQueue(): Promise<void> {
    this.requestQueue = [];
    await AsyncStorage.removeItem('request_queue');
  }

  public async clearAuth(): Promise<void> {
    await AsyncStorage.multiRemove(['auth_token', 'refresh_token']);
  }

  // Health check
  public async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health', { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }
}

// Create and export singleton instance
const apiClient = new ApiClient();

export default apiClient;

// Typed API functions for common operations
export const authApi = {
  login: (credentials: { email: string; password: string; mfaCode?: string }) =>
    apiClient.post(ENDPOINTS.AUTH.LOGIN, credentials),
  
  register: (userData: { 
    email: string; 
    password: string; 
    name: string; 
    referralCode?: string 
  }) =>
    apiClient.post(ENDPOINTS.AUTH.REGISTER, userData),
  
  logout: () => apiClient.post(ENDPOINTS.AUTH.LOGOUT),
  
  refreshToken: () => apiClient.post(ENDPOINTS.AUTH.REFRESH),
  
  verifyEmail: (token: string) =>
    apiClient.post(ENDPOINTS.AUTH.VERIFY_EMAIL, { token }),
  
  resetPassword: (email: string) =>
    apiClient.post(ENDPOINTS.AUTH.RESET_PASSWORD, { email }),
  
  changePassword: (data: { 
    currentPassword: string; 
    newPassword: string 
  }) =>
    apiClient.post(ENDPOINTS.AUTH.CHANGE_PASSWORD, data),
  
  setupMFA: (method: 'sms' | 'email' | 'authenticator') =>
    apiClient.post(ENDPOINTS.AUTH.MFA_SETUP, { method }),
  
  verifyMFA: (code: string, method: string) =>
    apiClient.post(ENDPOINTS.AUTH.MFA_VERIFY, { code, method }),
};

export const userApi = {
  getProfile: () => apiClient.get(ENDPOINTS.USER.PROFILE),
  
  updateProfile: (data: any) =>
    apiClient.put(ENDPOINTS.USER.PROFILE, data),
  
  getPreferences: () => apiClient.get(ENDPOINTS.USER.PREFERENCES),
  
  updatePreferences: (preferences: any) =>
    apiClient.put(ENDPOINTS.USER.PREFERENCES, preferences),
  
  getActivity: (page?: number, limit?: number) =>
    apiClient.get(`${ENDPOINTS.USER.ACTIVITY}?page=${page || 1}&limit=${limit || 20}`),
  
  deleteAccount: (password: string) =>
    apiClient.delete(ENDPOINTS.USER.DELETE_ACCOUNT, { data: { password } }),
};

export const subscriptionApi = {
  getPlans: () => apiClient.get(ENDPOINTS.SUBSCRIPTION.PLANS),
  
  getCurrentSubscription: () => apiClient.get(ENDPOINTS.SUBSCRIPTION.CURRENT),
  
  upgrade: (planId: string, paymentMethodId?: string) =>
    apiClient.post(ENDPOINTS.SUBSCRIPTION.UPGRADE, { planId, paymentMethodId }),
  
  cancel: () => apiClient.post(ENDPOINTS.SUBSCRIPTION.CANCEL),
  
  getUsage: () => apiClient.get(ENDPOINTS.SUBSCRIPTION.USAGE),
  
  verifyPurchase: (purchaseData: any) =>
    apiClient.post(ENDPOINTS.SUBSCRIPTION.VERIFY_PURCHASE, purchaseData),
};

export const contentApi = {
  generate: (data: {
    prompt: string;
    platforms: string[];
    tone?: string;
    language?: string;
    variations?: number;
  }) =>
    apiClient.post(ENDPOINTS.CONTENT.GENERATE, data),
  
  getTemplates: (category?: string) =>
    apiClient.get(`${ENDPOINTS.CONTENT.TEMPLATES}${category ? `?category=${category}` : ''}`),
  
  getHistory: (page?: number, limit?: number) =>
    apiClient.get(`${ENDPOINTS.CONTENT.HISTORY}?page=${page || 1}&limit=${limit || 20}`),
  
  save: (contentData: any) =>
    apiClient.post(ENDPOINTS.CONTENT.SAVE, contentData),
  
  delete: (contentId: string) =>
    apiClient.delete(`${ENDPOINTS.CONTENT.DELETE}/${contentId}`),
  
  optimize: (contentId: string, platform: string) =>
    apiClient.post(ENDPOINTS.CONTENT.OPTIMIZE, { contentId, platform }),
  
  translate: (contentId: string, targetLanguage: string) =>
    apiClient.post(ENDPOINTS.CONTENT.TRANSLATE, { contentId, targetLanguage }),
};

export const socialApi = {
  getPlatforms: () => apiClient.get(ENDPOINTS.SOCIAL.PLATFORMS),
  
  connectAccount: (platform: string, authData: any) =>
    apiClient.post(ENDPOINTS.SOCIAL.CONNECT, { platform, ...authData }),
  
  disconnectAccount: (accountId: string) =>
    apiClient.delete(`${ENDPOINTS.SOCIAL.DISCONNECT}/${accountId}`),
  
  getAccounts: () => apiClient.get(ENDPOINTS.SOCIAL.ACCOUNTS),
  
  post: (data: {
    content: string;
    platforms: string[];
    media?: any[];
    scheduleTime?: string;
  }) =>
    apiClient.post(ENDPOINTS.SOCIAL.POST, data),
  
  schedule: (data: any) =>
    apiClient.post(ENDPOINTS.SOCIAL.SCHEDULE, data),
  
  getAnalytics: (dateRange?: { from: string; to: string }) =>
    apiClient.get(ENDPOINTS.SOCIAL.ANALYTICS, { params: dateRange }),
  
  bulkDelete: (filters: any) =>
    apiClient.post(ENDPOINTS.SOCIAL.BULK_DELETE, filters),
};

// Export types for TypeScript users
export type { ApiResponse, QueuedRequest, OfflineData, RetryConfig };