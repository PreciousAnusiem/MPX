import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';
import { apiService } from '../services/api';
import { analyticsService } from '../services/analytics';

// Types
export interface ContentItem {
  id: string;
  originalPrompt: string;
  variations: ContentVariation[];
  platforms: string[];
  language: string;
  createdAt: string;
  lastModified: string;
  status: 'draft' | 'scheduled' | 'published' | 'failed';
  analytics?: ContentAnalytics;
  isOffline?: boolean;
  syncStatus: 'synced' | 'pending' | 'failed';
}

export interface ContentVariation {
  id: string;
  platform: string;
  content: string;
  hashtags: string[];
  mediaUrls: string[];
  optimizationScore: number;
  culturalAdaptation?: CulturalAdaptation;
  scheduledTime?: string;
  publishedAt?: string;
  engagement?: EngagementMetrics;
}

export interface CulturalAdaptation {
  region: string;
  localizedContent: string;
  culturalContext: string[];
  sensitivityScore: number;
  complianceFlags: string[];
}

export interface ContentAnalytics {
  views: number;
  likes: number;
  shares: number;
  comments: number;
  reach: number;
  engagement: number;
  conversionRate: number;
  revenue: number;
}

export interface EngagementMetrics {
  likes: number;
  shares: number;
  comments: number;
  saves: number;
  clickThrough: number;
  conversionRate: number;
}

export interface ContentTemplate {
  id: string;
  name: string;
  category: string;
  template: string;
  platforms: string[];
  language: string;
  isCustom: boolean;
  usageCount: number;
  effectiveness: number;
}

export interface ContentState {
  items: ContentItem[];
  templates: ContentTemplate[];
  currentContent: ContentItem | null;
  isGenerating: boolean;
  isPublishing: boolean;
  isSyncing: boolean;
  error: string | null;
  filters: {
    platform: string;
    status: string;
    language: string;
    dateRange: string;
  };
  offlineQueue: ContentItem[];
  recentPrompts: string[];
  totalGenerated: number;
  totalPublished: number;
  averageEngagement: number;
  bestPerformingContent: ContentItem | null;
  contentInsights: {
    topHashtags: string[];
    bestTimes: string[];
    highPerformingFormats: string[];
    audiencePreferences: Record<string, number>;
  };
  aiSuggestions: {
    prompts: string[];
    hashtags: string[];
    postingTimes: string[];
    contentGaps: string[];
  };
}

const initialState: ContentState = {
  items: [],
  templates: [],
  currentContent: null,
  isGenerating: false,
  isPublishing: false,
  isSyncing: false,
  error: null,
  filters: {
    platform: 'all',
    status: 'all',
    language: 'all',
    dateRange: 'all'
  },
  offlineQueue: [],
  recentPrompts: [],
  totalGenerated: 0,
  totalPublished: 0,
  averageEngagement: 0,
  bestPerformingContent: null,
  contentInsights: {
    topHashtags: [],
    bestTimes: [],
    highPerformingFormats: [],
    audiencePreferences: {}
  },
  aiSuggestions: {
    prompts: [],
    hashtags: [],
    postingTimes: [],
    contentGaps: []
  }
};

// Storage keys
const STORAGE_KEYS = {
  CONTENT_ITEMS: '@onxlink_content_items',
  TEMPLATES: '@onxlink_templates',
  OFFLINE_QUEUE: '@onxlink_offline_queue',
  RECENT_PROMPTS: '@onxlink_recent_prompts',
  CONTENT_ANALYTICS: '@onxlink_content_analytics',
  AI_SUGGESTIONS: '@onxlink_ai_suggestions'
};

// Encryption key (should be from secure key derivation in production)
const getEncryptionKey = async (): Promise<string> => {
  try {
    let key = await AsyncStorage.getItem('@onxlink_content_key');
    if (!key) {
      key = CryptoJS.lib.WordArray.random(256/8).toString();
      await AsyncStorage.setItem('@onxlink_content_key', key);
    }
    return key;
  } catch (error) {
    // Fallback key generation
    return CryptoJS.lib.WordArray.random(256/8).toString();
  }
};

