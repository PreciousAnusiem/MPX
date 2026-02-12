import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  Dimensions,
  Platform,
  Image,
  Alert,
  Animated,
  BackHandler,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useTheme } from '../store/themeSlice';
import { useDispatch, useSelector } from 'react-redux';
import { setLanguage, selectCurrentLanguage } from '../store/languageSlice';
import { trackEvent } from '../services/analytics';
import NetInfo from '@react-native-community/netinfo';

const { width, height } = Dimensions.get('window');

interface Language {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  region: string;
  rtl: boolean;
  percentage: number; // Translation completion percentage
  offline: boolean; // Available offline
}

const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸', region: 'US', rtl: false, percentage: 100, offline: true },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', region: 'ES', rtl: false, percentage: 95, offline: true },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', region: 'FR', rtl: false, percentage: 92, offline: true },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', region: 'DE', rtl: false, percentage: 88, offline: true },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳', region: 'CN', rtl: false, percentage: 90, offline: true },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', region: 'JP', rtl: false, percentage: 85, offline: true },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷', region: 'KR', rtl: false, percentage: 82, offline: true },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', region: 'SA', rtl: true, percentage: 75, offline: true },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺', region: 'RU', rtl: false, percentage: 78, offline: true },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷', region: 'BR', rtl: false, percentage: 80, offline: true },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹', region: 'IT', rtl: false, percentage: 72, offline: false },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱', region: 'NL', rtl: false, percentage: 68, offline: false },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷', region: 'TR', rtl: false, percentage: 65, offline: false },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳', region: 'IN', rtl: false, percentage: 70, offline: false },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', flag: '🇧🇩', region: 'BD', rtl: false, percentage: 60, offline: false },
];

const STORAGE_KEY = '@ONXLink:selectedLanguage';
const OFFLINE_LANGUAGES_KEY = '@ONXLink:offlineLanguages';

