import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Dimensions,
  Animated,
  ActivityIndicator,
  Modal,
  FlatList,
  Share,
  Platform,
  Vibration,
  BackHandler,
} from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons, MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import Voice from '@react-native-voice/voice';

import { RootState } from '../store';
import { setGeneratedContent, addToHistory, updateContentStatus } from '../store/contentSlice';
import { updateUser } from '../store/userSlice';
import { ApiService } from '../services/api';
import { AnalyticsService } from '../services/analytics';
import { StorageService } from '../services/storage';
import { CacheService } from '../services/cache';
import { EncryptionService } from '../services/encryption';
import { I18nService } from '../utils/i18n';
import { validateInput, sanitizeHtml, generateUUID, formatDate } from '../utils/helpers';
import { AppTheme } from '../utils/theme';
import { CONTENT_LIMITS, PLATFORMS, AI_MODELS, CONTENT_TYPES } from '../utils/constants';

const { width, height } = Dimensions.get('window');

interface ContentTemplate {
  id: string;
  name: string;
  prompt: string;
  platforms: string[];
  category: string;
  trending: boolean;
  offline: boolean;
}

interface GeneratedContent {
  id: string;
  content: string;
  platform: string;
  timestamp: number;
  status: 'draft' | 'scheduled' | 'published';
  engagement: number;
  metadata: {
    tone: string;
    length: number;
    hashtags: string[];
    mentions: string[];
  };
}

interface VoiceNote {
  id: string;
  uri: string;
  duration: number;
  timestamp: number;
  transcription?: string;
}

