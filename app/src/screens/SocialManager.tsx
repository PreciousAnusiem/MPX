import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Image,
  TextInput,
  Switch,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Animated,
  Vibration,
  Share,
} from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Haptics from 'expo-haptics';
import { launchImageLibrary } from 'react-native-image-picker';
import Video from 'react-native-video';

import { RootState } from '../store';
import { updateUser, setSocialConnections } from '../store/userSlice';
import { addContent, setScheduledPosts, updatePostStatus } from '../store/contentSlice';
import { api } from '../services/api';
import { analytics } from '../services/analytics';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { theme } from '../utils/constants';
import { encryptData, decryptData } from '../utils/helpers';

// Types
interface Platform {
  id: string;
  name: string;
  icon: string;
  color: string;
  connected: boolean;
  followers?: number;
  lastPost?: string;
  features: string[];
  maxVideoSize: number; // MB
  maxImageSize: number; // MB
  aspectRatios: string[];
  hashtagLimit: number;
  characterLimit: number;
}

interface PostData {
  id: string;
  content: string;
  media: MediaItem[];
  platforms: string[];
  scheduledTime?: Date;
  status: 'draft' | 'scheduled' | 'posted' | 'failed';
  hashtags: string[];
  mentions: string[];
  createdAt: Date;
  performance?: {
    likes: number;
    shares: number;
    comments: number;
    reach: number;
  };
}

interface MediaItem {
  id: string;
  type: 'image' | 'video';
  uri: string;
  thumbnail?: string;
  duration?: number;
  size: number;
  aspectRatio: string;
}

interface QueueItem {
  id: string;
  post: PostData;
  retryCount: number;
  nextAttempt: Date;
}

const PLATFORMS: Platform[] = [
  {
    id: 'instagram',
    name: 'Instagram',
    icon: '📷',
    color: '#E4405F',
    connected: false,
    features: ['stories', 'reels', 'posts', 'igtv'],
    maxVideoSize: 100,
    maxImageSize: 30,
    aspectRatios: ['1:1', '4:5', '9:16'],
    hashtagLimit: 30,
    characterLimit: 2200,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    icon: '🎵',
    color: '#000000',
    connected: false,
    features: ['videos', 'stories'],
    maxVideoSize: 500,
    maxImageSize: 10,
    aspectRatios: ['9:16'],
    hashtagLimit: 100,
    characterLimit: 300,
  },
  {
    id: 'twitter',
    name: 'Twitter',
    icon: '🐦',
    color: '#1DA1F2',
    connected: false,
    features: ['tweets', 'threads', 'spaces'],
    maxVideoSize: 512,
    maxImageSize: 5,
    aspectRatios: ['16:9', '2:1', '1:1'],
    hashtagLimit: 10,
    characterLimit: 280,
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: '👥',
    color: '#4267B2',
    connected: false,
    features: ['posts', 'stories', 'reels', 'live'],
    maxVideoSize: 1000,
    maxImageSize: 20,
    aspectRatios: ['16:9', '1:1', '4:5'],
    hashtagLimit: 30,
    characterLimit: 63206,
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: '💼',
    color: '#0077B5',
    connected: false,
    features: ['posts', 'articles', 'stories'],
    maxVideoSize: 5000,
    maxImageSize: 20,
    aspectRatios: ['1.91:1', '1:1'],
    hashtagLimit: 5,
    characterLimit: 3000,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    icon: '📺',
    color: '#FF0000',
    connected: false,
    features: ['videos', 'shorts', 'live', 'community'],
    maxVideoSize: 15000,
    maxImageSize: 2,
    aspectRatios: ['16:9', '9:16'],
    hashtagLimit: 15,
    characterLimit: 5000,
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    icon: '📌',
    color: '#BD081C',
    connected: false,
    features: ['pins', 'stories'],
    maxVideoSize: 2000,
    maxImageSize: 20,
    aspectRatios: ['2:3', '1:1', '9:16'],
    hashtagLimit: 20,
    characterLimit: 500,
  },
  {
    id: 'snapchat',
    name: 'Snapchat',
    icon: '👻',
    color: '#FFFC00',
    connected: false,
    features: ['snaps', 'stories', 'spotlight'],
    maxVideoSize: 1000,
    maxImageSize: 5,
    aspectRatios: ['9:16'],
    hashtagLimit: 0,
    characterLimit: 80,
  },
];