interface LanguageSelectorProps {
  onLanguageChange?: (language: string) => void;
  showModal?: boolean;
  onCloseModal?: () => void;
  compact?: boolean;
  showProgress?: boolean;
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  onLanguageChange,
  showModal = false,
  onCloseModal,
  compact = false,
  showProgress = true,
}) => {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useDispatch();
  const currentLanguage = useSelector(selectCurrentLanguage);
  
  const [modalVisible, setModalVisible] = useState(showModal);
  const [isConnected, setIsConnected] = useState(true);
  const [downloadingLanguages, setDownloadingLanguages] = useState<Set<string>>(new Set());
  const [offlineLanguages, setOfflineLanguages] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(height));

  // Get current language object
  const currentLangObj = useMemo(() => 
    LANGUAGES.find(lang => lang.code === currentLanguage) || LANGUAGES[0], 
    [currentLanguage]
  );

  // Filter languages based on search
  const filteredLanguages = useMemo(() => {
    if (!searchQuery.trim()) return LANGUAGES;
    
    const query = searchQuery.toLowerCase();
    return LANGUAGES.filter(lang => 
      lang.name.toLowerCase().includes(query) ||
      lang.nativeName.toLowerCase().includes(query) ||
      lang.code.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  // Group languages by region for better UX
  const groupedLanguages = useMemo(() => {
    const groups: { [key: string]: Language[] } = {};
    
    filteredLanguages.forEach(lang => {
      const region = getRegionName(lang.region);
      if (!groups[region]) groups[region] = [];
      groups[region].push(lang);
    });
    
    return groups;
  }, [filteredLanguages]);

  useEffect(() => {
    initializeLanguageSettings();
    setupNetworkListener();
    loadOfflineLanguages();
    
    // Android back button handler
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    
    return () => {
      backHandler.remove();
    };
  }, []);

  useEffect(() => {
    setModalVisible(showModal);
    if (showModal) {
      showModalAnimation();
    }
  }, [showModal]);

  const initializeLanguageSettings = async () => {
    try {
      const savedLanguage = await AsyncStorage.getItem(STORAGE_KEY);
      const deviceLanguage = Platform.OS === 'ios' 
        ? NativeModules.SettingsManager.settings.AppleLocale ||
          NativeModules.SettingsManager.settings.AppleLanguages[0]
        : NativeModules.I18nManager.localeIdentifier;
      
      const langCode = savedLanguage || detectLanguageFromDevice(deviceLanguage) || 'en';
      
      if (langCode !== currentLanguage) {
        await changeLanguage(langCode, false);
      }
    } catch (error) {
      console.warn('Failed to initialize language settings:', error);
      // Fallback to English
      await changeLanguage('en', false);
    }
  };

  const setupNetworkListener = () => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected ?? false);
    });
    
    return unsubscribe;
  };

  const loadOfflineLanguages = async () => {
    try {
      const saved = await AsyncStorage.getItem(OFFLINE_LANGUAGES_KEY);
      if (saved) {
        setOfflineLanguages(new Set(JSON.parse(saved)));
      }
    } catch (error) {
      console.warn('Failed to load offline languages:', error);
    }
  };

  const saveOfflineLanguages = async (languages: Set<string>) => {
    try {
      await AsyncStorage.setItem(OFFLINE_LANGUAGES_KEY, JSON.stringify([...languages]));
      setOfflineLanguages(languages);
    } catch (error) {
      console.warn('Failed to save offline languages:', error);
    }
  };

  const detectLanguageFromDevice = (locale: string): string => {
    if (!locale) return 'en';
    
    const langCode = locale.split(/[-_]/)[0].toLowerCase();
    const supportedLang = LANGUAGES.find(lang => lang.code === langCode);
    
    return supportedLang ? langCode : 'en';
  };

  const getRegionName = (regionCode: string): string => {
    const regions: { [key: string]: string } = {
      'US': 'North America',
      'ES': 'Europe',
      'FR': 'Europe',
      'DE': 'Europe',
      'CN': 'Asia',
      'JP': 'Asia',
      'KR': 'Asia',
      'SA': 'Middle East',
      'RU': 'Europe',
      'BR': 'South America',
      'IT': 'Europe',
      'NL': 'Europe',
      'TR': 'Europe/Asia',
      'IN': 'Asia',
      'BD': 'Asia',
    };
    
    return regions[regionCode] || 'Other';
  };

  const handleBackPress = (): boolean => {
    if (modalVisible) {
      closeModal();
      return true;
    }
    return false;
  };

  const showModalAnimation = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 100,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const hideModalAnimation = (callback: () => void) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: height,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(callback);
  };

  const openModal = () => {
    setModalVisible(true);
    showModalAnimation();
    trackEvent('language_selector_opened');
  };

  const closeModal = () => {
    hideModalAnimation(() => {
      setModalVisible(false);
      setSearchQuery('');
      onCloseModal?.();
    });
  };

  const changeLanguage = async (langCode: string, trackAnalytics: boolean = true) => {
    try {
      const language = LANGUAGES.find(lang => lang.code === langCode);
      if (!language) throw new Error(`Language ${langCode} not supported`);

      // Check if language is available offline when not connected
      if (!isConnected && !language.offline && !offlineLanguages.has(langCode)) {
        Alert.alert(
          t('language.offline_unavailable_title'),
          t('language.offline_unavailable_message', { language: language.nativeName }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { 
              text: t('language.download_when_online'), 
              onPress: () => scheduleLanguageDownload(langCode) 
            }
          ]
        );
        return;
      }

      // Show loading for languages that need download
      if (!language.offline && !offlineLanguages.has(langCode)) {
        setDownloadingLanguages(prev => new Set(prev.add(langCode)));
        
        try {
          await downloadLanguageResources(langCode);
          const newOfflineLanguages = new Set(offlineLanguages);
          newOfflineLanguages.add(langCode);
          await saveOfflineLanguages(newOfflineLanguages);
        } catch (error) {
          setDownloadingLanguages(prev => {
            const newSet = new Set(prev);
            newSet.delete(langCode);
            return newSet;
          });
          
          Alert.alert(
            t('language.download_failed_title'),
            t('language.download_failed_message'),
            [{ text: t('common.ok') }]
          );
          return;
        }
        
        setDownloadingLanguages(prev => {
          const newSet = new Set(prev);
          newSet.delete(langCode);
          return newSet;
        });
      }

      // Change language in i18next
      await i18n.changeLanguage(langCode);
      
      // Update Redux store
      dispatch(setLanguage(langCode));
      
      // Save to AsyncStorage
      await AsyncStorage.setItem(STORAGE_KEY, langCode);
      
      // Update RTL layout for Arabic
      if (Platform.OS === 'ios') {
        const isRTL = language.rtl;
        // Handle RTL layout changes
        if (isRTL !== currentLangObj.rtl) {
          Alert.alert(
            t('language.restart_required_title'),
            t('language.restart_required_message'),
            [{ text: t('common.ok') }]
          );
        }
      }
      
      // Analytics tracking
      if (trackAnalytics) {
        trackEvent('language_changed', {
          from_language: currentLanguage,
          to_language: langCode,
          language_name: language.nativeName,
          is_offline: !isConnected,
        });
      }
      
      // Callback
      onLanguageChange?.(langCode);
      
      // Close modal
      closeModal();
      
    } catch (error) {
      console.error('Failed to change language:', error);
      Alert.alert(
        t('language.change_failed_title'),
        t('language.change_failed_message'),
        [{ text: t('common.ok') }]
      );
    }
  };

  const downloadLanguageResources = async (langCode: string): Promise<void> => {
    // Simulate language resource download
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        // In real implementation, this would download translation files
        // from your CDN or API endpoint
        const random = Math.random();
        if (random > 0.1) { // 90% success rate
          resolve();
        } else {
          reject(new Error('Download failed'));
        }
      }, 2000);
    });
  };

  const scheduleLanguageDownload = (langCode: string) => {
    // This would typically save to a queue for later download
    // when the user comes back online
    trackEvent('language_download_scheduled', { language: langCode });
  };

  const renderLanguageItem = (language: Language) => {
    const isSelected = language.code === currentLanguage;
    const isDownloading = downloadingLanguages.has(language.code);
    const isOfflineAvailable = language.offline || offlineLanguages.has(language.code);
    const showOfflineIndicator = !isConnected && !isOfflineAvailable;
    
    return (
      <TouchableOpacity
        key={language.code}
        style={[
          styles.languageItem,
          { backgroundColor: theme.colors.surface },
          isSelected && { backgroundColor: theme.colors.primary + '20' },
          showOfflineIndicator && { opacity: 0.5 },
        ]}
        onPress={() => changeLanguage(language.code)}
        disabled={isDownloading || showOfflineIndicator}
        accessibilityLabel={`${language.nativeName} - ${language.name}`}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected, disabled: showOfflineIndicator }}
      >
        <View style={styles.languageItemLeft}>
          <Text style={[styles.flag, { fontSize: compact ? 20 : 24 }]}>
            {language.flag}
          </Text>
          <View style={styles.languageInfo}>
            <Text 
              style={[
                styles.languageName, 
                { color: theme.colors.text },
                language.rtl && { textAlign: 'right' }
              ]}
              numberOfLines={1}
            >
              {language.nativeName}
            </Text>
            <Text 
              style={[
                styles.languageNameEn, 
                { color: theme.colors.textSecondary }
              ]}
              numberOfLines={1}
            >
              {language.name}
            </Text>
            {showProgress && language.percentage < 100 && (
              <View style={styles.progressContainer}>
                <View 
                  style={[
                    styles.progressBar,
                    { backgroundColor: theme.colors.border }
                  ]}
                >
                  <View 
                    style={[
                      styles.progressFill,
                      { 
                        width: `${language.percentage}%`,
                        backgroundColor: theme.colors.primary
                      }
                    ]}
                  />
                </View>
                <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
                  {language.percentage}%
                </Text>
              </View>
            )}
          </View>
        </View>
        
        <View style={styles.languageItemRight}>
          {!isConnected && !isOfflineAvailable && (
            <Icon 
              name="cloud-off" 
              size={16} 
              color={theme.colors.textSecondary} 
              style={{ marginRight: 8 }}
            />
          )}
          {isOfflineAvailable && (
            <Icon 
              name="offline-pin" 
              size={16} 
              color={theme.colors.primary} 
              style={{ marginRight: 8 }}
            />
          )}
          {isDownloading ? (
            <View style={styles.loadingContainer}>
              <Animated.View 
                style={[
                  styles.loadingSpinner,
                  { borderTopColor: theme.colors.primary }
                ]}
              />
            </View>
          ) : isSelected ? (
            <Icon name="check" size={20} color={theme.colors.primary} />
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const renderLanguageGroup = (regionName: string, languages: Language[]) => (
    <View key={regionName} style={styles.languageGroup}>
      <Text style={[styles.groupHeader, { color: theme.colors.textSecondary }]}>
        {regionName}
      </Text>
      {languages.map(renderLanguageItem)}
    </View>
  );

  if (compact) {
    return (
      <TouchableOpacity 
        style={[styles.compactSelector, { backgroundColor: theme.colors.surface }]}
        onPress={openModal}
        accessibilityLabel={t('language.selector_accessibility')}
        accessibilityRole="button"
      >
        <Text style={styles.compactFlag}>{currentLangObj.flag}</Text>
        <Text style={[styles.compactText, { color: theme.colors.text }]}>
          {currentLangObj.code.toUpperCase()}
        </Text>
        <Icon name="arrow-drop-down" size={16} color={theme.colors.textSecondary} />
      </TouchableOpacity>
    );
  }

  return (
    <>
      <TouchableOpacity 
        style={[styles.selector, { backgroundColor: theme.colors.surface }]}
        onPress={openModal}
        accessibilityLabel={t('language.selector_accessibility')}
        accessibilityRole="button"
      >
        <Text style={styles.flag}>{currentLangObj.flag}</Text>
        <View style={styles.selectorInfo}>
          <Text style={[styles.selectorText, { color: theme.colors.text }]}>
            {currentLangObj.nativeName}
          </Text>
          <Text style={[styles.selectorSubtext, { color: theme.colors.textSecondary }]}>
            {currentLangObj.name}
          </Text>
        </View>
        <Icon name="arrow-drop-down" size={24} color={theme.colors.textSecondary} />
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="none"
        onRequestClose={closeModal}
        statusBarTranslucent={true}
      >
        <Animated.View 
          style={[
            styles.modalOverlay,
            { opacity: fadeAnim }
          ]}
        >
          <TouchableOpacity 
            style={styles.modalBackdrop} 
            onPress={closeModal}
            activeOpacity={1}
          />
          
          <Animated.View 
            style={[
              styles.modalContent,
              { 
                backgroundColor: theme.colors.background,
                transform: [{ translateY: slideAnim }]
              }
            ]}
          >
            <View style={[styles.modalHeader, { borderBottomColor: theme.colors.border }]}>
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                {t('language.select_language')}
              </Text>
              <TouchableOpacity 
                style={styles.closeButton}
                onPress={closeModal}
                accessibilityLabel={t('common.close')}
                accessibilityRole="button"
              >
                <Icon name="close" size={24} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            
            {!isConnected && (
              <View style={[styles.offlineNotice, { backgroundColor: theme.colors.warning + '20' }]}>
                <Icon name="cloud-off" size={16} color={theme.colors.warning} />
                <Text style={[styles.offlineText, { color: theme.colors.warning }]}>
                  {t('language.offline_mode')}
                </Text>
              </View>
            )}

            <ScrollView 
              style={styles.languageList}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {Object.entries(groupedLanguages).map(([region, languages]) =>
                renderLanguageGroup(region, languages)
              )}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 56,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  compactSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 40,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  flag: {
    fontSize: 24,
    marginRight: 12,
  },
  compactFlag: {
    fontSize: 18,
    marginRight: 8,
  },
  selectorInfo: {
    flex: 1,
  },
  selectorText: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
  selectorSubtext: {
    fontSize: 14,
    lineHeight: 18,
    marginTop: 2,
  },
  compactText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalBackdrop: {
    flex: 1,
  },
  modalContent: {
    height: height * 0.8,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
  },
  closeButton: {
    padding: 4,
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 8,
  },
  offlineText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  languageList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  languageGroup: {
    marginBottom: 24,
  },
  groupHeader: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginTop: 16,
    marginLeft: 8,
  },
  languageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  languageItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  languageInfo: {
    flex: 1,
    marginLeft: 12,
  },
  languageName: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
  languageNameEn: {
    fontSize: 14,
    lineHeight: 18,
    marginTop: 2,
  },
  languageItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    flex: 1,
    marginRight: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '500',
    minWidth: 35,
  },
  loadingContainer: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingSpinner: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderRadius: 8,
    borderColor: 'transparent',
    borderTopWidth: 2,
  },
});

export default LanguageSelector;