const ContentStudio: React.FC = () => {
  const dispatch = useDispatch();
  const { user, subscription } = useSelector((state: RootState) => state.user);
  const { generatedContent, history, isGenerating } = useSelector((state: RootState) => state.content);
  const theme = useSelector((state: RootState) => state.theme);

  // Core state
  const [prompt, setPrompt] = useState<string>('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['instagram', 'tiktok']);
  const [selectedTone, setSelectedTone] = useState<string>('professional');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
  
  // UI state
  const [activeTab, setActiveTab] = useState<'generate' | 'templates' | 'history'>('generate');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [selectedContent, setSelectedContent] = useState<GeneratedContent | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  // Offline state
  const [offlineTemplates, setOfflineTemplates] = useState<ContentTemplate[]>([]);
  const [offlineContent, setOfflineContent] = useState<GeneratedContent[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(height)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const recordingAnim = useRef(new Animated.Value(0)).current;

  // Services
  const apiService = new ApiService();
  const analyticsService = new AnalyticsService();
  const storageService = new StorageService();
  const cacheService = new CacheService();
  const encryptionService = new EncryptionService();
  const i18n = new I18nService();

  // Subscription limits
  const limits = useMemo(() => {
    const tier = subscription?.tier || 'freemium';
    return CONTENT_LIMITS[tier] || CONTENT_LIMITS.freemium;
  }, [subscription]);

  // Voice recognition setup
  useEffect(() => {
    Voice.onSpeechStart = onSpeechStart;
    Voice.onSpeechEnd = onSpeechEnd;
    Voice.onSpeechResults = onSpeechResults;
    Voice.onSpeechError = onSpeechError;

    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []);

  // Network monitoring
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? false);
      if (state.isConnected && pendingRequests.length > 0) {
        processPendingRequests();
      }
    });

    return unsubscribe;
  }, [pendingRequests]);

  // Load offline data
  useEffect(() => {
    loadOfflineData();
    setupAnimations();
  }, []);

  // Back handler for modal
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showPreview || showTemplateModal) {
        setShowPreview(false);
        setShowTemplateModal(false);
        return true;
      }
      return false;
    });

    return () => backHandler.remove();
  }, [showPreview, showTemplateModal]);

  const setupAnimations = () => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();

    // Pulse animation for recording
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );

    if (isRecording) {
      pulseLoop.start();
    } else {
      pulseLoop.stop();
    }
  };

  const loadOfflineData = async () => {
    try {
      const [templates, content, voices] = await Promise.all([
        storageService.getItem('offline_templates'),
        storageService.getItem('offline_content'),
        storageService.getItem('voice_notes'),
      ]);

      if (templates) setOfflineTemplates(JSON.parse(templates));
      if (content) setOfflineContent(JSON.parse(content));
      if (voices) setVoiceNotes(JSON.parse(voices));
    } catch (error) {
      console.error('Failed to load offline data:', error);
    }
  };

  const saveOfflineData = async () => {
    try {
      await Promise.all([
        storageService.setItem('offline_templates', JSON.stringify(offlineTemplates)),
        storageService.setItem('offline_content', JSON.stringify(offlineContent)),
        storageService.setItem('voice_notes', JSON.stringify(voiceNotes)),
      ]);
    } catch (error) {
      console.error('Failed to save offline data:', error);
    }
  };

  const processPendingRequests = async () => {
    if (!isOnline || pendingRequests.length === 0) return;

    try {
      const processed = await Promise.allSettled(
        pendingRequests.map(request => apiService.generateContent(request))
      );

      processed.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const content = result.value;
          dispatch(setGeneratedContent(content));
          dispatch(addToHistory(content));
        }
      });

      setPendingRequests([]);
      await storageService.removeItem('pending_requests');
    } catch (error) {
      console.error('Failed to process pending requests:', error);
    }
  };

  const generateContent = async () => {
    if (!validateInput(prompt)) {
      Alert.alert(i18n.t('error'), i18n.t('invalid_prompt'));
      return;
    }

    if (user?.usage?.content_generated >= limits.monthlyGeneration) {
      Alert.alert(i18n.t('limit_reached'), i18n.t('upgrade_required'));
      return;
    }

    const requestId = generateUUID();
    const requestData = {
      id: requestId,
      prompt: sanitizeHtml(prompt),
      platforms: selectedPlatforms,
      tone: selectedTone,
      language: selectedLanguage,
      userId: user?.id,
      timestamp: Date.now(),
    };

    // Haptic feedback
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      Vibration.vibrate(50);
    }

    dispatch(updateContentStatus({ id: requestId, status: 'generating' }));

    try {
      if (isOnline) {
        const content = await apiService.generateContent(requestData);
        dispatch(setGeneratedContent(content));
        dispatch(addToHistory(content));
        
        // Update user usage
        dispatch(updateUser({
          usage: {
            ...user?.usage,
            content_generated: (user?.usage?.content_generated || 0) + 1,
          }
        }));

        // Cache for offline use
        await cacheService.setItem(`content_${requestId}`, content);
        
        // Analytics
        analyticsService.track('content_generated', {
          platforms: selectedPlatforms,
          tone: selectedTone,
          language: selectedLanguage,
          success: true,
        });

        setPrompt('');
        setShowPreview(true);
        setSelectedContent(content);
      } else {
        // Offline mode - add to pending requests
        setPendingRequests(prev => [...prev, requestData]);
        await storageService.setItem('pending_requests', JSON.stringify([...pendingRequests, requestData]));
        
        // Generate offline content using templates
        const offlineContent = generateOfflineContent(requestData);
        setOfflineContent(prev => [...prev, offlineContent]);
        
        Alert.alert(
          i18n.t('offline_mode'),
          i18n.t('content_will_process_online')
        );
      }
    } catch (error) {
      console.error('Content generation failed:', error);
      Alert.alert(i18n.t('error'), i18n.t('generation_failed'));
      
      analyticsService.track('content_generation_failed', {
        error: error.message,
        platforms: selectedPlatforms,
      });
    } finally {
      dispatch(updateContentStatus({ id: requestId, status: 'completed' }));
    }
  };

  const generateOfflineContent = (requestData: any): GeneratedContent => {
    // Simple offline content generation using templates
    const template = offlineTemplates.find(t => 
      t.category === 'general' || t.platforms.some(p => selectedPlatforms.includes(p))
    );

    const content = template 
      ? template.prompt.replace('{prompt}', requestData.prompt)
      : `${requestData.prompt}\n\n#${selectedPlatforms.join(' #')}`;

    return {
      id: requestData.id,
      content,
      platform: selectedPlatforms[0],
      timestamp: requestData.timestamp,
      status: 'draft',
      engagement: 0,
      metadata: {
        tone: requestData.tone,
        length: content.length,
        hashtags: extractHashtags(content),
        mentions: extractMentions(content),
      },
    };
  };

  const extractHashtags = (text: string): string[] => {
    return text.match(/#[\w]+/g) || [];
  };

  const extractMentions = (text: string): string[] => {
    return text.match(/@[\w]+/g) || [];
  };

  // Voice recording functions
  const onSpeechStart = () => {
    console.log('Speech started');
  };

  const onSpeechEnd = () => {
    setIsRecording(false);
  };

  const onSpeechResults = (event: any) => {
    const result = event.value[0];
    setPrompt(prev => prev + ' ' + result);
  };

  const onSpeechError = (event: any) => {
    console.error('Speech error:', event.error);
    setIsRecording(false);
  };

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert(i18n.t('permission_required'), i18n.t('microphone_permission'));
        return;
      }

      setIsRecording(true);
      await Voice.start(selectedLanguage);
      
      // Start visual feedback
      Animated.loop(
        Animated.sequence([
          Animated.timing(recordingAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(recordingAnim, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } catch (error) {
      console.error('Recording failed:', error);
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    try {
      await Voice.stop();
      setIsRecording(false);
      recordingAnim.setValue(0);
    } catch (error) {
      console.error('Stop recording failed:', error);
    }
  };

  const selectImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled) {
        const imagePrompt = i18n.t('describe_image_prompt');
        setPrompt(prev => `${prev}\n\n${imagePrompt}`);
        
        // Store image for processing
        const imageId = generateUUID();
        await storageService.setItem(`image_${imageId}`, result.assets[0].uri);
      }
    } catch (error) {
      console.error('Image selection failed:', error);
    }
  };

  const shareContent = async (content: GeneratedContent) => {
    try {
      await Share.share({
        message: content.content,
        title: i18n.t('generated_content'),
      });

      analyticsService.track('content_shared', {
        platform: content.platform,
        content_length: content.content.length,
      });
    } catch (error) {
      console.error('Sharing failed:', error);
    }
  };

  const copyToClipboard = async (content: string) => {
    try {
      await storageService.setItem('clipboard', content);
      Alert.alert(i18n.t('success'), i18n.t('copied_to_clipboard'));
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  const renderPlatformSelector = () => (
    <View style={[styles.section, { backgroundColor: theme.cardBackground }]}>
      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
        {i18n.t('select_platforms')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {PLATFORMS.map(platform => (
          <TouchableOpacity
            key={platform.id}
            style={[
              styles.platformButton,
              selectedPlatforms.includes(platform.id) && styles.platformButtonActive,
              { borderColor: theme.border }
            ]}
            onPress={() => {
              const isSelected = selectedPlatforms.includes(platform.id);
              if (isSelected) {
                setSelectedPlatforms(prev => prev.filter(p => p !== platform.id));
              } else if (selectedPlatforms.length < limits.maxPlatforms) {
                setSelectedPlatforms(prev => [...prev, platform.id]);
              } else {
                Alert.alert(i18n.t('limit_reached'), i18n.t('platform_limit_message'));
              }
            }}
          >
            <Ionicons 
              name={platform.icon} 
              size={20} 
              color={selectedPlatforms.includes(platform.id) ? '#FFFFFF' : theme.textSecondary} 
            />
            <Text style={[
              styles.platformText,
              { color: selectedPlatforms.includes(platform.id) ? '#FFFFFF' : theme.textSecondary }
            ]}>
              {platform.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const renderContentInput = () => (
    <View style={[styles.section, { backgroundColor: theme.cardBackground }]}>
      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
        {i18n.t('content_prompt')}
      </Text>
      <View style={styles.inputContainer}>
        <TextInput
          style={[styles.textInput, { 
            color: theme.textPrimary, 
            borderColor: theme.border,
            backgroundColor: theme.background 
          }]}
          placeholder={i18n.t('enter_content_idea')}
          placeholderTextColor={theme.textMuted}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          maxLength={limits.maxPromptLength}
          textAlignVertical="top"
        />
        <View style={styles.inputActions}>
          <TouchableOpacity
            style={[styles.actionButton, isRecording && styles.actionButtonActive]}
            onPress={isRecording ? stopRecording : startRecording}
          >
            <Animated.View
              style={[
                { transform: [{ scale: isRecording ? recordingAnim : 1 }] }
              ]}
            >
              <Ionicons 
                name={isRecording ? "stop" : "mic"} 
                size={20} 
                color={isRecording ? "#FFFFFF" : theme.primary} 
              />
            </Animated.View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={selectImage}>
            <Ionicons name="image" size={20} color={theme.primary} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={() => setShowTemplateModal(true)}
          >
            <MaterialIcons name="template-icon" size={20} color={theme.primary} />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={[styles.charCount, { color: theme.textMuted }]}>
        {prompt.length}/{limits.maxPromptLength}
      </Text>
    </View>
  );

  const renderAdvancedOptions = () => {
    if (!showAdvanced) return null;

    return (
      <Animated.View style={[
        styles.section, 
        { backgroundColor: theme.cardBackground, opacity: fadeAnim }
      ]}>
        <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
          {i18n.t('advanced_options')}
        </Text>
        
        {/* Tone Selector */}
        <View style={styles.optionGroup}>
          <Text style={[styles.optionLabel, { color: theme.textSecondary }]}>
            {i18n.t('tone')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {['professional', 'casual', 'humorous', 'inspiring', 'educational'].map(tone => (
              <TouchableOpacity
                key={tone}
                style={[
                  styles.optionButton,
                  selectedTone === tone && styles.optionButtonActive,
                  { borderColor: theme.border }
                ]}
                onPress={() => setSelectedTone(tone)}
              >
                <Text style={[
                  styles.optionText,
                  { color: selectedTone === tone ? '#FFFFFF' : theme.textSecondary }
                ]}>
                  {i18n.t(tone)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Language Selector */}
        <View style={styles.optionGroup}>
          <Text style={[styles.optionLabel, { color: theme.textSecondary }]}>
            {i18n.t('language')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {limits.languages.map(lang => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.optionButton,
                  selectedLanguage === lang.code && styles.optionButtonActive,
                  { borderColor: theme.border }
                ]}
                onPress={() => setSelectedLanguage(lang.code)}
              >
                <Text style={[
                  styles.optionText,
                  { color: selectedLanguage === lang.code ? '#FFFFFF' : theme.textSecondary }
                ]}>
                  {lang.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Animated.View>
    );
  };

  const renderGenerateButton = () => (
    <TouchableOpacity
      style={[
        styles.generateButton,
        { backgroundColor: theme.primary },
        (!prompt || selectedPlatforms.length === 0) && styles.generateButtonDisabled
      ]}
      onPress={generateContent}
      disabled={!prompt || selectedPlatforms.length === 0 || isGenerating}
    >
      {isGenerating ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <>
          <Ionicons name="flash" size={20} color="#FFFFFF" />
          <Text style={styles.generateButtonText}>
            {i18n.t('generate_content')}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );

  const renderContentPreview = () => (
    <Modal
      visible={showPreview}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowPreview(false)}
    >
      <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setShowPreview(false)}>
            <Ionicons name="close" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
            {i18n.t('content_preview')}
          </Text>
          <TouchableOpacity onPress={() => shareContent(selectedContent!)}>
            <Ionicons name="share" size={24} color={theme.primary} />
          </TouchableOpacity>
        </View>

        {selectedContent && (
          <ScrollView style={styles.previewContent}>
            <View style={[styles.contentCard, { backgroundColor: theme.cardBackground }]}>
              <Text style={[styles.contentText, { color: theme.textPrimary }]}>
                {selectedContent.content}
              </Text>
              
              <View style={styles.contentMeta}>
                <View style={styles.metaItem}>
                  <Ionicons name="time" size={16} color={theme.textMuted} />
                  <Text style={[styles.metaText, { color: theme.textMuted }]}>
                    {formatDate(selectedContent.timestamp)}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Ionicons name="text" size={16} color={theme.textMuted} />
                  <Text style={[styles.metaText, { color: theme.textMuted }]}>
                    {selectedContent.metadata.length} {i18n.t('characters')}
                  </Text>
                </View>
              </View>

              {selectedContent.metadata.hashtags.length > 0 && (
                <View style={styles.hashtagContainer}>
                  {selectedContent.metadata.hashtags.map((tag, index) => (
                    <Text key={index} style={[styles.hashtag, { color: theme.primary }]}>
                      {tag}
                    </Text>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButtonLarge, { backgroundColor: theme.primary }]}
                onPress={() => copyToClipboard(selectedContent.content)}
              >
                <Ionicons name="copy" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>{i18n.t('copy')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.actionButtonLarge, { backgroundColor: theme.success }]}
                onPress={() => {
                  // Navigate to social manager
                  setShowPreview(false);
                  // navigation.navigate('SocialManager', { content: selectedContent });
                }}
              >
                <Ionicons name="send" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>{i18n.t('post_now')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );

  const renderOfflineIndicator = () => {
    if (isOnline) return null;

    return (
      <View style={[styles.offlineIndicator, { backgroundColor: theme.warning }]}>
        <Ionicons name="cloud-offline" size={16} color="#FFFFFF" />
        <Text style={styles.offlineText}>{i18n.t('offline_mode')}</Text>
      </View>
    );
  };

  const renderUsageIndicator = () => (
    <View style={[styles.usageIndicator, { backgroundColor: theme.cardBackground }]}>
      <View style={styles.usageHeader}>
        <Text style={[styles.usageTitle, { color: theme.textPrimary }]}>
          {i18n.t('monthly_usage')}
        </Text>
        <Text style={[styles.usageCount, { color: theme.primary }]}>
          {user?.usage?.content_generated || 0}/{limits.monthlyGeneration}
        </Text>
      </View>
      <View style={[styles.usageBar, { backgroundColor: theme.border }]}>
        <View 
          style={[
            styles.usageProgress,
            { 
              backgroundColor: theme.primary,
              width: `${Math.min(((user?.usage?.content_generated || 0) / limits.monthlyGeneration) * 100, 100)}%`
            }
          ]} 
        />
      </View>
    </View>
  );

  return (
    <Animated.View style={[styles.container, { backgroundColor: theme.background, opacity: fadeAnim }]}>
      {renderOfflineIndicator()}
      
      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderUsageIndicator()}
        {renderPlatformSelector()}
        {renderContentInput()}
        
        <TouchableOpacity
          style={styles.advancedToggle}
          onPress={() => setShowAdvanced(!showAdvanced)}
        >
          <Text style={[styles.advancedToggleText, { color: theme.primary }]}>
            {i18n.t('advanced_options')}
          </Text>
          <Ionicons 
            name={showAdvanced ? "chevron-up" : "chevron-down"} 
            size={20} 
            color={theme.primary} 
          />
        </TouchableOpacity>

        {renderAdvancedOptions()}
        {renderGenerateButton()}
      </ScrollView>

      {renderContentPreview()}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  offlineIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  offlineText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
  },
  usageIndicator: {
    marginVertical: 16,
    padding: 16,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  usageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  usageTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  usageCount: {
    fontSize: 14,
    fontWeight: '700',
  },
  usageBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  usageProgress: {
    height: '100%',
    borderRadius: 2,
  },
  section: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  platformButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 8,
  },
  platformButtonActive: {
    backgroundColor: '#6C5CE7',
  },
  platformText: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '500',
  },
  inputContainer: {
    position: 'relative',
  },
  textInput: {
    height: 150,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  inputActions: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    elevation: 1,
  },
  actionButtonActive: {
    backgroundColor: '#6C5CE7',
  },
  charCount: {
    textAlign: 'right',
    fontSize: 12,
    marginTop: 4,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  advancedToggleText: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 4,
  },
  optionGroup: {
    marginBottom: 12,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  optionButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 8,
  },
  optionButtonActive: {
    backgroundColor: '#6C5CE7',
  },
  optionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  generateButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginVertical: 24,
    elevation: 2,
  },
  generateButtonDisabled: {
    opacity: 0.6,
  },
  generateButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  modalContainer: {
    flex: 1,
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  previewContent: {
    flex: 1,
    padding: 16,
  },
  contentCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  contentText: {
    fontSize: 16,
    lineHeight: 24,
  },
  contentMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E9ECEF',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    fontSize: 12,
    marginLeft: 4,
  },
  hashtagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  hashtag: {
    marginRight: 8,
    marginBottom: 4,
    fontSize: 14,
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButtonLarge: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 8,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});

export default ContentStudio;