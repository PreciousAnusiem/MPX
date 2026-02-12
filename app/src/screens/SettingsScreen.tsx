import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Alert,
  Switch,
  TouchableOpacity,
  StyleSheet,
  Image,
  Linking,
  Platform,
  DeviceEventEmitter,
  BackHandler,
  Animated,
  Easing,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useFocusEffect } from '@react-navigation/native';

// Internal imports
import { RootState } from '../store';
import { updateUserProfile, updateSettings, logout } from '../store/userSlice';
import { updateTheme, toggleTheme } from '../store/themeSlice';
import { clearContent, exportContent } from '../store/contentSlice';
import Button from '../components/Button';
import Input from '../components/Input';
import Loading from '../components/Loading';
import LanguageSelector from '../components/LanguageSelector';
import { 
  apiClient, 
  uploadProfileImage, 
  deleteAccount, 
  updateUserData,
  syncOfflineData 
} from '../services/api';
import { 
  deleteAllUserData, 
  exportUserData, 
  clearCache,
  getStorageInfo,
  compressImages,
  cleanupOldFiles
} from '../services/storage';
import { 
  trackEvent, 
  setUserProperties,
  resetAnalytics 
} from '../services/analytics';
import { 
  encryptData, 
  decryptData, 
  generateBackupKey,
  validateSecureStorage
} from '../utils/security';
import { formatBytes, validateEmail, compressImage } from '../utils/helpers';
import { COLORS, FONTS, SPACING } from '../utils/constants';
import { t } from '../utils/i18n';

interface UserSettings {
  notifications: {
    push: boolean;
    email: boolean;
    marketing: boolean;
    trends: boolean;
    security: boolean;
  };
  privacy: {
    analytics: boolean;
    profileVisible: boolean;
    locationTracking: boolean;
    biometricAuth: boolean;
    autoLock: boolean;
    dataSharing: boolean;
  };
  preferences: {
    autoSave: boolean;
    qualityMode: 'low' | 'medium' | 'high';
    offlineMode: boolean;
    autoSync: boolean;
    compression: boolean;
    backgroundRefresh: boolean;
  };
  security: {
    twoFactorEnabled: boolean;
    sessionTimeout: number;
    passwordLastChanged: string;
    securityQuestions: boolean;
  };
}

interface ProfileData {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  bio?: string;
  website?: string;
  location?: string;
  subscriptionTier: string;
  subscriptionExpiry?: string;
  totalPosts: number;
  totalInfluencers: number;
  joinedDate: string;
  lastActive: string;
  storageUsed: number;
  storageLimit: number;
}

interface StorageInfo {
  totalSize: number;
  usedSize: number;
  cacheSize: number;
  mediaSize: number;
  documentsSize: number;
  availableSpace: number;
}

