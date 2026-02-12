import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Dimensions,
  Alert,
  Image,
  Switch,
  Modal,
  ActivityIndicator,
  Animated,
  PanResponder,
  Share,
  Vibration,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LinearGradient from 'react-native-linear-gradient';
import { BlurView } from '@react-native-community/blur';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Slider from '@react-native-community/slider';
import { RootState } from '../store';
import { apiService } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useI18n } from '../hooks/useI18n';
import { showToast } from '../utils/toast';
import { hapticFeedback } from '../utils/haptics';
import { generateUniqueId } from '../utils/helpers';
import { encryptData, decryptData } from '../utils/encryption';
import { validateInput } from '../utils/validation';
import { optimizeImage, compressImage } from '../utils/imageUtils';
import { AudioRecorder } from '../components/AudioRecorder';
import { VoiceCloner } from '../components/VoiceCloner';
import { FaceEditor } from '../components/FaceEditor';

const { width, height } = Dimensions.get('window');

interface AIInfluencer {
  id: string;
  name: string;
  age: number;
  gender: 'male' | 'female' | 'non-binary';
  ethnicity: string;
  personality: string[];
  niche: string;
  faceData: string;
  voiceData: string;
  style: string;
  backstory: string;
  socialHandles: Record<string, string>;
  metrics: {
    engagement: number;
    authenticity: number;
    controversy: number;
  };
  avatar: string;
  isActive: boolean;
  createdAt: Date;
  lastUpdated: Date;
  offlineMode: boolean;
}

interface PersonalityTrait {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

interface Niche {
  id: string;
  name: string;
  description: string;
  tags: string[];
  icon: string;
  popularity: number;
}

const OFFLINE_STORAGE_KEY = 'ai_influencers_offline';
const PERSONALITY_TRAITS_KEY = 'personality_traits_cache';
const NICHES_CACHE_KEY = 'niches_cache';

export const InfluencerLab: React.FC = () => {
  const dispatch = useDispatch();
  const { user, subscription } = useSelector((state: RootState) => state.auth);
  const { theme, isDarkMode } = useTheme();
  const { t, currentLanguage } = useI18n();
  const { isOnline } = useAuth();

  // Core State
  const [influencers, setInfluencers] = useState<AIInfluencer[]>([]);
  const [currentInfluencer, setCurrentInfluencer] = useState<Partial<AIInfluencer> | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);

  // UI State
  const [modalVisible, setModalVisible] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  // Form State
  const [personalityTraits, setPersonalityTraits] = useState<PersonalityTrait[]>([]);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [selectedTraits, setSelectedTraits] = useState<string[]>([]);
  const [faceParameters, setFaceParameters] = useState({
    symmetry: 0.8,
    attractiveness: 0.7,
    age: 25,
    expression: 0.5,
  });

  // Animation Values
  const fadeAnim = useState(new Animated.Value(0))[0];
  const slideAnim = useState(new Animated.Value(height))[0];
  const scaleAnim = useState(new Animated.Value(0.8))[0];