// Secure storage helpers
const encryptData = async (data: any): Promise<string> => {
  const key = await getEncryptionKey();
  return CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();
};

const decryptData = async (encryptedData: string): Promise<any> => {
  try {
    const key = await getEncryptionKey();
    const bytes = CryptoJS.AES.decrypt(encryptedData, key);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
};

// Async thunks
export const generateContent = createAsyncThunk(
  'content/generateContent',
  async (params: {
    prompt: string;
    platforms: string[];
    language: string;
    culturalRegion?: string;
    tone?: string;
    industry?: string;
  }, { rejectWithValue, dispatch }) => {
    try {
      // Track generation attempt
      analyticsService.trackEvent('content_generation_started', {
        platforms: params.platforms,
        language: params.language,
        prompt_length: params.prompt.length
      });

      // Generate content via API
      const response = await apiService.generateContent({
        prompt: params.prompt,
        platforms: params.platforms,
        language: params.language,
        cultural_region: params.culturalRegion || 'global',
        tone: params.tone || 'professional',
        industry: params.industry || 'general'
      });

      // Create content item
      const contentItem: ContentItem = {
        id: `content_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        originalPrompt: params.prompt,
        variations: response.variations.map((variation: any, index: number) => ({
          id: `var_${Date.now()}_${index}`,
          platform: variation.platform,
          content: variation.content,
          hashtags: variation.hashtags || [],
          mediaUrls: variation.media_urls || [],
          optimizationScore: variation.optimization_score || 0,
          culturalAdaptation: variation.cultural_adaptation ? {
            region: variation.cultural_adaptation.region,
            localizedContent: variation.cultural_adaptation.localized_content,
            culturalContext: variation.cultural_adaptation.cultural_context || [],
            sensitivityScore: variation.cultural_adaptation.sensitivity_score || 0,
            complianceFlags: variation.cultural_adaptation.compliance_flags || []
          } : undefined
        })),
        platforms: params.platforms,
        language: params.language,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        status: 'draft',
        syncStatus: 'synced'
      };

      // Store in offline cache
      await dispatch(saveContentOffline(contentItem));

      // Update recent prompts
      await dispatch(addToRecentPrompts(params.prompt));

      // Track successful generation
      analyticsService.trackEvent('content_generation_completed', {
        content_id: contentItem.id,
        variations_count: contentItem.variations.length,
        generation_time: Date.now()
      });

      return contentItem;
    } catch (error: any) {
      // Track generation failure
      analyticsService.trackEvent('content_generation_failed', {
        error: error.message,
        platforms: params.platforms
      });

      return rejectWithValue(error.response?.data?.message || 'Content generation failed');
    }
  }
);

export const publishContent = createAsyncThunk(
  'content/publishContent',
  async (params: {
    contentId: string;
    variationIds: string[];
    scheduledTime?: string;
  }, { getState, rejectWithValue, dispatch }) => {
    try {
      const state = getState() as { content: ContentState };
      const content = state.content.items.find(item => item.id === params.contentId);
      
      if (!content) {
        throw new Error('Content not found');
      }

      const variationsToPublish = content.variations.filter(
        v => params.variationIds.includes(v.id)
      );

      // Track publishing attempt
      analyticsService.trackEvent('content_publishing_started', {
        content_id: params.contentId,
        variations_count: variationsToPublish.length,
        platforms: variationsToPublish.map(v => v.platform)
      });

      if (params.scheduledTime) {
        // Schedule for later
        const updatedContent = {
          ...content,
          status: 'scheduled' as const,
          variations: content.variations.map(v => 
            params.variationIds.includes(v.id) 
              ? { ...v, scheduledTime: params.scheduledTime }
              : v
          ),
          lastModified: new Date().toISOString()
        };

        await dispatch(updateContentOffline(updatedContent));
        return updatedContent;
      } else {
        // Publish immediately
        const publishResults = await apiService.publishContent({
          content_id: params.contentId,
          variations: variationsToPublish.map(v => ({
            id: v.id,
            platform: v.platform,
            content: v.content,
            hashtags: v.hashtags,
            media_urls: v.mediaUrls
          }))
        });

        const updatedContent = {
          ...content,
          status: 'published' as const,
          variations: content.variations.map(v => {
            const result = publishResults.find((r: any) => r.variation_id === v.id);
            return params.variationIds.includes(v.id) 
              ? { 
                  ...v, 
                  publishedAt: new Date().toISOString(),
                  engagement: result?.initial_metrics || {
                    likes: 0,
                    shares: 0,
                    comments: 0,
                    saves: 0,
                    clickThrough: 0,
                    conversionRate: 0
                  }
                }
              : v;
          }),
          lastModified: new Date().toISOString(),
          syncStatus: 'synced' as const
        };

        await dispatch(updateContentOffline(updatedContent));

        // Track successful publishing
        analyticsService.trackEvent('content_publishing_completed', {
          content_id: params.contentId,
          published_platforms: variationsToPublish.map(v => v.platform)
        });

        return updatedContent;
      }
    } catch (error: any) {
      // Add to offline queue for retry
      await dispatch(addToOfflineQueue({
        action: 'publish',
        contentId: params.contentId,
        variationIds: params.variationIds,
        scheduledTime: params.scheduledTime,
        timestamp: Date.now()
      }));

      analyticsService.trackEvent('content_publishing_failed', {
        content_id: params.contentId,
        error: error.message
      });

      return rejectWithValue(error.response?.data?.message || 'Publishing failed');
    }
  }
);

export const syncOfflineContent = createAsyncThunk(
  'content/syncOfflineContent',
  async (_, { getState, dispatch }) => {
    try {
      const state = getState() as { content: ContentState };
      const offlineQueue = [...state.content.offlineQueue];
      const syncResults = [];

      for (const queueItem of offlineQueue) {
        try {
          if (queueItem.action === 'publish') {
            await dispatch(publishContent({
              contentId: queueItem.contentId,
              variationIds: queueItem.variationIds,
              scheduledTime: queueItem.scheduledTime
            }));
          }
          syncResults.push({ ...queueItem, status: 'synced' });
        } catch (error) {
          syncResults.push({ ...queueItem, status: 'failed', error });
        }
      }

      // Remove successfully synced items from queue
      const failedItems = syncResults.filter(item => item.status === 'failed');
      await AsyncStorage.setItem(
        STORAGE_KEYS.OFFLINE_QUEUE,
        await encryptData(failedItems)
      );

      analyticsService.trackEvent('offline_sync_completed', {
        total_items: offlineQueue.length,
        synced_items: syncResults.filter(item => item.status === 'synced').length,
        failed_items: failedItems.length
      });

      return syncResults;
    } catch (error: any) {
      throw new Error(`Sync failed: ${error.message}`);
    }
  }
);

export const loadOfflineContent = createAsyncThunk(
  'content/loadOfflineContent',
  async () => {
    try {
      const [
        encryptedItems,
        encryptedTemplates,
        encryptedQueue,
        encryptedPrompts,
        encryptedAnalytics,
        encryptedSuggestions
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.CONTENT_ITEMS),
        AsyncStorage.getItem(STORAGE_KEYS.TEMPLATES),
        AsyncStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE),
        AsyncStorage.getItem(STORAGE_KEYS.RECENT_PROMPTS),
        AsyncStorage.getItem(STORAGE_KEYS.CONTENT_ANALYTICS),
        AsyncStorage.getItem(STORAGE_KEYS.AI_SUGGESTIONS)
      ]);

      const [
        items,
        templates,
        offlineQueue,
        recentPrompts,
        analytics,
        suggestions
      ] = await Promise.all([
        encryptedItems ? decryptData(encryptedItems) : [],
        encryptedTemplates ? decryptData(encryptedTemplates) : [],
        encryptedQueue ? decryptData(encryptedQueue) : [],
        encryptedPrompts ? decryptData(encryptedPrompts) : [],
        encryptedAnalytics ? decryptData(encryptedAnalytics) : null,
        encryptedSuggestions ? decryptData(encryptedSuggestions) : null
      ]);

      return {
        items: items || [],
        templates: templates || [],
        offlineQueue: offlineQueue || [],
        recentPrompts: recentPrompts || [],
        analytics: analytics || {},
        suggestions: suggestions || {}
      };
    } catch (error) {
      console.error('Failed to load offline content:', error);
      return {
        items: [],
        templates: [],
        offlineQueue: [],
        recentPrompts: [],
        analytics: {},
        suggestions: {}
      };
    }
  }
);

// Helper thunks
export const saveContentOffline = createAsyncThunk(
  'content/saveContentOffline',
  async (content: ContentItem, { getState }) => {
    try {
      const state = getState() as { content: ContentState };
      const updatedItems = [...state.content.items];
      const existingIndex = updatedItems.findIndex(item => item.id === content.id);
      
      if (existingIndex >= 0) {
        updatedItems[existingIndex] = content;
      } else {
        updatedItems.unshift(content);
      }

      // Keep only last 500 items for performance
      const itemsToStore = updatedItems.slice(0, 500);
      
      await AsyncStorage.setItem(
        STORAGE_KEYS.CONTENT_ITEMS,
        await encryptData(itemsToStore)
      );

      return content;
    } catch (error) {
      console.error('Failed to save content offline:', error);
      throw error;
    }
  }
);

export const updateContentOffline = createAsyncThunk(
  'content/updateContentOffline',
  async (content: ContentItem, { dispatch }) => {
    await dispatch(saveContentOffline(content));
    return content;
  }
);

export const addToOfflineQueue = createAsyncThunk(
  'content/addToOfflineQueue',
  async (queueItem: any, { getState }) => {
    try {
      const state = getState() as { content: ContentState };
      const updatedQueue = [...state.content.offlineQueue, queueItem];
      
      await AsyncStorage.setItem(
        STORAGE_KEYS.OFFLINE_QUEUE,
        await encryptData(updatedQueue)
      );

      return queueItem;
    } catch (error) {
      console.error('Failed to add to offline queue:', error);
      throw error;
    }
  }
);

export const addToRecentPrompts = createAsyncThunk(
  'content/addToRecentPrompts',
  async (prompt: string, { getState }) => {
    try {
      const state = getState() as { content: ContentState };
      const updatedPrompts = [prompt, ...state.content.recentPrompts.filter(p => p !== prompt)];
      const promptsToStore = updatedPrompts.slice(0, 20); // Keep last 20 prompts

      await AsyncStorage.setItem(
        STORAGE_KEYS.RECENT_PROMPTS,
        await encryptData(promptsToStore)
      );

      return promptsToStore;
    } catch (error) {
      console.error('Failed to save recent prompts:', error);
      throw error;
    }
  }
);

// Content slice
const contentSlice = createSlice({
  name: 'content',
  initialState,
  reducers: {
    setCurrentContent: (state, action: PayloadAction<ContentItem | null>) => {
      state.currentContent = action.payload;
    },
    
    setFilters: (state, action: PayloadAction<Partial<ContentState['filters']>>) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    
    clearError: (state) => {
      state.error = null;
    },
    
    updateContentAnalytics: (state, action: PayloadAction<{
      contentId: string;
      analytics: ContentAnalytics;
    }>) => {
      const content = state.items.find(item => item.id === action.payload.contentId);
      if (content) {
        content.analytics = action.payload.analytics;
        content.lastModified = new Date().toISOString();
      }
    },
    
    updateVariationEngagement: (state, action: PayloadAction<{
      contentId: string;
      variationId: string;
      engagement: EngagementMetrics;
    }>) => {
      const content = state.items.find(item => item.id === action.payload.contentId);
      if (content) {
        const variation = content.variations.find(v => v.id === action.payload.variationId);
        if (variation) {
          variation.engagement = action.payload.engagement;
          content.lastModified = new Date().toISOString();
        }
      }
    },
    
    deleteContent: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter(item => item.id !== action.payload);
      if (state.currentContent?.id === action.payload) {
        state.currentContent = null;
      }
    },
    
    duplicateContent: (state, action: PayloadAction<string>) => {
      const originalContent = state.items.find(item => item.id === action.payload);
      if (originalContent) {
        const duplicatedContent: ContentItem = {
          ...originalContent,
          id: `content_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          status: 'draft',
          syncStatus: 'pending',
          variations: originalContent.variations.map((v, index) => ({
            ...v,
            id: `var_${Date.now()}_${index}`,
            publishedAt: undefined,
            engagement: undefined,
            scheduledTime: undefined
          }))
        };
        state.items.unshift(duplicatedContent);
      }
    },
    
    addCustomTemplate: (state, action: PayloadAction<{
      name: string;
      category: string;
      template: string;
      platforms: string[];
      language: string;
    }>) => {
      const newTemplate: ContentTemplate = {
        id: `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: action.payload.name,
        category: action.payload.category,
        template: action.payload.template,
        platforms: action.payload.platforms,
        language: action.payload.language,
        isCustom: true,
        usageCount: 0,
        effectiveness: 0
      };
      state.templates.unshift(newTemplate);
    },
    
    updateTemplateUsage: (state, action: PayloadAction<{
      templateId: string;
      effectiveness?: number;
    }>) => {
      const template = state.templates.find(t => t.id === action.payload.templateId);
      if (template) {
        template.usageCount += 1;
        if (action.payload.effectiveness !== undefined) {
          template.effectiveness = action.payload.effectiveness;
        }
      }
    },
    
    updateContentInsights: (state, action: PayloadAction<Partial<ContentState['contentInsights']>>) => {
      state.contentInsights = { ...state.contentInsights, ...action.payload };
    },
    
    updateAISuggestions: (state, action: PayloadAction<Partial<ContentState['aiSuggestions']>>) => {
      state.aiSuggestions = { ...state.aiSuggestions, ...action.payload };
    },
    
    markContentAsViewed: (state, action: PayloadAction<string>) => {
      const content = state.items.find(item => item.id === action.payload);
      if (content && content.analytics) {
        content.analytics.views += 1;
      }
    },
    
    toggleContentFavorite: (state, action: PayloadAction<string>) => {
      const content = state.items.find(item => item.id === action.payload);
      if (content) {
        content.isFavorite = !content.isFavorite;
        content.lastModified = new Date().toISOString();
      }
    },
    
    bulkUpdateStatus: (state, action: PayloadAction<{
      contentIds: string[];
      status: ContentItem['status'];
    }>) => {
      action.payload.contentIds.forEach(id => {
        const content = state.items.find(item => item.id === id);
        if (content) {
          content.status = action.payload.status;
          content.lastModified = new Date().toISOString();
          content.syncStatus = 'pending';
        }
      });
    },
    
    clearOfflineQueue: (state) => {
      state.offlineQueue = [];
    }
  },
  
  extraReducers: (builder) => {
    builder
      // Generate content
      .addCase(generateContent.pending, (state) => {
        state.isGenerating = true;
        state.error = null;
      })
      .addCase(generateContent.fulfilled, (state, action) => {
        state.isGenerating = false;
        state.items.unshift(action.payload);
        state.totalGenerated += 1;
        state.currentContent = action.payload;
      })
      .addCase(generateContent.rejected, (state, action) => {
        state.isGenerating = false;
        state.error = action.payload as string;
      })
      
      // Publish content
      .addCase(publishContent.pending, (state) => {
        state.isPublishing = true;
        state.error = null;
      })
      .addCase(publishContent.fulfilled, (state, action) => {
        state.isPublishing = false;
        const index = state.items.findIndex(item => item.id === action.payload.id);
        if (index >= 0) {
          state.items[index] = action.payload;
          if (action.payload.status === 'published') {
            state.totalPublished += 1;
          }
        }
      })
      .addCase(publishContent.rejected, (state, action) => {
        state.isPublishing = false;
        state.error = action.payload as string;
      })
      
      // Sync offline content
      .addCase(syncOfflineContent.pending, (state) => {
        state.isSyncing = true;
        state.error = null;
      })
      .addCase(syncOfflineContent.fulfilled, (state, action) => {
        state.isSyncing = false;
        // Update sync status for successfully synced items
        action.payload.forEach(result => {
          if (result.status === 'synced') {
            const content = state.items.find(item => item.id === result.contentId);
            if (content) {
              content.syncStatus = 'synced';
            }
          }
        });
        // Remove synced items from offline queue
        state.offlineQueue = state.offlineQueue.filter(item => 
          !action.payload.some(result => 
            result.contentId === item.contentId && result.status === 'synced'
          )
        );
      })
      .addCase(syncOfflineContent.rejected, (state, action) => {
        state.isSyncing = false;
        state.error = action.error.message || 'Sync failed';
      })
      
      // Load offline content
      .addCase(loadOfflineContent.fulfilled, (state, action) => {
        state.items = action.payload.items;
        state.templates = action.payload.templates;
        state.offlineQueue = action.payload.offlineQueue;
        state.recentPrompts = action.payload.recentPrompts;
        
        // Calculate analytics
        state.totalGenerated = state.items.length;
        state.totalPublished = state.items.filter(item => item.status === 'published').length;
        
        const publishedItems = state.items.filter(item => item.analytics);
        if (publishedItems.length > 0) {
          state.averageEngagement = publishedItems.reduce((sum, item) => 
            sum + (item.analytics?.engagement || 0), 0) / publishedItems.length;
          
          state.bestPerformingContent = publishedItems.reduce((best, current) => 
            (current.analytics?.engagement || 0) > (best?.analytics?.engagement || 0) 
              ? current : best, null as ContentItem | null);
        }
      })
      
      // Save content offline
      .addCase(saveContentOffline.fulfilled, (state, action) => {
        const index = state.items.findIndex(item => item.id === action.payload.id);
        if (index >= 0) {
          state.items[index] = action.payload;
        } else {
          state.items.unshift(action.payload);
        }
      })
      
      // Add to offline queue
      .addCase(addToOfflineQueue.fulfilled, (state, action) => {
        state.offlineQueue.push(action.payload);
      })
      
      // Update recent prompts
      .addCase(addToRecentPrompts.fulfilled, (state, action) => {
        state.recentPrompts = action.payload;
      });
  }
});

export const {
  setCurrentContent,
  setFilters,
  clearError,
  updateContentAnalytics,
  updateVariationEngagement,
  deleteContent,
  duplicateContent,
  addCustomTemplate,
  updateTemplateUsage,
  updateContentInsights,
  updateAISuggestions,
  markContentAsViewed,
  toggleContentFavorite,
  bulkUpdateStatus,
  clearOfflineQueue
} = contentSlice.actions;

// Selectors
export const selectAllContent = (state: { content: ContentState }) => state.content.items;
export const selectCurrentContent = (state: { content: ContentState }) => state.content.currentContent;
export const selectContentByStatus = (status: string) => (state: { content: ContentState }) => 
  state.content.items.filter(item => status === 'all' || item.status === status);
export const selectContentByPlatform = (platform: string) => (state: { content: ContentState }) => 
  state.content.items.filter(item => 
    platform === 'all' || item.platforms.includes(platform)
  );
export const selectRecentContent = (state: { content: ContentState }) => 
  state.content.items.slice(0, 10);
export const selectTopPerformingContent = (state: { content: ContentState }) => 
  state.content.items
    .filter(item => item.analytics)
    .sort((a, b) => (b.analytics?.engagement || 0) - (a.analytics?.engagement || 0))
    .slice(0, 5);
export const selectContentTemplates = (state: { content: ContentState }) => state.content.templates;
export const selectRecentPrompts = (state: { content: ContentState }) => state.content.recentPrompts;
export const selectOfflineQueue = (state: { content: ContentState }) => state.content.offlineQueue;
export const selectContentInsights = (state: { content: ContentState }) => state.content.contentInsights;
export const selectAISuggestions = (state: { content: ContentState }) => state.content.aiSuggestions;
export const selectContentAnalytics = (state: { content: ContentState }) => ({
  totalGenerated: state.content.totalGenerated,
  totalPublished: state.content.totalPublished,
  averageEngagement: state.content.averageEngagement,
  bestPerformingContent: state.content.bestPerformingContent
});

export default contentSlice.reducer;