const SettingsScreen: React.FC = () => {
  const dispatch = useDispatch();
  const { user, isLoading, subscription, settings: userSettings } = useSelector((state: RootState) => state.user);
  const { theme, isDarkMode } = useSelector((state: RootState) => state.theme);
  const { language } = useSelector((state: RootState) => state.app);

  // State management
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [settings, setSettings] = useState<UserSettings>({
    notifications: {
      push: true,
      email: true,
      marketing: false,
      trends: true,
      security: true,
    },
    privacy: {
      analytics: true,
      profileVisible: true,
      locationTracking: false,
      biometricAuth: false,
      autoLock: true,
      dataSharing: false,
    },
    preferences: {
      autoSave: true,
      qualityMode: 'medium',
      offlineMode: true,
      autoSync: true,
      compression: true,
      backgroundRefresh: true,
    },
    security: {
      twoFactorEnabled: false,
      sessionTimeout: 30,
      passwordLastChanged: new Date().toISOString(),
      securityQuestions: false,
    },
  });

  const [profile, setProfile] = useState<ProfileData>({
    id: user?.id || '',
    email: user?.email || '',
    name: user?.name || '',
    avatar: user?.avatar,
    bio: user?.bio || '',
    website: user?.website || '',
    location: user?.location || '',
    subscriptionTier: subscription?.tier || 'freemium',
    subscriptionExpiry: subscription?.expiry,
    totalPosts: user?.stats?.totalPosts || 0,
    totalInfluencers: user?.stats?.totalInfluencers || 0,
    joinedDate: user?.joinedDate || new Date().toISOString(),
    lastActive: new Date().toISOString(),
    storageUsed: 0,
    storageLimit: subscription?.storageLimit || 1024 * 1024 * 1024, // 1GB default
  });

  const [storageInfo, setStorageInfo] = useState<StorageInfo>({
    totalSize: 0,
    usedSize: 0,
    cacheSize: 0,
    mediaSize: 0,
    documentsSize: 0,
    availableSpace: 0,
  });

  const [activeSection, setActiveSection] = useState<string>('profile');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [showSecurityModal, setShowSecurityModal] = useState<boolean>(false);
  const [showBackupModal, setShowBackupModal] = useState<boolean>(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>('');
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [backupKey, setBackupKey] = useState<string>('');
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  // Animations
  const slideAnim = useMemo(() => new Animated.Value(0), []);
  const fadeAnim = useMemo(() => new Animated.Value(1), []);

  // Load initial data
  useEffect(() => {
    loadSettingsData();
    loadStorageInfo();
    checkNetworkStatus();
    setupBackgroundTasks();
    
    return () => {
      cleanupTasks();
    };
  }, []);

  // Network status monitoring
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? false);
      if (state.isConnected && settings.preferences.autoSync) {
        performAutoSync();
      }
    });

    return () => unsubscribe();
  }, [settings.preferences.autoSync]);

  // Focus effect for screen updates
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (isEditing) {
          Alert.alert(
            t('settings.unsavedChanges'),
            t('settings.unsavedChangesMessage'),
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.discard'), onPress: () => setIsEditing(false) },
            ]
          );
          return true;
        }
        return false;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [isEditing])
  );

  // Auto-save functionality
  useEffect(() => {
    if (settings.preferences.autoSave && isEditing) {
      const timeoutId = setTimeout(() => {
        saveSettingsOffline();
      }, 2000); // Auto-save after 2 seconds of inactivity

      return () => clearTimeout(timeoutId);
    }
  }, [settings, profile, isEditing]);

  const loadSettingsData = async () => {
    try {
      // Load from offline storage first
      const [offlineSettings, offlineProfile, lastSync] = await Promise.all([
        AsyncStorage.getItem('userSettings'),
        AsyncStorage.getItem('userProfile'),
        AsyncStorage.getItem('lastSyncTime')
      ]);

      if (offlineSettings) {
        setSettings(JSON.parse(offlineSettings));
      }

      if (offlineProfile) {
        const profileData = JSON.parse(offlineProfile);
        setProfile(prev => ({ ...prev, ...profileData }));
      }

      if (lastSync) {
        setLastSyncTime(lastSync);
      }

      // Sync with server if online
      if (isOnline) {
        await syncSettingsWithServer();
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      trackEvent('settings_load_error', { error: error.message });
    }
  };

  const loadStorageInfo = async () => {
    try {
      const info = await getStorageInfo();
      setStorageInfo(info);
      
      // Update profile storage usage
      setProfile(prev => ({
        ...prev,
        storageUsed: info.usedSize
      }));
    } catch (error) {
      console.error('Error loading storage info:', error);
    }
  };

  const checkNetworkStatus = async () => {
    const state = await NetInfo.fetch();
    setIsOnline(state.isConnected ?? false);
  };

  const setupBackgroundTasks = () => {
    // Setup periodic storage cleanup
    const cleanupInterval = setInterval(async () => {
      if (settings.preferences.compression) {
        await cleanupOldFiles();
        await compressImages();
        await loadStorageInfo();
      }
    }, 60000 * 30); // Every 30 minutes

    // Setup auto-sync
    const syncInterval = setInterval(async () => {
      if (isOnline && settings.preferences.autoSync) {
        await performAutoSync();
      }
    }, 60000 * 5); // Every 5 minutes

    return () => {
      clearInterval(cleanupInterval);
      clearInterval(syncInterval);
    };
  };

  const cleanupTasks = () => {
    // Cleanup any running tasks
  };

  const syncSettingsWithServer = async () => {
    try {
      if (!isOnline) return;

      const response = await apiClient.get('/user/settings');
      if (response.data) {
        const serverSettings = response.data.settings;
        const serverProfile = response.data.profile;

        // Merge server data with local data
        setSettings(prev => ({ ...prev, ...serverSettings }));
        setProfile(prev => ({ ...prev, ...serverProfile }));

        // Save updated data offline
        await Promise.all([
          AsyncStorage.setItem('userSettings', JSON.stringify(serverSettings)),
          AsyncStorage.setItem('userProfile', JSON.stringify(serverProfile)),
          AsyncStorage.setItem('lastSyncTime', new Date().toISOString())
        ]);

        setLastSyncTime(new Date().toISOString());
      }
    } catch (error) {
      console.error('Error syncing settings:', error);
    }
  };

  const performAutoSync = async () => {
    try {
      if (!isOnline) return;

      await syncOfflineData();
      await syncSettingsWithServer();
      
      trackEvent('auto_sync_completed');
    } catch (error) {
      console.error('Auto-sync failed:', error);
    }
  };

  const saveSettingsOffline = async () => {
    try {
      await Promise.all([
        AsyncStorage.setItem('userSettings', JSON.stringify(settings)),
        AsyncStorage.setItem('userProfile', JSON.stringify(profile))
      ]);
    } catch (error) {
      console.error('Error saving settings offline:', error);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    
    try {
      // Save locally first
      await saveSettingsOffline();

      // Sync with server if online
      if (isOnline) {
        await apiClient.put('/user/settings', {
          settings,
          profile: {
            name: profile.name,
            bio: profile.bio,
            website: profile.website,
            location: profile.location,
          }
        });

        await syncSettingsWithServer();
      }

      // Update Redux store
      dispatch(updateSettings(settings));
      dispatch(updateUserProfile({
        name: profile.name,
        bio: profile.bio,
        website: profile.website,
        location: profile.location,
      }));

      setIsEditing(false);
      
      Alert.alert(
        t('settings.success'),
        t('settings.settingsSaved'),
        [{ text: t('common.ok') }]
      );

      trackEvent('settings_saved', {
        hasInternetConnection: isOnline,
        settingsChanged: Object.keys(settings).length
      });

    } catch (error) {
      console.error('Error saving settings:', error);
      Alert.alert(
        t('settings.error'),
        isOnline ? t('settings.saveError') : t('settings.savedOffline')
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleProfileImageChange = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert(
          t('settings.permission'),
          t('settings.cameraPermission')
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: false,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        
        // Compress image
        const compressedUri = await compressImage(asset.uri, 0.7);
        
        // Save locally
        const fileName = `profile_${Date.now()}.jpg`;
        const localPath = `${FileSystem.documentDirectory}${fileName}`;
        await FileSystem.moveAsync({
          from: compressedUri,
          to: localPath
        });

        // Update profile
        setProfile(prev => ({ ...prev, avatar: localPath }));
        setIsEditing(true);

        // Upload to server if online
        if (isOnline) {
          try {
            const uploadedUrl = await uploadProfileImage(localPath);
            setProfile(prev => ({ ...prev, avatar: uploadedUrl }));
          } catch (error) {
            console.error('Upload failed, keeping local image:', error);
          }
        }

        trackEvent('profile_image_changed');
      }
    } catch (error) {
      console.error('Error changing profile image:', error);
      Alert.alert(t('settings.error'), t('settings.imageError'));
    }
  };

  const handleBiometricToggle = async (enabled: boolean) => {
    try {
      if (enabled) {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
        
        if (!hasHardware || supportedTypes.length === 0) {
          Alert.alert(
            t('settings.biometricNotAvailable'),
            t('settings.biometricNotAvailableMessage')
          );
          return;
        }

        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        if (!isEnrolled) {
          Alert.alert(
            t('settings.biometricNotEnrolled'),
            t('settings.biometricNotEnrolledMessage')
          );
          return;
        }

        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: t('settings.enableBiometric'),
          cancelLabel: t('common.cancel'),
          fallbackLabel: t('settings.usePassword'),
        });

        if (result.success) {
          setSettings(prev => ({
            ...prev,
            privacy: { ...prev.privacy, biometricAuth: true }
          }));
          setIsEditing(true);
          
          // Store biometric preference securely
          await AsyncStorage.setItem('biometricEnabled', 'true');
          
          trackEvent('biometric_authentication_enabled');
        }
      } else {
        setSettings(prev => ({
          ...prev,
          privacy: { ...prev.privacy, biometricAuth: false }
        }));
        setIsEditing(true);
        
        await AsyncStorage.removeItem('biometricEnabled');
        trackEvent('biometric_authentication_disabled');
      }
    } catch (error) {
      console.error('Error handling biometric toggle:', error);
      Alert.alert(t('settings.error'), t('settings.biometricError'));
    }
  };

  const handleExportData = async () => {
    setIsExporting(true);
    
    try {
      const exportData = await exportUserData();
      const encryptedData = await encryptData(JSON.stringify(exportData));
      
      // Save to device
      const fileName = `onxlink_backup_${new Date().getTime()}.json`;
      const filePath = `${FileSystem.documentDirectory}${fileName}`;
      
      await FileSystem.writeAsStringAsync(filePath, encryptedData);
      
      Alert.alert(
        t('settings.exportSuccess'),
        t('settings.exportSuccessMessage', { fileName }),
        [
          { text: t('common.ok') },
          { 
            text: t('settings.share'), 
            onPress: () => shareBackupFile(filePath)
          }
        ]
      );

      trackEvent('data_exported', {
        dataSize: encryptedData.length,
        includesMedia: exportData.media?.length > 0
      });

    } catch (error) {
      console.error('Error exporting data:', error);
      Alert.alert(t('settings.error'), t('settings.exportError'));
    } finally {
      setIsExporting(false);
    }
  };

  const shareBackupFile = async (filePath: string) => {
    try {
      const { Share } = require('react-native');
      await Share.share({
        url: filePath,
        title: t('settings.backupFile'),
        message: t('settings.backupFileMessage'),
      });
    } catch (error) {
      console.error('Error sharing backup file:', error);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      Alert.alert(
        t('settings.error'),
        t('settings.deleteConfirmError')
      );
      return;
    }

    try {
      setIsSaving(true);

      // Clear local data first
      await deleteAllUserData();
      await clearCache();
      
      // Delete from server if online
      if (isOnline) {
        await deleteAccount();
      }

      // Reset app state
      dispatch(logout());
      dispatch(clearContent());
      await resetAnalytics();

      Alert.alert(
        t('settings.accountDeleted'),
        t('settings.accountDeletedMessage'),
        [{ text: t('common.ok'), onPress: () => {
          setShowDeleteModal(false);
          // Navigate to auth screen
        }}]
      );

      trackEvent('account_deleted');

    } catch (error) {
      console.error('Error deleting account:', error);
      Alert.alert(t('settings.error'), t('settings.deleteError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      Alert.alert(t('settings.error'), t('settings.passwordMismatch'));
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert(t('settings.error'), t('settings.passwordTooShort'));
      return;
    }

    try {
      setIsSaving(true);

      if (isOnline) {
        await apiClient.put('/user/change-password', {
          currentPassword,
          newPassword
        });
      }

      setSettings(prev => ({
        ...prev,
        security: {
          ...prev.security,
          passwordLastChanged: new Date().toISOString()
        }
      }));

      setShowSecurityModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      Alert.alert(
        t('settings.success'),
        t('settings.passwordChanged')
      );

      trackEvent('password_changed');

    } catch (error) {
      console.error('Error changing password:', error);
      Alert.alert(t('settings.error'), t('settings.passwordChangeError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearCache = async () => {
    try {
      await clearCache();
      await loadStorageInfo();
      
      Alert.alert(
        t('settings.success'),
        t('settings.cacheCleared')
      );

      trackEvent('cache_cleared');
    } catch (error) {
      console.error('Error clearing cache:', error);
      Alert.alert(t('settings.error'), t('settings.cacheError'));
    }
  };

  const handleGenerateBackupKey = async () => {
    try {
      const key = await generateBackupKey();
      setBackupKey(key);
      setShowBackupModal(true);
      
      trackEvent('backup_key_generated');
    } catch (error) {
      console.error('Error generating backup key:', error);
      Alert.alert(t('settings.error'), t('settings.backupKeyError'));
    }
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>
        {t('settings.title')}
      </Text>
      <View style={styles.connectionStatus}>
        <View style={[
          styles.connectionDot, 
          { backgroundColor: isOnline ? COLORS.success : COLORS.warning }
        ]} />
        <Text style={[styles.connectionText, { color: theme.textSecondary }]}>
          {isOnline ? t('settings.online') : t('settings.offline')}
        </Text>
      </View>
    </View>
  );

  const renderSectionTabs = () => (
    <ScrollView 
      horizontal 
      showsHorizontalScrollIndicator={false}
      style={styles.sectionTabs}
    >
      {['profile', 'notifications', 'privacy', 'preferences', 'security', 'storage'].map((section) => (
        <TouchableOpacity
          key={section}
          style={[
            styles.sectionTab,
            { 
              backgroundColor: activeSection === section ? theme.primary : 'transparent',
              borderColor: theme.border
            }
          ]}
          onPress={() => setActiveSection(section)}
        >
          <Text style={[
            styles.sectionTabText,
            { 
              color: activeSection === section ? COLORS.white : theme.textPrimary,
              fontWeight: activeSection === section ? '600' : '400'
            }
          ]}>
            {t(`settings.${section}`)}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const renderProfileSection = () => (
    <View style={styles.section}>
      <TouchableOpacity 
        style={styles.profileImageContainer}
        onPress={handleProfileImageChange}
      >
        {profile.avatar ? (
          <Image source={{ uri: profile.avatar }} style={styles.profileImage} />
        ) : (
          <View style={[styles.profileImagePlaceholder, { backgroundColor: theme.surfaceVariant }]}>
            <Text style={[styles.profileImageText, { color: theme.textPrimary }]}>
              {profile.name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={[styles.editImageOverlay, { backgroundColor: theme.primary }]}>
          <Text style={styles.editImageText}>✏️</Text>
        </View>
      </TouchableOpacity>

      <Input
        label={t('settings.name')}
        value={profile.name}
        onChangeText={(text) => {
          setProfile(prev => ({ ...prev, name: text }));
          setIsEditing(true);
        }}
        editable={true}
        style={styles.input}
      />

      <Input
        label={t('settings.email')}
        value={profile.email}
        editable={false}
        style={[styles.input, styles.disabledInput]}
      />

      <Input
        label={t('settings.bio')}
        value={profile.bio}
        onChangeText={(text) => {
          setProfile(prev => ({ ...prev, bio: text }));
          setIsEditing(true);
        }}
        multiline
        numberOfLines={3}
        maxLength={250}
        style={styles.input}
      />

      <Input
        label={t('settings.website')}
        value={profile.website}
        onChangeText={(text) => {
          setProfile(prev => ({ ...prev, website: text }));
          setIsEditing(true);
        }}
        autoCapitalize="none"
        style={styles.input}
      />

      <Input
        label={t('settings.location')}
        value={profile.location}
        onChangeText={(text) => {
          setProfile(prev => ({ ...prev, location: text }));
          setIsEditing(true);
        }}
        style={styles.input}
      />

      <View style={styles.statsContainer}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: theme.textPrimary }]}>
            {profile.totalPosts}
          </Text>
          <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
            {t('settings.totalPosts')}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: theme.textPrimary }]}>
            {profile.totalInfluencers}
          </Text>
          <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
            {t('settings.totalInfluencers')}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: theme.primary }]}>
            {profile.subscriptionTier.toUpperCase()}
          </Text>
          <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
            {t('settings.subscription')}
          </Text>
        </View>
      </View>
    </View>
  );

  const renderNotificationsSection = () => (
    <View style={styles.section}>
      {Object.entries(settings.notifications).map(([key, value]) => (
        <View key={key} style={[styles.settingItem, { borderBottomColor: theme.border }]}>
          <View style={styles.settingInfo}>
            <Text style={[styles.settingTitle, { color: theme.textPrimary }]}>
              {t(`settings.notification_${key}`)}
            </Text>
            <Text style={[styles.settingDescription, { color: theme.textSecondary }]}>
              {t(`settings.notification_${key}_desc`)}
            </Text>
          </View>
          <Switch
            value={value}
            onValueChange={(newValue) => {
              setSettings(prev => ({
                ...prev,
                notifications: { ...prev.notifications, [key]: newValue }
              }));
              setIsEditing(true);
            }}
            trackColor={{ false: theme.surfaceVariant, true: theme.primary }}
            thumbColor={value ? COLORS.white : theme.textSecondary}
          />
        </View>
      ))}
    </View>
  );

  const renderPrivacySection = () => (
    <View style={styles.section}>
      {Object.entries(settings.privacy).map(([key, value]) => (
        <View key={key} style={[styles.settingItem, { borderBottomColor: theme.border }]}>
          <View style={styles.settingInfo}>
            <Text style={[styles.settingTitle, { color: theme.textPrimary }]}>
              {t(`settings.privacy_${key}`)}
            </Text>
            <Text style={[styles.settingDescription, { color: theme.textSecondary }]}>
              {t(`settings.privacy_${key}_desc`)}
            </Text>
          </View>
          <Switch
            value={value}
            onValueChange={(newValue) => {
              if (key === 'biometricAuth') {
                handleBiometricToggle(newValue);
              } else {
                setSettings(prev => ({
                  ...prev,
                  privacy: { ...prev.privacy, [key]: newValue }
                }));
                setIsEditing(true);
              }
            }}
            trackColor={{ false: theme.surfaceVariant, true: theme.primary }}
            thumbColor={value ? COLORS.white : theme.textSecondary}
          />
        </View>
      ))}
      
      <TouchableOpacity 
        style={[styles.actionButton, { backgroundColor: theme.surfaceVariant }]}
        onPress={() => setShowBackupModal(true)}
      >
        <Text style={[styles.actionButtonText, { color: theme.textPrimary }]}>
          {t('settings.generateBackupKey')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderPreferencesSection = () => (
    <View style={styles.section}>
      {Object.entries(settings.preferences).map(([key, value]) => {
        if (key === 'qualityMode') {
          return (
            <View key={key} style={[styles.settingItem, { borderBottomColor: theme.border }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingTitle, { color: theme.textPrimary }]}>
                  {t(`settings.preference_${key}`)}
                </Text>
                <Text style={[styles.settingDescription, { color: theme.textSecondary }]}>
                  {t(`settings.preference_${key}_desc`)}
                </Text>
              </View>
              <View style={styles.qualityOptions}>
                {(['low', 'medium', 'high'] as const).map(option => (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.qualityOption,
                      {
                        backgroundColor: value === option ? theme.primary : theme.surfaceVariant,
                        borderColor: theme.border
                      }
                    ]}
                    onPress={() => {
                      setSettings(prev => ({
                        ...prev,
                        preferences: { ...prev.preferences, qualityMode: option }
                      }));
                      setIsEditing(true);
                    }}
                  >
                    <Text style={[
                      styles.qualityOptionText,
                      { color: value === option ? COLORS.white : theme.textPrimary }
                    ]}>
                      {t(`settings.${option}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        } else {
          return (
            <View key={key} style={[styles.settingItem, { borderBottomColor: theme.border }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingTitle, { color: theme.textPrimary }]}>
                  {t(`settings.preference_${key}`)}
                </Text>
                <Text style={[styles.settingDescription, { color: theme.textSecondary }]}>
                  {t(`settings.preference_${key}_desc`)}
                </Text>
              </View>
              <Switch
                value={value as boolean}
                onValueChange={(newValue) => {
                  setSettings(prev => ({
                    ...prev,
                    preferences: { ...prev.preferences, [key]: newValue }
                  }));
                  setIsEditing(true);
                  
                  // Special handling for offline mode
                  if (key === 'offlineMode' && !newValue && isOnline) {
                    performAutoSync();
                  }
                }}
                trackColor={{ false: theme.surfaceVariant, true: theme.primary }}
                thumbColor={value ? COLORS.white : theme.textSecondary}
              />
            </View>
          );
        }
      })}
      
      <TouchableOpacity 
        style={[styles.actionButton, { backgroundColor: theme.surfaceVariant }]}
        onPress={handleClearCache}
      >
        <Text style={[styles.actionButtonText, { color: theme.textPrimary }]}>
          {t('settings.clearCache')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderSecuritySection = () => (
    <View style={styles.section}>
      <View style={[styles.settingItem, { borderBottomColor: theme.border }]}>
        <View style={styles.settingInfo}>
          <Text style={[styles.settingTitle, { color: theme.textPrimary }]}>
            {t('settings.security_twoFactor')}
          </Text>
          <Text style={[styles.settingDescription, { color: theme.textSecondary }]}>
            {t('settings.security_twoFactor_desc')}
          </Text>
        </View>
        <Switch
          value={settings.security.twoFactorEnabled}
          onValueChange={(newValue) => {
            setSettings(prev => ({
              ...prev,
              security: { ...prev.security, twoFactorEnabled: newValue }
            }));
            setIsEditing(true);
          }}
          trackColor={{ false: theme.surfaceVariant, true: theme.primary }}
          thumbColor={settings.security.twoFactorEnabled ? COLORS.white : theme.textSecondary}
        />
      </View>
      
      <View style={[styles.settingItem, { borderBottomColor: theme.border }]}>
        <View style={styles.settingInfo}>
          <Text style={[styles.settingTitle, { color: theme.textPrimary }]}>
            {t('settings.security_sessionTimeout')}
          </Text>
          <Text style={[styles.settingDescription, { color: theme.textSecondary }]}>
            {t('settings.security_sessionTimeout_desc')}
          </Text>
        </View>
        <View style={styles.sessionOptions}>
          {[5, 15, 30, 60].map(minutes => (
            <TouchableOpacity
              key={minutes}
              style={[
                styles.sessionOption,
                {
                  backgroundColor: settings.security.sessionTimeout === minutes 
                    ? theme.primary 
                    : theme.surfaceVariant,
                  borderColor: theme.border
                }
              ]}
              onPress={() => {
                setSettings(prev => ({
                  ...prev,
                  security: { ...prev.security, sessionTimeout: minutes }
                }));
                setIsEditing(true);
              }}
            >
              <Text style={[
                styles.sessionOptionText,
                { 
                  color: settings.security.sessionTimeout === minutes 
                    ? COLORS.white 
                    : theme.textPrimary 
                }
              ]}>
                {minutes} min
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      
      <View style={styles.securityInfo}>
        <Text style={[styles.securityLabel, { color: theme.textSecondary }]}>
          {t('settings.passwordLastChanged')}
        </Text>
        <Text style={[styles.securityValue, { color: theme.textPrimary }]}>
          {new Date(settings.security.passwordLastChanged).toLocaleDateString(language, {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}
        </Text>
      </View>
      
      <View style={styles.securityInfo}>
        <Text style={[styles.securityLabel, { color: theme.textSecondary }]}>
          {t('settings.securityQuestions')}
        </Text>
        <Text style={[styles.securityValue, { color: theme.textPrimary }]}>
          {settings.security.securityQuestions 
            ? t('common.enabled') 
            : t('common.disabled')}
        </Text>
      </View>
      
      <TouchableOpacity 
        style={[styles.actionButton, { backgroundColor: theme.surfaceVariant }]}
        onPress={() => setShowSecurityModal(true)}
      >
        <Text style={[styles.actionButtonText, { color: theme.textPrimary }]}>
          {t('settings.changePassword')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderStorageSection = () => (
    <View style={styles.section}>
      <View style={styles.storageHeader}>
        <Text style={[styles.storageTitle, { color: theme.textPrimary }]}>
          {t('settings.storageUsage')}
        </Text>
        <Text style={[styles.storageSubtitle, { color: theme.textSecondary }]}>
          {formatBytes(storageInfo.usedSize)} / {formatBytes(storageInfo.totalSize)}
        </Text>
      </View>
      
      <View style={styles.storageProgressContainer}>
        <View style={[styles.storageProgressTrack, { backgroundColor: theme.surfaceVariant }]}>
          <View 
            style={[
              styles.storageProgressFill, 
              { 
                width: `${Math.min(100, (storageInfo.usedSize / storageInfo.totalSize) * 100)}%`,
                backgroundColor: theme.primary
              }
            ]}
          />
        </View>
        <Text style={[styles.storageProgressText, { color: theme.textSecondary }]}>
          {Math.round((storageInfo.usedSize / storageInfo.totalSize) * 100)}%
        </Text>
      </View>
      
      <View style={styles.storageDetails}>
        <View style={styles.storageDetailItem}>
          <View style={[styles.storageDetailIcon, { backgroundColor: theme.primary + '20' }]}>
            <Text style={[styles.storageDetailIconText, { color: theme.primary }]}>🖼️</Text>
          </View>
          <View>
            <Text style={[styles.storageDetailTitle, { color: theme.textPrimary }]}>
              {t('settings.media')}
            </Text>
            <Text style={[styles.storageDetailValue, { color: theme.textSecondary }]}>
              {formatBytes(storageInfo.mediaSize)}
            </Text>
          </View>
        </View>
        
        <View style={styles.storageDetailItem}>
          <View style={[styles.storageDetailIcon, { backgroundColor: COLORS.success + '20' }]}>
            <Text style={[styles.storageDetailIconText, { color: COLORS.success }]}>📄</Text>
          </View>
          <View>
            <Text style={[styles.storageDetailTitle, { color: theme.textPrimary }]}>
              {t('settings.documents')}
            </Text>
            <Text style={[styles.storageDetailValue, { color: theme.textSecondary }]}>
              {formatBytes(storageInfo.documentsSize)}
            </Text>
          </View>
        </View>
        
        <View style={styles.storageDetailItem}>
          <View style={[styles.storageDetailIcon, { backgroundColor: COLORS.warning + '20' }]}>
            <Text style={[styles.storageDetailIconText, { color: COLORS.warning }]}>🗑️</Text>
          </View>
          <View>
            <Text style={[styles.storageDetailTitle, { color: theme.textPrimary }]}>
              {t('settings.cache')}
            </Text>
            <Text style={[styles.storageDetailValue, { color: theme.textSecondary }]}>
              {formatBytes(storageInfo.cacheSize)}
            </Text>
          </View>
        </View>
      </View>
      
      <TouchableOpacity 
        style={[styles.actionButton, { backgroundColor: theme.surfaceVariant }]}
        onPress={handleClearCache}
      >
        <Text style={[styles.actionButtonText, { color: theme.textPrimary }]}>
          {t('settings.clearCache')}
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity 
        style={[styles.actionButton, { backgroundColor: theme.surfaceVariant }]}
        onPress={handleExportData}
        disabled={isExporting}
      >
        {isExporting ? (
          <ActivityIndicator color={theme.textPrimary} />
        ) : (
          <Text style={[styles.actionButtonText, { color: theme.textPrimary }]}>
            {t('settings.exportData')}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'profile': return renderProfileSection();
      case 'notifications': return renderNotificationsSection();
      case 'privacy': return renderPrivacySection();
      case 'preferences': return renderPreferencesSection();
      case 'security': return renderSecuritySection();
      case 'storage': return renderStorageSection();
      default: return null;
    }
  };

  const renderFooter = () => (
    <View style={styles.footer}>
      <Button
        title={t('settings.resetSettings')}
        onPress={() => {
          Alert.alert(
            t('settings.confirmReset'),
            t('settings.resetConfirmationMessage'),
            [
              { text: t('common.cancel'), style: 'cancel' },
              { 
                text: t('common.reset'), 
                style: 'destructive',
                onPress: () => {
                  setSettings(userSettings);
                  setProfile({
                    ...profile,
                    name: user?.name || '',
                    bio: user?.bio || '',
                    website: user?.website || '',
                    location: user?.location || '',
                    avatar: user?.avatar
                  });
                  setIsEditing(false);
                }
              }
            ]
          );
        }}
        style={styles.resetButton}
        textStyle={{ color: theme.textSecondary }}
      />
      
      <Button
        title={isSaving ? t('common.saving') : t('common.saveChanges')}
        onPress={handleSaveSettings}
        disabled={!isEditing || isSaving}
        style={[
          styles.saveButton,
          { 
            backgroundColor: isEditing ? theme.primary : theme.surfaceVariant,
            opacity: isEditing ? 1 : 0.7
          }
        ]}
        textStyle={{ color: isEditing ? COLORS.white : theme.textSecondary }}
      />
    </View>
  );

  const renderDeleteModal = () => (
    <Modal
      visible={showDeleteModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowDeleteModal(false)}
    >
      <KeyboardAvoidingView 
        style={styles.modalContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.modalContent, { backgroundColor: theme.background }]}>
          <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
            {t('settings.deleteAccount')}
          </Text>
          
          <Text style={[styles.modalText, { color: theme.textSecondary }]}>
            {t('settings.deleteAccountWarning')}
          </Text>
          
          <Text style={[styles.modalText, { color: theme.textSecondary, fontWeight: 'bold' }]}>
            {t('settings.deleteAccountConfirm')}
          </Text>
          
          <TextInput
            style={[
              styles.deleteInput,
              { 
                backgroundColor: theme.surfaceVariant,
                color: theme.textPrimary,
                borderColor: theme.border
              }
            ]}
            placeholder={t('settings.typeDelete')}
            placeholderTextColor={theme.textSecondary}
            value={deleteConfirmText}
            onChangeText={setDeleteConfirmText}
            autoCapitalize="none"
            autoCorrect={false}
          />
          
          <View style={styles.modalButtons}>
            <Button
              title={t('common.cancel')}
              onPress={() => setShowDeleteModal(false)}
              style={[styles.modalButton, { backgroundColor: theme.surfaceVariant }]}
              textStyle={{ color: theme.textPrimary }}
            />
            <Button
              title={isSaving ? t('common.deleting') : t('common.deleteAccount')}
              onPress={handleDeleteAccount}
              disabled={deleteConfirmText !== 'DELETE' || isSaving}
              style={[
                styles.modalButton,
                { 
                  backgroundColor: deleteConfirmText === 'DELETE' 
                    ? COLORS.error 
                    : theme.surfaceVariant,
                  opacity: deleteConfirmText === 'DELETE' ? 1 : 0.7
                }
              ]}
              textStyle={{ color: COLORS.white }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderSecurityModal = () => (
    <Modal
      visible={showSecurityModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowSecurityModal(false)}
    >
      <KeyboardAvoidingView 
        style={styles.modalContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.modalContent, { backgroundColor: theme.background }]}>
          <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
            {t('settings.changePassword')}
          </Text>
          
          <Input
            label={t('settings.currentPassword')}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry={true}
            style={styles.modalInput}
            placeholder={t('settings.enterCurrentPassword')}
          />
          
          <Input
            label={t('settings.newPassword')}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={true}
            style={styles.modalInput}
            placeholder={t('settings.enterNewPassword')}
          />
          
          <Input
            label={t('settings.confirmPassword')}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={true}
            style={styles.modalInput}
            placeholder={t('settings.confirmNewPassword')}
            error={newPassword !== confirmPassword ? t('settings.passwordMismatch') : undefined}
          />
          
          <View style={styles.modalButtons}>
            <Button
              title={t('common.cancel')}
              onPress={() => {
                setShowSecurityModal(false);
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
              }}
              style={[styles.modalButton, { backgroundColor: theme.surfaceVariant }]}
              textStyle={{ color: theme.textPrimary }}
            />
            <Button
              title={isSaving ? t('common.saving') : t('common.save')}
              onPress={handleChangePassword}
              disabled={isSaving || newPassword.length < 8 || newPassword !== confirmPassword}
              style={[
                styles.modalButton,
                { 
                  backgroundColor: theme.primary,
                  opacity: newPassword.length >= 8 && newPassword === confirmPassword ? 1 : 0.7
                }
              ]}
              textStyle={{ color: COLORS.white }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderBackupModal = () => (
    <Modal
      visible={showBackupModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowBackupModal(false)}
    >
      <View style={styles.modalContainer}>
        <View style={[styles.modalContent, { backgroundColor: theme.background }]}>
          <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
            {t('settings.backupKey')}
          </Text>
          
          <Text style={[styles.modalText, { color: theme.textSecondary }]}>
            {t('settings.backupKeyWarning')}
          </Text>
          
          <View style={[styles.backupKeyContainer, { backgroundColor: theme.surfaceVariant }]}>
            <Text style={[styles.backupKeyText, { color: theme.textPrimary }]}>
              {backupKey}
            </Text>
          </View>
          
          <TouchableOpacity
            style={[styles.copyButton, { backgroundColor: theme.primary }]}
            onPress={() => {
              Clipboard.setString(backupKey);
              Alert.alert(t('settings.copied'), t('settings.keyCopied'));
            }}
          >
            <Text style={[styles.copyButtonText, { color: COLORS.white }]}>
              {t('settings.copyKey')}
            </Text>
          </TouchableOpacity>
          
          <Button
            title={t('common.close')}
            onPress={() => setShowBackupModal(false)}
            style={[styles.modalButton, { backgroundColor: theme.surfaceVariant }]}
            textStyle={{ color: theme.textPrimary }}
          />
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {renderHeader()}
        {renderSectionTabs()}
        {renderSectionContent()}
        {renderFooter()}
      </ScrollView>
      
      {/* Floating action button for critical actions */}
      <TouchableOpacity
        style={[styles.floatingButton, { backgroundColor: theme.primary }]}
        onPress={() => setShowDeleteModal(true)}
      >
        <Text style={[styles.floatingButtonText, { color: COLORS.white }]}>
          {t('settings.deleteAccount')}
        </Text>
      </TouchableOpacity>
      
      {/* Modals */}
      {renderDeleteModal()}
      {renderSecurityModal()}
      {renderBackupModal()}
      
      {/* Loading overlay */}
      {isSaving && (
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingContainer, { backgroundColor: theme.surface }]}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.loadingText, { color: theme.textPrimary }]}>
              {t('common.saving')}
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

// Add missing styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.large,
    paddingVertical: SPACING.medium,
  },
  headerTitle: {
    ...FONTS.largeTitle,
    fontWeight: 'bold',
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: SPACING.small,
  },
  connectionText: {
    ...FONTS.caption,
  },
  sectionTabs: {
    paddingHorizontal: SPACING.small,
    marginBottom: SPACING.medium,
  },
  sectionTab: {
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.small,
    borderRadius: 20,
    marginHorizontal: SPACING.small,
    borderWidth: 1,
  },
  sectionTabText: {
    ...FONTS.body,
  },
  section: {
    paddingHorizontal: SPACING.large,
    paddingVertical: SPACING.medium,
  },
  profileImageContainer: {
    alignSelf: 'center',
    marginBottom: SPACING.large,
    position: 'relative',
  },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  profileImagePlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileImageText: {
    ...FONTS.largeTitle,
    fontWeight: 'bold',
  },
  editImageOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editImageText: {
    fontSize: 18,
  },
  input: {
    marginBottom: SPACING.medium,
  },
  disabledInput: {
    opacity: 0.6,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: SPACING.medium,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    ...FONTS.title,
    fontWeight: 'bold',
  },
  statLabel: {
    ...FONTS.caption,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.medium,
    borderBottomWidth: 1,
  },
  settingInfo: {
    flex: 1,
    paddingRight: SPACING.medium,
  },
  settingTitle: {
    ...FONTS.body,
    fontWeight: '500',
    marginBottom: SPACING.small / 2,
  },
  settingDescription: {
    ...FONTS.caption,
    opacity: 0.8,
  },
  qualityOptions: {
    flexDirection: 'row',
  },
  qualityOption: {
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.small,
    borderRadius: 8,
    marginLeft: SPACING.small,
    borderWidth: 1,
  },
  qualityOptionText: {
    ...FONTS.caption,
    fontWeight: '500',
  },
  sessionOptions: {
    flexDirection: 'row',
  },
  sessionOption: {
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.small,
    borderRadius: 8,
    marginLeft: SPACING.small,
    borderWidth: 1,
  },
  sessionOptionText: {
    ...FONTS.caption,
    fontWeight: '500',
  },
  securityInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.medium,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  securityLabel: {
    ...FONTS.body,
  },
  securityValue: {
    ...FONTS.body,
    fontWeight: '500',
  },
  actionButton: {
    padding: SPACING.medium,
    borderRadius: 8,
    marginTop: SPACING.medium,
    alignItems: 'center',
  },
  actionButtonText: {
    ...FONTS.body,
    fontWeight: '500',
  },
  storageHeader: {
    marginBottom: SPACING.medium,
  },
  storageTitle: {
    ...FONTS.title,
    fontWeight: 'bold',
  },
  storageSubtitle: {
    ...FONTS.body,
  },
  storageProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.large,
  },
  storageProgressTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  storageProgressFill: {
    height: '100%',
  },
  storageProgressText: {
    ...FONTS.caption,
    marginLeft: SPACING.medium,
  },
  storageDetails: {
    marginBottom: SPACING.large,
  },
  storageDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.medium,
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  storageDetailIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.medium,
  },
  storageDetailIconText: {
    fontSize: 18,
  },
  storageDetailTitle: {
    ...FONTS.body,
    fontWeight: '500',
  },
  storageDetailValue: {
    ...FONTS.caption,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.large,
    paddingTop: SPACING.large,
    paddingBottom: SPACING.xxl,
  },
  resetButton: {
    flex: 1,
    marginRight: SPACING.small,
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  saveButton: {
    flex: 1,
    marginLeft: SPACING.small,
  },
  floatingButton: {
    position: 'absolute',
    bottom: SPACING.large,
    right: SPACING.large,
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.small,
    borderRadius: 8,
  },
  floatingButtonText: {
    ...FONTS.body,
    fontWeight: '500',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    marginHorizontal: SPACING.large,
    borderRadius: 12,
    padding: SPACING.large,
  },
  modalTitle: {
    ...FONTS.title,
    fontWeight: 'bold',
    marginBottom: SPACING.medium,
    textAlign: 'center',
  },
  modalText: {
    ...FONTS.body,
    marginBottom: SPACING.medium,
    textAlign: 'center',
  },
  deleteInput: {
    height: 50,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: SPACING.medium,
    marginBottom: SPACING.large,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 1,
    marginHorizontal: SPACING.small,
    paddingVertical: SPACING.medium,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalInput: {
    marginBottom: SPACING.medium,
  },
  backupKeyContainer: {
    padding: SPACING.medium,
    borderRadius: 8,
    marginBottom: SPACING.medium,
  },
  backupKeyText: {
    ...FONTS.body,
    textAlign: 'center',
  },
  copyButton: {
    padding: SPACING.medium,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: SPACING.medium,
  },
  copyButtonText: {
    ...FONTS.body,
    fontWeight: '500',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    padding: SPACING.xl,
    borderRadius: 12,
    alignItems: 'center',
  },
  loadingText: {
    ...FONTS.body,
    marginTop: SPACING.medium,
  },
});

export default SettingsScreen;