  // Pan Responder for swipe gestures
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => {
      return Math.abs(gestureState.dx) > 20 || Math.abs(gestureState.dy) > 20;
    },
    onPanResponderGrant: () => {
      hapticFeedback('light');
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dy > 100) {
        closeModal();
      }
    },
  });

  // Initialize Component
  useEffect(() => {
    initializeComponent();
    loadOfflineData();
    return () => {
      // Cleanup animations
      fadeAnim.setValue(0);
      slideAnim.setValue(height);
    };
  }, []);

  // Auto-save offline data
  useEffect(() => {
    if (influencers.length > 0) {
      saveOfflineData();
    }
  }, [influencers]);

  // Theme change handler
  useEffect(() => {
    animateThemeChange();
  }, [isDarkMode]);

  const initializeComponent = async () => {
    try {
      setLoading(true);
      await Promise.all([
        loadInfluencers(),
        loadPersonalityTraits(),
        loadNiches(),
      ]);
    } catch (error) {
      console.error('Failed to initialize InfluencerLab:', error);
      showToast(t('errors.initializationFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadInfluencers = async () => {
    try {
      if (isOnline) {
        const response = await apiService.getInfluencers();
        setInfluencers(response.data);
        await saveOfflineData();
      } else {
        await loadOfflineData();
      }
    } catch (error) {
      console.error('Failed to load influencers:', error);
      await loadOfflineData();
    }
  };

  const loadPersonalityTraits = async () => {
    try {
      const cached = await AsyncStorage.getItem(PERSONALITY_TRAITS_KEY);
      if (cached) {
        setPersonalityTraits(JSON.parse(cached));
      }

      if (isOnline) {
        const response = await apiService.getPersonalityTraits();
        setPersonalityTraits(response.data);
        await AsyncStorage.setItem(PERSONALITY_TRAITS_KEY, JSON.stringify(response.data));
      }
    } catch (error) {
      console.error('Failed to load personality traits:', error);
      // Fallback to default traits
      setPersonalityTraits(getDefaultPersonalityTraits());
    }
  };

  const loadNiches = async () => {
    try {
      const cached = await AsyncStorage.getItem(NICHES_CACHE_KEY);
      if (cached) {
        setNiches(JSON.parse(cached));
      }

      if (isOnline) {
        const response = await apiService.getNiches();
        setNiches(response.data);
        await AsyncStorage.setItem(NICHES_CACHE_KEY, JSON.stringify(response.data));
      }
    } catch (error) {
      console.error('Failed to load niches:', error);
      setNiches(getDefaultNiches());
    }
  };

  const saveOfflineData = async () => {
    try {
      const encryptedData = await encryptData(JSON.stringify(influencers));
      await AsyncStorage.setItem(OFFLINE_STORAGE_KEY, encryptedData);
    } catch (error) {
      console.error('Failed to save offline data:', error);
    }
  };

  const loadOfflineData = async () => {
    try {
      const encryptedData = await AsyncStorage.getItem(OFFLINE_STORAGE_KEY);
      if (encryptedData) {
        const decryptedData = await decryptData(encryptedData);
        const offlineInfluencers = JSON.parse(decryptedData);
        setInfluencers(offlineInfluencers);
      }
    } catch (error) {
      console.error('Failed to load offline data:', error);
    }
  };

  const createInfluencer = useCallback(async () => {
    if (!currentInfluencer?.name || !currentInfluencer?.niche) {
      showToast(t('errors.requiredFields'), 'error');
      return;
    }

    if (!canCreateInfluencer()) {
      showSubscriptionModal();
      return;
    }

    try {
      setLoading(true);
      hapticFeedback('medium');

      const newInfluencer: AIInfluencer = {
        id: generateUniqueId(),
        name: currentInfluencer.name,
        age: currentInfluencer.age || 25,
        gender: currentInfluencer.gender || 'non-binary',
        ethnicity: currentInfluencer.ethnicity || 'diverse',
        personality: selectedTraits,
        niche: currentInfluencer.niche || '',
        faceData: await generateFaceData(),
        voiceData: await generateVoiceData(),
        style: currentInfluencer.style || 'casual',
        backstory: currentInfluencer.backstory || '',
        socialHandles: {},
        metrics: {
          engagement: Math.random() * 0.4 + 0.6,
          authenticity: Math.random() * 0.3 + 0.7,
          controversy: Math.random() * 0.2,
        },
        avatar: await generateAvatar(),
        isActive: true,
        createdAt: new Date(),
        lastUpdated: new Date(),
        offlineMode: !isOnline,
      };

      if (isOnline) {
        await apiService.createInfluencer(newInfluencer);
      }

      setInfluencers(prev => [...prev, newInfluencer]);
      setCurrentInfluencer(null);
      setModalVisible(false);
      showToast(t('success.influencerCreated'), 'success');
    } catch (error) {
      console.error('Failed to create influencer:', error);
      showToast(t('errors.creationFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [currentInfluencer, selectedTraits, isOnline]);

  const canCreateInfluencer = () => {
    const limits = {
      freemium: 1,
      premium: 3,
      enterprise: Infinity,
    };
    return influencers.length < limits[subscription.tier];
  };

  const generateFaceData = async () => {
    // Offline face generation using predefined parameters
    const faceConfig = {
      symmetry: faceParameters.symmetry,
      attractiveness: faceParameters.attractiveness,
      age: faceParameters.age,
      expression: faceParameters.expression,
      ethnicity: currentInfluencer?.ethnicity,
      gender: currentInfluencer?.gender,
    };

    if (isOnline) {
      try {
        const response = await apiService.generateFace(faceConfig);
        return response.data.faceData;
      } catch (error) {
        console.error('Online face generation failed, using offline:', error);
      }
    }

    // Offline fallback - generate deterministic face data
    return JSON.stringify({
      ...faceConfig,
      seed: generateSeed(currentInfluencer?.name || ''),
      timestamp: Date.now(),
    });
  };

  const generateVoiceData = async () => {
    const voiceConfig = {
      gender: currentInfluencer?.gender,
      age: currentInfluencer?.age,
      personality: selectedTraits,
      accent: currentLanguage,
    };

    if (isOnline) {
      try {
        const response = await apiService.generateVoice(voiceConfig);
        return response.data.voiceData;
      } catch (error) {
        console.error('Online voice generation failed, using offline:', error);
      }
    }

    return JSON.stringify({
      ...voiceConfig,
      seed: generateSeed(currentInfluencer?.name || ''),
      timestamp: Date.now(),
    });
  };

  const generateAvatar = async () => {
    if (isOnline) {
      try {
        const response = await apiService.generateAvatar({
          name: currentInfluencer?.name,
          style: currentInfluencer?.style,
          faceData: await generateFaceData(),
        });
        return response.data.avatarUrl;
      } catch (error) {
        console.error('Avatar generation failed:', error);
      }
    }

    // Offline avatar generation using initials
    const initials = (currentInfluencer?.name || 'AI')
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase();
    
    return `data:image/svg+xml,${encodeURIComponent(generateSVGAvatar(initials))}`;
  };

  const generateSeed = (input: string) => {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  };

  const generateSVGAvatar = (initials: string) => {
    const colors = ['#6C5CE7', '#00CEC9', '#FD79A8', '#FDCB6E', '#E17055'];
    const bgColor = colors[Math.abs(generateSeed(initials)) % colors.length];
    
    return `
      <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="50" fill="${bgColor}"/>
        <text x="50" y="50" text-anchor="middle" dy="0.35em" 
              font-family="Arial, sans-serif" font-size="24" 
              font-weight="bold" fill="white">${initials}</text>
      </svg>
    `;
  };

  const animateThemeChange = () => {
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const openModal = () => {
    setModalVisible(true);
    setCurrentInfluencer({});
    setSelectedTraits([]);
    setStep(0);
    
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 65,
        friction: 10,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 100,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const closeModal = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: height,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setModalVisible(false);
      setCurrentInfluencer(null);
      setSelectedTraits([]);
    });
  };

  const deleteInfluencer = async (id: string) => {
    Alert.alert(
      t('dialogs.confirmDelete'),
      t('dialogs.deleteInfluencerMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              if (isOnline) {
                await apiService.deleteInfluencer(id);
              }
              setInfluencers(prev => prev.filter(inf => inf.id !== id));
              hapticFeedback('heavy');
              showToast(t('success.influencerDeleted'), 'success');
            } catch (error) {
              console.error('Failed to delete influencer:', error);
              showToast(t('errors.deleteFailed'), 'error');
            }
          },
        },
      ]
    );
  };

  const shareInfluencer = async (influencer: AIInfluencer) => {
    try {
      const shareContent = {
        message: t('share.influencerMessage', { name: influencer.name }),
        url: `https://onxlink.app/influencer/${influencer.id}`,
        title: t('share.influencerTitle'),
      };
      
      await Share.share(shareContent);
      hapticFeedback('light');
    } catch (error) {
      console.error('Failed to share influencer:', error);
    }
  };

  const filteredInfluencers = useMemo(() => {
    return influencers.filter(inf =>
      inf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inf.niche.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [influencers, searchQuery]);

  const showSubscriptionModal = () => {
    Alert.alert(
      t('subscription.limitReached'),
      t('subscription.upgradeMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('subscription.upgrade'),
          onPress: () => {
            // Navigate to subscription screen
          },
        },
      ]
    );
  };

  const getDefaultPersonalityTraits = (): PersonalityTrait[] => [
    {
      id: '1',
      name: t('personality.creative'),
      description: t('personality.creativeDesc'),
      icon: 'palette',
      color: '#FD79A8',
    },
    {
      id: '2',
      name: t('personality.analytical'),
      description: t('personality.analyticalDesc'),
      icon: 'analytics',
      color: '#00CEC9',
    },
    {
      id: '3',
      name: t('personality.humorous'),
      description: t('personality.humorousDesc'),
      icon: 'mood',
      color: '#FDCB6E',
    },
    {
      id: '4',
      name: t('personality.motivational'),
      description: t('personality.motivationalDesc'),
      icon: 'trending-up',
      color: '#6C5CE7',
    },
  ];

  const getDefaultNiches = (): Niche[] => [
    {
      id: '1',
      name: t('niches.lifestyle'),
      description: t('niches.lifestyleDesc'),
      tags: ['fashion', 'travel', 'food'],
      icon: 'favorite',
      popularity: 0.8,
    },
    {
      id: '2',
      name: t('niches.tech'),
      description: t('niches.techDesc'),
      tags: ['gadgets', 'software', 'innovation'],
      icon: 'computer',
      popularity: 0.7,
    },
    {
      id: '3',
      name: t('niches.fitness'),
      description: t('niches.fitnessDesc'),
      tags: ['workout', 'nutrition', 'wellness'],
      icon: 'fitness-center',
      popularity: 0.9,
    },
  ];

  const renderInfluencerCard = ({ item }: { item: AIInfluencer }) => (
    <Animated.View style={[styles.influencerCard, { opacity: fadeAnim }]}>
      <LinearGradient
        colors={[theme.colors.surface, theme.colors.background]}
        style={styles.cardGradient}
      >
        <View style={styles.cardHeader}>
          <Image source={{ uri: item.avatar }} style={styles.avatar} />
          <View style={styles.cardInfo}>
            <Text style={[styles.influencerName, { color: theme.colors.text }]}>
              {item.name}
            </Text>
            <Text style={[styles.influencerNiche, { color: theme.colors.textSecondary }]}>
              {item.niche}
            </Text>
            <View style={styles.metricsRow}>
              <View style={styles.metric}>
                <Icon name="favorite" size={12} color="#E17055" />
                <Text style={[styles.metricText, { color: theme.colors.textSecondary }]}>
                  {Math.round(item.metrics.engagement * 100)}%
                </Text>
              </View>
              <View style={styles.metric}>
                <Icon name="verified" size={12} color="#00CEC9" />
                <Text style={[styles.metricText, { color: theme.colors.textSecondary }]}>
                  {Math.round(item.metrics.authenticity * 100)}%
                </Text>
              </View>
            </View>
          </View>
          <Switch
            value={item.isActive}
            onValueChange={(value) => toggleInfluencerStatus(item.id, value)}
            trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
            thumbColor={item.isActive ? theme.colors.background : theme.colors.surface}
          />
        </View>

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.colors.primary + '20' }]}
            onPress={() => editInfluencer(item)}
          >
            <Icon name="edit" size={16} color={theme.colors.primary} />
            <Text style={[styles.actionText, { color: theme.colors.primary }]}>
              {t('common.edit')}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.colors.accent + '20' }]}
            onPress={() => shareInfluencer(item)}
          >
            <Icon name="share" size={16} color={theme.colors.accent} />
            <Text style={[styles.actionText, { color: theme.colors.accent }]}>
              {t('common.share')}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#E17055' + '20' }]}
            onPress={() => deleteInfluencer(item.id)}
          >
            <Icon name="delete" size={16} color="#E17055" />
            <Text style={[styles.actionText, { color: '#E17055' }]}>
              {t('common.delete')}
            </Text>
          </TouchableOpacity>
        </View>

        {!isOnline && (
          <View style={styles.offlineIndicator}>
            <Icon name="offline-bolt" size={12} color={theme.colors.warning} />
            <Text style={[styles.offlineText, { color: theme.colors.warning }]}>
              {t('common.offline')}
            </Text>
          </View>
        )}
      </LinearGradient>
    </Animated.View>
  );

  const renderPersonalitySelector = () => (
    <View style={styles.selectorContainer}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
        {t('influencer.personality')}
      </Text>
      <View style={styles.traitsGrid}>
        {personalityTraits.map((trait) => (
          <TouchableOpacity
            key={trait.id}
            style={[
              styles.traitCard,
              {
                backgroundColor: selectedTraits.includes(trait.id)
                  ? trait.color + '30'
                  : theme.colors.surface,
                borderColor: selectedTraits.includes(trait.id)
                  ? trait.color
                  : theme.colors.border,
              },
            ]}
            onPress={() => {
              setSelectedTraits(prev =>
                prev.includes(trait.id)
                  ? prev.filter(id => id !== trait.id)
                  : [...prev, trait.id]
              );
              hapticFeedback('light');
            }}
          >
            <Icon
              name={trait.icon}
              size={24}
              color={selectedTraits.includes(trait.id) ? trait.color : theme.colors.textSecondary}
            />
            <Text
              style={[
                styles.traitName,
                {
                  color: selectedTraits.includes(trait.id)
                    ? trait.color
                    : theme.colors.text,
                },
              ]}
            >
              {trait.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderFaceEditor = () => (
    <View style={styles.selectorContainer}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
        {t('influencer.faceParameters')}
      </Text>
      
      <View style={styles.parameterRow}>
        <Text style={[styles.parameterLabel, { color: theme.colors.text }]}>
          {t('influencer.symmetry')}
        </Text>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          value={faceParameters.symmetry}
          onValueChange={(value) =>
            setFaceParameters(prev => ({ ...prev, symmetry: value }))
          }
          minimumTrackTintColor={theme.colors.primary}
          maximumTrackTintColor={theme.colors.border}
          thumbStyle={{ backgroundColor: theme.colors.primary }}
        />
        <Text style={[styles.parameterValue, { color: theme.colors.textSecondary }]}>
          {Math.round(faceParameters.symmetry * 100)}%
        </Text>
      </View>

      <View style={styles.parameterRow}>
        <Text style={[styles.parameterLabel, { color: theme.colors.text }]}>
          {t('influencer.attractiveness')}
        </Text>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          value={faceParameters.attractiveness}
          onValueChange={(value) =>
            setFaceParameters(prev => ({ ...prev, attractiveness: value }))
          }
          minimumTrackTintColor={theme.colors.primary}
          maximumTrackTintColor={theme.colors.border}
          thumbStyle={{ backgroundColor: theme.colors.primary }}
        />
        <Text style={[styles.parameterValue, { color: theme.colors.textSecondary }]}>
          {Math.round(faceParameters.attractiveness * 100)}%
        </Text>
      </View>

      <View style={styles.parameterRow}>
        <Text style={[styles.parameterLabel, { color: theme.colors.text }]}>
          {t('influencer.age')}
        </Text>
        <Slider
          style={styles.slider}
          minimumValue={18}
          maximumValue={65}
          value={faceParameters.age}
          step={1}
          onValueChange={(value) =>
            setFaceParameters(prev => ({ ...prev, age: value }))
          }
          minimumTrackTintColor={theme.colors.primary}
          maximumTrackTintColor={theme.colors.border}
          thumbStyle={{ backgroundColor: theme.colors.primary }}
        />
        <Text style={[styles.parameterValue, { color: theme.colors.textSecondary }]}>
          {Math.round(faceParameters.age)}
        </Text>
      </View>
    </View>
  );

  const toggleInfluencerStatus = async (id: string, isActive: boolean) => {
    try {
      if (isOnline) {
        await apiService.updateInfluencer(id, { isActive });
      }
      
      setInfluencers(prev =>
        prev.map(inf => inf.id === id ? { ...inf, isActive } : inf)
      );
      
      hapticFeedback('light');
      showToast(
        isActive ? t('success.influencerActivated') : t('success.influencerDeactivated'),
        'success'
      );
    } catch (error) {
      console.error('Failed to toggle influencer status:', error);
      showToast(t('errors.updateFailed'), 'error');
    }
  };

  const editInfluencer = (influencer: AIInfluencer) => {
    setCurrentInfluencer(influencer);
    setSelectedTraits(influencer.personality);
    setIsEditing(true);
    setModalVisible(true);
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.text }]}>
          {t('common.loading')}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          {t('influencer.title')}
        </Text>
        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: theme.colors.primary }]}
          onPress={openModal}
        >
          <Icon name="add" size={24} color="white" />
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchContainer, { backgroundColor: theme.colors.surface }]}>
        <Icon name="search" size={20} color={theme.colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: theme.colors.text }]}
          placeholder={t('common.search')}
          placeholderTextColor={theme.colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabContainer}>
        {['All', 'Active', 'Drafts'].map((tab, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.tabButton,
              {
                backgroundColor: selectedTab === index 
                  ? theme.colors.primary + '20' 
                  : 'transparent',
                borderBottomColor: selectedTab === index 
                  ? theme.colors.primary 
                  : 'transparent',
              }
            ]}
            onPress={() => {
              setSelectedTab(index);
              hapticFeedback('light');
            }}
          >
            <Text 
              style={[
                styles.tabText, 
                { 
                  color: selectedTab === index 
                    ? theme.colors.primary 
                    : theme.colors.textSecondary 
                }
              ]}
            >
              {t(`influencer.tabs.${tab.toLowerCase()}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Influencers List */}
      {filteredInfluencers.length > 0 ? (
        <FlatList
          data={filteredInfluencers}
          renderItem={renderInfluencerCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={[styles.listHeader, { color: theme.colors.textSecondary }]}>
              {t('influencer.influencerCount', { count: filteredInfluencers.length })}
            </Text>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                {t('influencer.noInfluencers')}
              </Text>
            </View>
          }
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Icon name="people-alt" size={60} color={theme.colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
            {t('influencer.noInfluencersTitle')}
          </Text>
          <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
            {t('influencer.noInfluencersMessage')}
          </Text>
          <TouchableOpacity
            style={[styles.createFirstButton, { backgroundColor: theme.colors.primary }]}
            onPress={openModal}
          >
            <Text style={[styles.createFirstText, { color: 'white' }]}>
              {t('influencer.createFirst')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Creation/Edit Modal */}
      <Modal
        animationType="none"
        transparent={true}
        visible={modalVisible}
        onRequestClose={closeModal}
      >
        <Animated.View 
          style={[
            styles.modalOverlay, 
            { 
              opacity: fadeAnim,
              backgroundColor: theme.colors.overlay
            }
          ]}
          {...panResponder.panHandlers}
        >
          <Animated.View 
            style={[
              styles.modalContent, 
              { 
                transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
                backgroundColor: theme.colors.background,
              }
            ]}
          >
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                {isEditing ? t('influencer.editTitle') : t('influencer.createTitle')}
              </Text>
              <TouchableOpacity onPress={closeModal}>
                <Icon name="close" size={24} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.modalBody}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              {/* Step Navigation */}
              <View style={styles.stepContainer}>
                {[0, 1, 2, 3, 4].map((index) => (
                  <React.Fragment key={index}>
                    <TouchableOpacity
                      style={[
                        styles.stepCircle,
                        {
                          backgroundColor: step === index 
                            ? theme.colors.primary 
                            : theme.colors.surface,
                          borderColor: step > index 
                            ? theme.colors.success 
                            : theme.colors.border,
                        }
                      ]}
                      onPress={() => setStep(index)}
                    >
                      <Text 
                        style={[
                          styles.stepText,
                          { 
                            color: step === index 
                              ? 'white' 
                              : theme.colors.textSecondary 
                          }
                        ]}
                      >
                        {index + 1}
                      </Text>
                    </TouchableOpacity>
                    {index < 4 && (
                      <View 
                        style={[
                          styles.stepLine, 
                          { 
                            backgroundColor: step > index 
                              ? theme.colors.success 
                              : theme.colors.border 
                          }
                        ]} 
                      />
                    )}
                  </React.Fragment>
                ))}
              </View>

              {/* Step Content */}
              {step === 0 && (
                <View>
                  <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                    {t('influencer.basicInfo')}
                  </Text>
                  
                  <TextInput
                    style={[styles.input, { 
                      backgroundColor: theme.colors.surface, 
                      color: theme.colors.text 
                    }]}
                    placeholder={t('influencer.namePlaceholder')}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={currentInfluencer?.name || ''}
                    onChangeText={(text) => setCurrentInfluencer(prev => ({ ...prev, name: text }))}
                  />
                  
                  <View style={styles.row}>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                        {t('influencer.age')}
                      </Text>
                      <TextInput
                        style={[styles.input, styles.smallInput, { 
                          backgroundColor: theme.colors.surface, 
                          color: theme.colors.text 
                        }]}
                        keyboardType="numeric"
                        value={currentInfluencer?.age?.toString() || ''}
                        onChangeText={(text) => setCurrentInfluencer(prev => ({ 
                          ...prev, 
                          age: parseInt(text) 
                        }))}
                      />
                    </View>
                    
                    <View style={styles.inputGroup}>
                      <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                        {t('influencer.gender')}
                      </Text>
                      <Picker
                        selectedValue={currentInfluencer?.gender || 'non-binary'}
                        onValueChange={(value) => setCurrentInfluencer(prev => ({ 
                          ...prev, 
                          gender: value 
                        }))}
                        style={[styles.picker, { 
                          backgroundColor: theme.colors.surface, 
                          color: theme.colors.text 
                        }]}
                      >
                        <Picker.Item label={t('gender.male')} value="male" />
                        <Picker.Item label={t('gender.female')} value="female" />
                        <Picker.Item label={t('gender.nonBinary')} value="non-binary" />
                      </Picker>
                    </View>
                  </View>
                  
                  <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                    {t('influencer.ethnicity')}
                  </Text>
                  <Picker
                    selectedValue={currentInfluencer?.ethnicity || 'diverse'}
                    onValueChange={(value) => setCurrentInfluencer(prev => ({ 
                      ...prev, 
                      ethnicity: value 
                    }))}
                    style={[styles.picker, { 
                      backgroundColor: theme.colors.surface, 
                      color: theme.colors.text 
                    }]}
                  >
                    {['caucasian', 'african', 'asian', 'hispanic', 'middle-eastern', 'diverse'].map((eth) => (
                      <Picker.Item 
                        key={eth} 
                        label={t(`ethnicity.${eth}`)} 
                        value={eth} 
                      />
                    ))}
                  </Picker>
                </View>
              )}
              
              {step === 1 && renderPersonalitySelector()}
              
              {step === 2 && renderFaceEditor()}
              
              {step === 3 && (
                <View>
                  <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                    {t('influencer.voiceStyle')}
                  </Text>
                  <VoiceCloner
                    theme={theme}
                    onVoiceGenerated={(voiceData) => setCurrentInfluencer(prev => ({
                      ...prev,
                      voiceData
                    }))}
                    initialData={currentInfluencer?.voiceData}
                    offlineMode={!isOnline}
                  />
                </View>
              )}
              
              {step === 4 && (
                <View>
                  <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                    {t('influencer.styleBackstory')}
                  </Text>
                  
                  <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                    {t('influencer.style')}
                  </Text>
                  <TextInput
                    style={[styles.input, { 
                      backgroundColor: theme.colors.surface, 
                      color: theme.colors.text 
                    }]}
                    placeholder={t('influencer.stylePlaceholder')}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={currentInfluencer?.style || ''}
                    onChangeText={(text) => setCurrentInfluencer(prev => ({ ...prev, style: text }))}
                  />
                  
                  <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                    {t('influencer.backstory')}
                  </Text>
                  <TextInput
                    style={[styles.textArea, { 
                      backgroundColor: theme.colors.surface, 
                      color: theme.colors.text 
                    }]}
                    placeholder={t('influencer.backstoryPlaceholder')}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={currentInfluencer?.backstory || ''}
                    onChangeText={(text) => setCurrentInfluencer(prev => ({ ...prev, backstory: text }))}
                    multiline
                    numberOfLines={4}
                  />
                  
                  <TouchableOpacity 
                    style={styles.advancedToggle}
                    onPress={() => setShowAdvanced(!showAdvanced)}
                  >
                    <Text style={[styles.advancedText, { color: theme.colors.primary }]}>
                      {showAdvanced 
                        ? t('common.hideAdvanced') 
                        : t('common.showAdvanced')}
                    </Text>
                    <Icon 
                      name={showAdvanced ? 'expand-less' : 'expand-more'} 
                      size={20} 
                      color={theme.colors.primary} 
                    />
                  </TouchableOpacity>
                  
                  {showAdvanced && (
                    <View>
                      <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                        {t('influencer.offlineMode')}
                      </Text>
                      <Switch
                        value={currentInfluencer?.offlineMode || false}
                        onValueChange={(value) => setCurrentInfluencer(prev => ({ 
                          ...prev, 
                          offlineMode: value 
                        }))}
                        trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                        thumbColor={theme.colors.background}
                      />
                    </View>
                  )}
                </View>
              )}
            </ScrollView>

            {/* Modal Footer */}
            <View style={styles.modalFooter}>
              {step > 0 && (
                <TouchableOpacity
                  style={[styles.footerButton, styles.secondaryButton]}
                  onPress={() => setStep(step - 1)}
                >
                  <Text style={[styles.footerButtonText, { color: theme.colors.text }]}>
                    {t('common.back')}
                  </Text>
                </TouchableOpacity>
              )}
              
              <TouchableOpacity
                style={[
                  styles.footerButton, 
                  styles.primaryButton,
                  { backgroundColor: theme.colors.primary }
                ]}
                onPress={() => {
                  if (step < 4) {
                    setStep(step + 1);
                  } else {
                    if (isEditing) {
                      updateInfluencer();
                    } else {
                      createInfluencer();
                    }
                  }
                }}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={[styles.footerButtonText, { color: 'white' }]}>
                    {step < 4 
                      ? t('common.next') 
                      : isEditing 
                        ? t('common.save') 
                        : t('common.create')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>
    </View>
  );
};

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    elevation: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    margin: 16,
    borderRadius: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 80,
  },
  listHeader: {
    fontSize: 12,
    marginBottom: 8,
  },
  influencerCard: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    elevation: 1,
  },
  cardGradient: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 12,
  },
  cardInfo: {
    flex: 1,
  },
  influencerName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  influencerNiche: {
    fontSize: 14,
    marginBottom: 8,
  },
  metricsRow: {
    flexDirection: 'row',
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  metricText: {
    fontSize: 12,
    marginLeft: 4,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  actionText: {
    fontSize: 12,
    marginLeft: 4,
    fontWeight: '500',
  },
  offlineIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  offlineText: {
    fontSize: 10,
    marginLeft: 2,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  createFirstButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  createFirstText: {
    fontSize: 16,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: height * 0.85,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalBody: {
    padding: 16,
  },
  modalScrollContent: {
    paddingBottom: 80,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
  },
  footerButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  primaryButton: {
    backgroundColor: '#6C5CE7',
  },
  secondaryButton: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  footerButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  stepContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  stepLine: {
    flex: 1,
    height: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  input: {
    height: 48,
    borderRadius: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  smallInput: {
    height: 40,
  },
  textArea: {
    height: 100,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    textAlignVertical: 'top',
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    marginHorizontal: -8,
    marginBottom: 16,
  },
  inputGroup: {
    flex: 1,
    marginHorizontal: 8,
  },
  picker: {
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  selectorContainer: {
    marginBottom: 24,
  },
  traitsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  traitCard: {
    width: (width - 64) / 3,
    margin: 4,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  traitName: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 8,
  },
  parameterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  parameterLabel: {
    flex: 1,
    fontSize: 14,
  },
  slider: {
    flex: 2,
    height: 40,
  },
  parameterValue: {
    width: 50,
    textAlign: 'right',
    fontSize: 14,
    marginLeft: 8,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  advancedText: {
    fontSize: 14,
    fontWeight: '500',
    marginRight: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
  },
});

// Add these helper functions outside the component
const generateSeed = (input: string) => {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

const generateSVGAvatar = (initials: string) => {
  const colors = ['#6C5CE7', '#00CEC9', '#FD79A8', '#FDCB6E', '#E17055'];
  const bgColor = colors[Math.abs(generateSeed(initials)) % colors.length];
  
  return `
    <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="50" fill="${bgColor}"/>
      <text x="50" y="50" text-anchor="middle" dy="0.35em" 
            font-family="Arial, sans-serif" font-size="24" 
            font-weight="bold" fill="white">${initials}</text>
    </svg>
  `;
};

const getDefaultPersonalityTraits = (t: (key: string) => string): PersonalityTrait[] => [
  // ... trait definitions using t() ...
];

const getDefaultNiches = (t: (key: string) => string): Niche[] => [
  // ... niche definitions using t() ...
];