const SocialManager: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { user, subscription, socialConnections } = useSelector((state: RootState) => state.user);
  const { content } = useSelector((state: RootState) => state.content);
  
  // State
  const [platforms, setPlatforms] = useState<Platform[]>(PLATFORMS);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [postContent, setPostContent] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<MediaItem[]>([]);
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [isConnecting, setIsConnecting] = useState<string | null>(null);
  const [postQueue, setPostQueue] = useState<QueueItem[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'compose' | 'queue' | 'analytics'>('compose');
  const [previewMode, setPreviewMode] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<string[]>([]);
  
  // Animated values
  const fadeAnim = new Animated.Value(0);
  const slideAnim = new Animated.Value(50);

  // Effects
  useEffect(() => {
    initializeManager();
    setupNetworkListener();
    loadOfflineData();
    
    // Start animations
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      // Cleanup
    };
  }, []);

  useEffect(() => {
    syncPlatformConnections();
  }, [socialConnections]);

  useEffect(() => {
    if (isOnline) {
      processOfflineQueue();
      syncScheduledPosts();
    }
  }, [isOnline]);

  // Initialization
  const initializeManager = async () => {
    try {
      await loadPlatformStates();
      await loadQueuedPosts();
      analytics.track('social_manager_opened', {
        connectedPlatforms: platforms.filter(p => p.connected).length,
        subscriptionTier: subscription?.tier,
      });
    } catch (error) {
      console.error('Failed to initialize social manager:', error);
    }
  };

  const setupNetworkListener = () => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? false);
    });
    return unsubscribe;
  };

  const loadOfflineData = async () => {
    try {
      const offlineData = await AsyncStorage.getItem('socialManager_offline');
      if (offlineData) {
        const parsed = JSON.parse(offlineData);
        setPostQueue(parsed.queue || []);
        setHashtags(parsed.savedHashtags || []);
      }
    } catch (error) {
      console.error('Failed to load offline data:', error);
    }
  };

  // Platform Management
  const syncPlatformConnections = () => {
    const updatedPlatforms = platforms.map(platform => ({
      ...platform,
      connected: socialConnections?.[platform.id]?.connected || false,
      followers: socialConnections?.[platform.id]?.followers,
      lastPost: socialConnections?.[platform.id]?.lastPost,
    }));
    setPlatforms(updatedPlatforms);
  };

  const connectPlatform = async (platformId: string) => {
    if (!isOnline) {
      Alert.alert(t('offline'), t('connectionRequiresInternet'));
      return;
    }

    setIsConnecting(platformId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const platform = platforms.find(p => p.id === platformId);
      if (!platform) return;

      // Check subscription limits
      const connectedCount = platforms.filter(p => p.connected).length;
      const limits = getSubscriptionLimits();
      
      if (connectedCount >= limits.maxPlatforms) {
        Alert.alert(
          t('limitReached'),
          t('upgradeToContinue'),
          [
            { text: t('cancel'), style: 'cancel' },
            { text: t('upgrade'), onPress: () => navigateToSubscription() },
          ]
        );
        return;
      }

      // Initiate OAuth flow
      const authResult = await api.connectSocialPlatform(platformId);
      
      if (authResult.success) {
        const updatedConnections = {
          ...socialConnections,
          [platformId]: {
            connected: true,
            accessToken: await encryptData(authResult.accessToken),
            refreshToken: await encryptData(authResult.refreshToken || ''),
            expiresAt: authResult.expiresAt,
            userId: authResult.userId,
            username: authResult.username,
            followers: authResult.followers,
            lastPost: null,
          },
        };

        dispatch(setSocialConnections(updatedConnections));
        await AsyncStorage.setItem('socialConnections', JSON.stringify(updatedConnections));

        Alert.alert(t('success'), t('platformConnected', { platform: platform.name }));
        analytics.track('platform_connected', { platform: platformId });
      }
    } catch (error) {
      console.error('Failed to connect platform:', error);
      Alert.alert(t('error'), t('connectionFailed'));
    } finally {
      setIsConnecting(null);
    }
  };

  const disconnectPlatform = async (platformId: string) => {
    Alert.alert(
      t('disconnectPlatform'),
      t('disconnectConfirmation'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('disconnect'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.disconnectSocialPlatform(platformId);
              
              const updatedConnections = { ...socialConnections };
              delete updatedConnections[platformId];
              
              dispatch(setSocialConnections(updatedConnections));
              await AsyncStorage.setItem('socialConnections', JSON.stringify(updatedConnections));
              
              analytics.track('platform_disconnected', { platform: platformId });
            } catch (error) {
              console.error('Failed to disconnect platform:', error);
            }
          },
        },
      ]
    );
  };

  // Content Creation
  const selectMedia = () => {
    launchImageLibrary(
      {
        mediaType: 'mixed',
        selectionLimit: 10,
        quality: 0.8,
        includeBase64: false,
      },
      (response) => {
        if (response.assets) {
          const newMedia = response.assets.map(asset => ({
            id: Math.random().toString(),
            type: asset.type?.startsWith('video') ? 'video' as const : 'image' as const,
            uri: asset.uri!,
            size: asset.fileSize || 0,
            aspectRatio: calculateAspectRatio(asset.width!, asset.height!),
            duration: asset.duration,
          }));
          
          setSelectedMedia([...selectedMedia, ...newMedia]);
          analytics.track('media_selected', { count: newMedia.length });
        }
      }
    );
  };

  const removeMedia = (mediaId: string) => {
    setSelectedMedia(selectedMedia.filter(m => m.id !== mediaId));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const generateAIContent = async () => {
    if (!isOnline) {
      Alert.alert(t('offline'), t('aiRequiresInternet'));
      return;
    }

    setIsGeneratingAI(true);
    
    try {
      const suggestions = await api.generateContentSuggestions({
        platforms: selectedPlatforms,
        topic: postContent,
        tone: user?.preferences?.contentTone || 'professional',
        language: user?.language || 'en',
      });
      
      setAiSuggestions(suggestions);
      analytics.track('ai_content_generated', { 
        platforms: selectedPlatforms,
        suggestionsCount: suggestions.length 
      });
    } catch (error) {
      console.error('Failed to generate AI content:', error);
      Alert.alert(t('error'), t('aiGenerationFailed'));
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const applyAISuggestion = (suggestion: string) => {
    setPostContent(suggestion);
    setAiSuggestions([]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // Posting Logic
  const validatePost = (): string[] => {
    const errors: string[] = [];
    
    if (!postContent.trim() && selectedMedia.length === 0) {
      errors.push(t('contentRequired'));
    }
    
    if (selectedPlatforms.length === 0) {
      errors.push(t('platformRequired'));
    }
    
    // Platform-specific validation
    selectedPlatforms.forEach(platformId => {
      const platform = platforms.find(p => p.id === platformId);
      if (!platform) return;
      
      if (postContent.length > platform.characterLimit) {
        errors.push(t('contentTooLong', { platform: platform.name, limit: platform.characterLimit }));
      }
      
      selectedMedia.forEach(media => {
        const maxSize = media.type === 'video' ? platform.maxVideoSize : platform.maxImageSize;
        if (media.size > maxSize * 1024 * 1024) {
          errors.push(t('fileTooLarge', { platform: platform.name, maxSize }));
        }
        
        if (!platform.aspectRatios.includes(media.aspectRatio)) {
          errors.push(t('unsupportedAspectRatio', { platform: platform.name }));
        }
      });
    });
    
    return errors;
  };

  const createPost = async () => {
    const errors = validatePost();
    if (errors.length > 0) {
      Alert.alert(t('validationErrors'), errors.join('\n'));
      return;
    }

    setIsPosting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const postData: PostData = {
        id: Math.random().toString(),
        content: postContent,
        media: selectedMedia,
        platforms: selectedPlatforms,
        scheduledTime: scheduledDate,
        status: scheduledDate ? 'scheduled' : 'draft',
        hashtags,
        mentions,
        createdAt: new Date(),
      };

      if (scheduledDate && scheduledDate > new Date()) {
        // Schedule post
        await schedulePost(postData);
        Alert.alert(t('success'), t('postScheduled'));
      } else if (isOnline) {
        // Post immediately
        await publishPost(postData);
        Alert.alert(t('success'), t('postPublished'));
      } else {
        // Queue for later
        await queuePost(postData);
        Alert.alert(t('queued'), t('postQueuedOffline'));
      }

      // Reset form
      resetPostForm();
      analytics.track('post_created', {
        platforms: selectedPlatforms,
        hasMedia: selectedMedia.length > 0,
        isScheduled: !!scheduledDate,
      });

    } catch (error) {
      console.error('Failed to create post:', error);
      Alert.alert(t('error'), t('postFailed'));
    } finally {
      setIsPosting(false);
    }
  };

  const publishPost = async (postData: PostData) => {
    const results = await Promise.allSettled(
      postData.platforms.map(platformId => 
        api.publishToSocialPlatform(platformId, {
          content: postData.content,
          media: postData.media,
          hashtags: postData.hashtags,
          mentions: postData.mentions,
        })
      )
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failureCount = results.length - successCount;

    if (failureCount > 0) {
      // Queue failed posts for retry
      const failedPlatforms = postData.platforms.filter((_, index) => 
        results[index].status === 'rejected'
      );
      
      await queuePost({
        ...postData,
        platforms: failedPlatforms,
        status: 'failed',
      });
    }

    dispatch(addContent(postData));
  };

  const schedulePost = async (postData: PostData) => {
    if (isOnline) {
      await api.schedulePost(postData);
    } else {
      // Store locally for sync when online
      const scheduledPosts = await AsyncStorage.getItem('scheduledPosts') || '[]';
      const posts = JSON.parse(scheduledPosts);
      posts.push(postData);
      await AsyncStorage.setItem('scheduledPosts', JSON.stringify(posts));
    }

    dispatch(setScheduledPosts([postData]));
  };

  const queuePost = async (postData: PostData) => {
    const queueItem: QueueItem = {
      id: Math.random().toString(),
      post: postData,
      retryCount: 0,
      nextAttempt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    };

    const updatedQueue = [...postQueue, queueItem];
    setPostQueue(updatedQueue);
    
    await AsyncStorage.setItem('postQueue', JSON.stringify(updatedQueue));
  };

  const processOfflineQueue = async () => {
    if (postQueue.length === 0) return;

    const processableItems = postQueue.filter(item => 
      new Date() >= item.nextAttempt && item.retryCount < 3
    );

    for (const item of processableItems) {
      try {
        await publishPost(item.post);
        // Remove from queue on success
        const updatedQueue = postQueue.filter(qi => qi.id !== item.id);
        setPostQueue(updatedQueue);
        await AsyncStorage.setItem('postQueue', JSON.stringify(updatedQueue));
      } catch (error) {
        // Update retry info
        item.retryCount++;
        item.nextAttempt = new Date(Date.now() + Math.pow(2, item.retryCount) * 60 * 1000);
        
        if (item.retryCount >= 3) {
          // Move to failed posts
          dispatch(updatePostStatus(item.post.id, 'failed'));
        }
      }
    }
  };

  // Bulk Operations
  const toggleBulkMode = () => {
    setBulkMode(!bulkMode);
    setSelectedPosts([]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const bulkDelete = () => {
    Alert.alert(
      t('bulkDelete'),
      t('bulkDeleteConfirmation', { count: selectedPosts.length }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await Promise.all(selectedPosts.map(postId => api.deletePost(postId)));
              setSelectedPosts([]);
              setBulkMode(false);
              analytics.track('bulk_delete', { count: selectedPosts.length });
            } catch (error) {
              Alert.alert(t('error'), t('bulkDeleteFailed'));
            }
          },
        },
      ]
    );
  };

  // Utility Functions
  const getSubscriptionLimits = () => {
    switch (subscription?.tier) {
      case 'enterprise':
        return { maxPlatforms: Infinity, maxScheduled: Infinity, aiGeneration: true };
      case 'premium':
        return { maxPlatforms: 50, maxScheduled: 100, aiGeneration: true };
      default:
        return { maxPlatforms: 5, maxScheduled: 10, aiGeneration: false };
    }
  };

  const calculateAspectRatio = (width: number, height: number): string => {
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
  };

  const resetPostForm = () => {
    setPostContent('');
    setSelectedMedia([]);
    setSelectedPlatforms([]);
    setScheduledDate(null);
    setHashtags([]);
    setMentions([]);
    setAiSuggestions([]);
  };

  const navigateToSubscription = () => {
    // Navigate to subscription screen
  };

  const loadPlatformStates = async () => {
    try {
      const states = await AsyncStorage.getItem('platformStates');
      if (states) {
        const parsed = JSON.parse(states);
        setPlatforms(current => current.map(p => ({
          ...p,
          ...parsed[p.id],
        })));
      }
    } catch (error) {
      console.error('Failed to load platform states:', error);
    }
  };

  const loadQueuedPosts = async () => {
    try {
      const queue = await AsyncStorage.getItem('postQueue');
      if (queue) {
        setPostQueue(JSON.parse(queue));
      }
    } catch (error) {
      console.error('Failed to load queued posts:', error);
    }
  };

  const syncScheduledPosts = async () => {
    try {
      const localScheduled = await AsyncStorage.getItem('scheduledPosts');
      if (localScheduled && isOnline) {
        const posts = JSON.parse(localScheduled);
        await Promise.all(posts.map((post: PostData) => api.schedulePost(post)));
        await AsyncStorage.removeItem('scheduledPosts');
      }
    } catch (error) {
      console.error('Failed to sync scheduled posts:', error);
    }
  };

  // Render Functions
  const renderPlatformCard = (platform: Platform) => (
    <TouchableOpacity
      key={platform.id}
      style={[
        styles.platformCard,
        { borderColor: platform.connected ? platform.color : theme.colors.border },
        selectedPlatforms.includes(platform.id) && styles.selectedPlatform,
      ]}
      onPress={() => {
        if (platform.connected) {
          if (selectedPlatforms.includes(platform.id)) {
            setSelectedPlatforms(selectedPlatforms.filter(id => id !== platform.id));
          } else {
            setSelectedPlatforms([...selectedPlatforms, platform.id]);
          }
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else {
          connectPlatform(platform.id);
        }
      }}
      onLongPress={() => platform.connected && disconnectPlatform(platform.id)}
    >
      <View style={styles.platformHeader}>
        <Text style={styles.platformIcon}>{platform.icon}</Text>
        <View style={styles.platformInfo}>
          <Text style={styles.platformName}>{platform.name}</Text>
          {platform.connected && platform.followers && (
            <Text style={styles.followerCount}>
              {formatNumber(platform.followers)} {t('followers')}
            </Text>
          )}
        </View>
        <View style={styles.platformActions}>
          {isConnecting === platform.id ? (
            <ActivityIndicator size="small" color={platform.color} />
          ) : (
            <View style={[
              styles.connectionStatus,
              { backgroundColor: platform.connected ? platform.color : theme.colors.border }
            ]}>
              <Icon 
                name={platform.connected ? 'check' : 'add'} 
                size={16} 
                color={platform.connected ? 'white' : theme.colors.textSecondary} 
              />
            </View>
          )}
        </View>
      </View>
      
      {platform.connected && (
        <View style={styles.platformFeatures}>
          {platform.features.slice(0, 3).map(feature => (
            <View key={feature} style={styles.featureTag}>
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );

  const renderMediaItem = (item: MediaItem) => (
    <View key={item.id} style={styles.mediaItem}>
      {item.type === 'video' ? (
        <Video
          source={{ uri: item.uri }}
          style={styles.mediaThumbnail}
          paused={true}
          resizeMode="cover"
        />
      ) : (
        <Image source={{ uri: item.uri }} style={styles.mediaThumbnail} />
      )}
      <TouchableOpacity
        style={styles.removeMediaButton}
        onPress={() => removeMedia(item.id)}
      >
        <Icon name="close" size={16} color="white" />
      </TouchableOpacity>
      {item.type === 'video' && (
        <View style={styles.videoIndicator}>
          <Icon name="play-arrow" size={20} color="white" />
        </View>
      )}
    </View>
  );

  const renderComposerTab = () => (
    <Animated.View 
      style={[
        styles.tabContent,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
      ]}
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Platform Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('selectPlatforms')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.platformList}>
              {platforms.map(renderPlatformCard)}
            </View>
          </ScrollView>
        </View>

        {/* Content Input */}
        <View style={styles.section}>
          <View style={styles.contentHeader}>
            <Text style={styles.sectionTitle}>{t('createContent')}</Text>
            {getSubscriptionLimits().aiGeneration && (
              <TouchableOpacity
                style={styles.aiButton}
                onPress={generateAIContent}
                disabled={isGeneratingAI}
              >
                {isGeneratingAI ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Icon name="auto-awesome" size={20} color={theme.colors.primary} />
                )}
                <Text style={styles.aiButtonText}>AI</Text>
              </TouchableOpacity>
            )}
          </View>
          
          <TextInput
            style={styles.contentInput}
            placeholder={t('whatsOnYourMind')}
            placeholderTextColor={theme.colors.textSecondary}
            value={postContent}
            onChangeText={setPostContent}
            multiline
            maxLength={Math.min(...selectedPlatforms.map(id => 
              platforms.find(p => p.id === id)?.characterLimit || 2200
            ))}
          />
          
          {selectedPlatforms.length > 0 && (
            <Text style={styles.characterCount}>
              {postContent.length} / {Math.min(...selectedPlatforms.map(id => 
                platforms.find(p => p.id === id)?.characterLimit || 2200
              ))}
            </Text>
          )}
        </View>

        {/* AI Suggestions */}
        {aiSuggestions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('aiSuggestions')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {aiSuggestions.map((suggestion, index) => (
                <TouchableOpacity
                  key={`suggestion-${index}`}
                  style={styles.suggestionCard}
                  onPress={() => applyAISuggestion(suggestion)}
                >
                  <Text style={styles.suggestionText}>{suggestion}</Text>
                  <Icon name="content-paste" size={16} color={theme.colors.primary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Media Selection */}
        <View style={styles.section}>
          <View style={styles.mediaHeader}>
            <Text style={styles.sectionTitle}>{t('addMedia')}</Text>
            <TouchableOpacity onPress={selectMedia}>
              <Icon name="add-photo-alternate" size={24} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>
          
          {selectedMedia.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.mediaContainer}>
                {selectedMedia.map(renderMediaItem)}
              </View>
            </ScrollView>
          ) : (
            <TouchableOpacity 
              style={styles.mediaPlaceholder}
              onPress={selectMedia}
            >
              <Icon name="cloud-upload" size={40} color={theme.colors.textSecondary} />
              <Text style={styles.mediaPlaceholderText}>{t('selectMedia')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Hashtags & Mentions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('enhancePost')}</Text>
          <View style={styles.tagContainer}>
            <TextInput
              style={styles.tagInput}
              placeholder={t('addHashtags')}
              placeholderTextColor={theme.colors.textSecondary}
              onSubmitEditing={(e) => {
                if (e.nativeEvent.text.trim()) {
                  setHashtags([...hashtags, `#${e.nativeEvent.text.trim()}`]);
                }
              }}
            />
            <TextInput
              style={styles.tagInput}
              placeholder={t('addMentions')}
              placeholderTextColor={theme.colors.textSecondary}
              onSubmitEditing={(e) => {
                if (e.nativeEvent.text.trim()) {
                  setMentions([...mentions, `@${e.nativeEvent.text.trim()}`]);
                }
              }}
            />
          </View>
          
          {(hashtags.length > 0 || mentions.length > 0) && (
            <View style={styles.tagList}>
              {hashtags.map((tag, index) => (
                <TouchableOpacity
                  key={`tag-${index}`}
                  style={styles.tagItem}
                  onPress={() => setHashtags(hashtags.filter((_, i) => i !== index))}
                >
                  <Text style={styles.tagText}>{tag}</Text>
                  <Icon name="close" size={14} color="white" />
                </TouchableOpacity>
              ))}
              {mentions.map((mention, index) => (
                <TouchableOpacity
                  key={`mention-${index}`}
                  style={[styles.tagItem, styles.mentionItem]}
                  onPress={() => setMentions(mentions.filter((_, i) => i !== index))}
                >
                  <Text style={styles.tagText}>{mention}</Text>
                  <Icon name="close" size={14} color="white" />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Scheduling */}
        <View style={styles.section}>
          <View style={styles.scheduleContainer}>
            <Text style={styles.sectionTitle}>{t('schedulePost')}</Text>
            <Switch
              value={scheduledDate !== null}
              onValueChange={(value) => {
                setScheduledDate(value ? new Date(Date.now() + 3600000) : null);
                Haptics.selectionAsync();
              }}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              thumbColor="white"
            />
          </View>
          
          {scheduledDate && (
            <TouchableOpacity
              style={styles.datePickerButton}
              onPress={() => {
                DateTimePicker.showDateTimePicker(
                  { 
                    current: scheduledDate,
                    minimumDate: new Date(),
                    maximumDate: new Date(Date.now() + 30 * 24 * 3600000)
                  },
                  (newDate) => setScheduledDate(newDate)
                );
              }}
            >
              <Icon name="calendar-today" size={20} color={theme.colors.primary} />
              <Text style={styles.dateText}>
                {formatDate(scheduledDate, 'MMM dd, yyyy - hh:mm a')}
              </Text>
              <Icon name="chevron-right" size={20} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Post Button */}
        <Button
          title={scheduledDate ? t('schedule') : t('postNow')}
          onPress={createPost}
          loading={isPosting}
          disabled={isPosting}
          style={styles.postButton}
          icon={scheduledDate ? "schedule" : "send"}
        />
      </ScrollView>
    </Animated.View>
  );

  const renderQueueTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.queueHeader}>
        <Text style={styles.sectionTitle}>{t('queuedPosts')}</Text>
        <TouchableOpacity onPress={toggleBulkMode}>
          <Text style={styles.bulkModeText}>
            {bulkMode ? t('cancel') : t('bulkEdit')}
          </Text>
        </TouchableOpacity>
      </View>

      {postQueue.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="inbox" size={60} color={theme.colors.border} />
          <Text style={styles.emptyStateText}>{t('noQueuedPosts')}</Text>
        </View>
      ) : (
        <FlatList
          data={postQueue}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.queueList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadQueuedPosts().then(() => setRefreshing(false));
              }}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.queueItem}>
              {bulkMode && (
                <TouchableOpacity
                  style={styles.bulkSelector}
                  onPress={() => {
                    const newSelected = selectedPosts.includes(item.id)
                      ? selectedPosts.filter(id => id !== item.id)
                      : [...selectedPosts, item.id];
                    setSelectedPosts(newSelected);
                    Haptics.selectionAsync();
                  }}
                >
                  <Icon 
                    name={selectedPosts.includes(item.id) ? "check-box" : "check-box-outline-blank"} 
                    size={24} 
                    color={theme.colors.primary} 
                  />
                </TouchableOpacity>
              )}
              
              <View style={styles.queueItemContent}>
                <Text style={styles.queuePlatforms}>
                  {item.post.platforms.map(id => platforms.find(p => p.id === id)?.icon).join(' ')}
                </Text>
                <Text style={styles.queueText} numberOfLines={2}>
                  {item.post.content || t('mediaPost')}
                </Text>
                <Text style={styles.queueDate}>
                  {formatDate(item.post.createdAt, 'MMM dd, yyyy - hh:mm a')}
                </Text>
                
                {item.post.status === 'failed' && (
                  <View style={styles.failedBadge}>
                    <Text style={styles.failedText}>{t('failed')}</Text>
                  </View>
                )}
              </View>
              
              <View style={styles.queueActions}>
                <TouchableOpacity onPress={() => retryQueueItem(item.id)}>
                  <Icon name="refresh" size={24} color={theme.colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteQueueItem(item.id)}>
                  <Icon name="delete" size={24} color={theme.colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {bulkMode && selectedPosts.length > 0 && (
        <View style={styles.bulkActions}>
          <Text style={styles.bulkCountText}>
            {t('selectedItems', { count: selectedPosts.length })}
          </Text>
          <TouchableOpacity 
            style={styles.bulkDeleteButton}
            onPress={bulkDelete}
          >
            <Icon name="delete-forever" size={24} color="white" />
            <Text style={styles.bulkDeleteText}>{t('delete')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderAnalyticsTab = () => (
    <View style={styles.tabContent}>
      <Text style={styles.sectionTitle}>{t('postAnalytics')}</Text>
      
      {content.filter(post => post.status === 'posted').length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="analytics" size={60} color={theme.colors.border} />
          <Text style={styles.emptyStateText}>{t('noAnalyticsData')}</Text>
        </View>
      ) : (
        <ScrollView>
          <View style={styles.analyticsSummary}>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>24.7K</Text>
              <Text style={styles.metricLabel}>{t('impressions')}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>1.2K</Text>
              <Text style={styles.metricLabel}>{t('engagements')}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>4.8%</Text>
              <Text style={styles.metricLabel}>{t('engagementRate')}</Text>
            </View>
          </View>
          
          <Text style={styles.subSectionTitle}>{t('topPerformingPosts')}</Text>
          {content
            .filter(post => post.status === 'posted')
            .sort((a, b) => (b.performance?.reach || 0) - (a.performance?.reach || 0))
            .slice(0, 5)
            .map(post => (
              <TouchableOpacity key={post.id} style={styles.postCard}>
                <View style={styles.postHeader}>
                  <Text style={styles.postPlatforms}>
                    {post.platforms.map(id => platforms.find(p => p.id === id)?.icon).join(' ')}
                  </Text>
                  <Text style={styles.postDate}>
                    {formatDate(post.createdAt, 'MMM dd')}
                  </Text>
                </View>
                <Text style={styles.postContent} numberOfLines={2}>
                  {post.content || t('mediaPost')}
                </Text>
                <View style={styles.postMetrics}>
                  <View style={styles.metricItem}>
                    <Icon name="favorite" size={16} color={theme.colors.error} />
                    <Text style={styles.metricValueSmall}>{post.performance?.likes || 0}</Text>
                  </View>
                  <View style={styles.metricItem}>
                    <Icon name="comment" size={16} color={theme.colors.primary} />
                    <Text style={styles.metricValueSmall}>{post.performance?.comments || 0}</Text>
                  </View>
                  <View style={styles.metricItem}>
                    <Icon name="share" size={16} color={theme.colors.success} />
                    <Text style={styles.metricValueSmall}>{post.performance?.shares || 0}</Text>
                  </View>
                  <View style={styles.metricItem}>
                    <Icon name="visibility" size={16} color={theme.colors.warning} />
                    <Text style={styles.metricValueSmall}>{post.performance?.reach || 0}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          }
        </ScrollView>
      )}
    </View>
  );

  const renderTabs = () => (
    <View style={styles.tabContainer}>
      <TouchableOpacity
        style={[styles.tabButton, activeTab === 'compose' && styles.activeTab]}
        onPress={() => setActiveTab('compose')}
      >
        <Icon name="create" size={20} color={activeTab === 'compose' ? theme.colors.primary : theme.colors.textSecondary} />
        <Text style={[styles.tabText, activeTab === 'compose' && styles.activeTabText]}>
          {t('compose')}
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.tabButton, activeTab === 'queue' && styles.activeTab]}
        onPress={() => setActiveTab('queue')}
      >
        <Icon name="pending-actions" size={20} color={activeTab === 'queue' ? theme.colors.primary : theme.colors.textSecondary} />
        <Text style={[styles.tabText, activeTab === 'queue' && styles.activeTabText]}>
          {t('queue')} {postQueue.length > 0 && (
            <Text style={styles.badge}>{postQueue.length}</Text>
          )}
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.tabButton, activeTab === 'analytics' && styles.activeTab]}
        onPress={() => setActiveTab('analytics')}
      >
        <Icon name="analytics" size={20} color={activeTab === 'analytics' ? theme.colors.primary : theme.colors.textSecondary} />
        <Text style={[styles.tabText, activeTab === 'analytics' && styles.activeTabText]}>
          {t('analytics')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('socialManager')}</Text>
        <TouchableOpacity onPress={() => setPreviewMode(!previewMode)}>
          <Icon 
            name={previewMode ? "visibility-off" : "visibility"} 
            size={24} 
            color={theme.colors.primary} 
          />
        </TouchableOpacity>
      </View>

      {/* Tab Navigation */}
      {renderTabs()}

      {/* Content Area */}
      <View style={styles.contentArea}>
        {activeTab === 'compose' && renderComposerTab()}
        {activeTab === 'queue' && renderQueueTab()}
        {activeTab === 'analytics' && renderAnalyticsTab()}
      </View>

      {/* Network Status Indicator */}
      {!isOnline && (
        <View style={styles.offlineBar}>
          <Icon name="signal-wifi-off" size={16} color="white" />
          <Text style={styles.offlineText}>{t('offlineMode')}</Text>
        </View>
      )}
    </View>
  );
};

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: theme.colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: theme.colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  tabText: {
    marginLeft: 8,
    color: theme.colors.textSecondary,
  },
  activeTabText: {
    color: theme.colors.primary,
    fontWeight: 'bold',
  },
  badge: {
    backgroundColor: theme.colors.error,
    color: 'white',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 12,
  },
  contentArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  tabContent: {
    flex: 1,
    padding: 16,
  },
  scrollContainer: {
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: theme.colors.textPrimary,
  },
  platformList: {
    flexDirection: 'row',
    paddingBottom: 8,
  },
  platformCard: {
    width: 180,
    marginRight: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: theme.colors.cardBackground,
  },
  selectedPlatform: {
    borderWidth: 2,
    backgroundColor: 'rgba(108, 92, 231, 0.1)',
  },
  platformHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  platformIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  platformInfo: {
    flex: 1,
  },
  platformName: {
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
  },
  followerCount: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  platformActions: {
    marginLeft: 'auto',
  },
  connectionStatus: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  platformFeatures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  featureTag: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginRight: 6,
    marginTop: 6,
  },
  featureText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  contentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(108, 92, 231, 0.1)',
  },
  aiButtonText: {
    marginLeft: 4,
    color: theme.colors.primary,
    fontWeight: '500',
  },
  contentInput: {
    minHeight: 120,
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.cardBackground,
    color: theme.colors.textPrimary,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  characterCount: {
    alignSelf: 'flex-end',
    marginTop: 4,
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  suggestionCard: {
    width: 280,
    padding: 12,
    marginRight: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  suggestionText: {
    flex: 1,
    marginRight: 8,
    color: theme.colors.textPrimary,
  },
  mediaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mediaContainer: {
    flexDirection: 'row',
  },
  mediaItem: {
    width: 100,
    height: 100,
    borderRadius: 8,
    marginRight: 8,
    overflow: 'hidden',
  },
  mediaThumbnail: {
    width: '100%',
    height: '100%',
  },
  removeMediaButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoIndicator: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 4,
  },
  mediaPlaceholder: {
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
  },
  mediaPlaceholderText: {
    marginTop: 8,
    color: theme.colors.textSecondary,
  },
  tagContainer: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  tagInput: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.cardBackground,
    color: theme.colors.textPrimary,
    marginRight: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tagList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
  },
  mentionItem: {
    backgroundColor: '#00CEC9',
  },
  tagText: {
    color: 'white',
    marginRight: 6,
  },
  scheduleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginTop: 12,
  },
  dateText: {
    flex: 1,
    marginHorizontal: 12,
    color: theme.colors.textPrimary,
  },
  postButton: {
    marginTop: 16,
  },
  queueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  bulkModeText: {
    color: theme.colors.primary,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStateText: {
    marginTop: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  queueList: {
    paddingBottom: 32,
  },
  queueItem: {
    flexDirection: 'row',
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  bulkSelector: {
    marginRight: 12,
    justifyContent: 'center',
  },
  queueItemContent: {
    flex: 1,
  },
  queuePlatforms: {
    fontSize: 20,
    marginBottom: 4,
  },
  queueText: {
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  queueDate: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  failedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.error,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
  },
  failedText: {
    color: 'white',
    fontSize: 12,
  },
  queueActions: {
    justifyContent: 'space-between',
    marginLeft: 12,
  },
  bulkActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: theme.colors.cardBackground,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  bulkCountText: {
    color: theme.colors.textPrimary,
  },
  bulkDeleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.error,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  bulkDeleteText: {
    color: 'white',
    marginLeft: 8,
    fontWeight: '500',
  },
  analyticsSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  metricCard: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    marginHorizontal: 8,
    borderRadius: 12,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
  },
  metricValueSmall: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    marginLeft: 4,
  },
  metricLabel: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
  subSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
    color: theme.colors.textPrimary,
  },
  postCard: {
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: theme.colors.cardBackground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  postPlatforms: {
    fontSize: 20,
  },
  postDate: {
    color: theme.colors.textSecondary,
  },
  postContent: {
    color: theme.colors.textPrimary,
    marginBottom: 12,
  },
  postMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  metricItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  offlineBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 8,
    backgroundColor: theme.colors.warning,
  },
  offlineText: {
    color: 'white',
    marginLeft: 8,
  },
});

export default SocialManager;