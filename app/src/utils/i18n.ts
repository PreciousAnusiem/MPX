import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager, Platform } from 'react-native';
import RNRestart from 'react-native-restart';

// Language type definitions
export interface LanguageConfig {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  rtl: boolean;
  pluralRules: PluralRule[];
  dateFormat: string;
  numberFormat: Intl.NumberFormatOptions;
  currencyFormat: Intl.NumberFormatOptions;
}

interface PluralRule {
  count: number;
  key: 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
}

interface TranslationKeys {
  [key: string]: string | TranslationKeys;
}

interface InterpolationParams {
  [key: string]: string | number;
}

// Supported languages configuration
export const SUPPORTED_LANGUAGES: Record<string, LanguageConfig> = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🇺🇸',
    rtl: false,
    pluralRules: [
      { count: 1, key: 'one' },
      { count: 0, key: 'other' }
    ],
    dateFormat: 'MM/dd/yyyy',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'USD' }
  },
  es: {
    code: 'es',
    name: 'Spanish',
    nativeName: 'Español',
    flag: '🇪🇸',
    rtl: false,
    pluralRules: [
      { count: 1, key: 'one' },
      { count: 0, key: 'other' }
    ],
    dateFormat: 'dd/MM/yyyy',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'EUR' }
  },
  fr: {
    code: 'fr',
    name: 'French',
    nativeName: 'Français',
    flag: '🇫🇷',
    rtl: false,
    pluralRules: [
      { count: 1, key: 'one' },
      { count: 0, key: 'other' }
    ],
    dateFormat: 'dd/MM/yyyy',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'EUR' }
  },
  de: {
    code: 'de',
    name: 'German',
    nativeName: 'Deutsch',
    flag: '🇩🇪',
    rtl: false,
    pluralRules: [
      { count: 1, key: 'one' },
      { count: 0, key: 'other' }
    ],
    dateFormat: 'dd.MM.yyyy',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'EUR' }
  },
  zh: {
    code: 'zh',
    name: 'Chinese',
    nativeName: '中文',
    flag: '🇨🇳',
    rtl: false,
    pluralRules: [{ count: 0, key: 'other' }],
    dateFormat: 'yyyy/MM/dd',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'CNY' }
  },
  ja: {
    code: 'ja',
    name: 'Japanese',
    nativeName: '日本語',
    flag: '🇯🇵',
    rtl: false,
    pluralRules: [{ count: 0, key: 'other' }],
    dateFormat: 'yyyy/MM/dd',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'JPY' }
  },
  ko: {
    code: 'ko',
    name: 'Korean',
    nativeName: '한국어',
    flag: '🇰🇷',
    rtl: false,
    pluralRules: [{ count: 0, key: 'other' }],
    dateFormat: 'yyyy. MM. dd.',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'KRW' }
  },
  ar: {
    code: 'ar',
    name: 'Arabic',
    nativeName: 'العربية',
    flag: '🇸🇦',
    rtl: true,
    pluralRules: [
      { count: 0, key: 'zero' },
      { count: 1, key: 'one' },
      { count: 2, key: 'two' },
      { count: 3, key: 'few' },
      { count: 11, key: 'many' },
      { count: 100, key: 'other' }
    ],
    dateFormat: 'dd/MM/yyyy',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'SAR' }
  },
  ru: {
    code: 'ru',
    name: 'Russian',
    nativeName: 'Русский',
    flag: '🇷🇺',
    rtl: false,
    pluralRules: [
      { count: 1, key: 'one' },
      { count: 2, key: 'few' },
      { count: 5, key: 'many' },
      { count: 0, key: 'other' }
    ],
    dateFormat: 'dd.MM.yyyy',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'RUB' }
  },
  pt: {
    code: 'pt',
    name: 'Portuguese',
    nativeName: 'Português',
    flag: '🇧🇷',
    rtl: false,
    pluralRules: [
      { count: 1, key: 'one' },
      { count: 0, key: 'other' }
    ],
    dateFormat: 'dd/MM/yyyy',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'BRL' }
  },
  it: {
    code: 'it',
    name: 'Italian',
    nativeName: 'Italiano',
    flag: '🇮🇹',
    rtl: false,
    pluralRules: [
      { count: 1, key: 'one' },
      { count: 0, key: 'other' }
    ],
    dateFormat: 'dd/MM/yyyy',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'EUR' }
  },
  nl: {
    code: 'nl',
    name: 'Dutch',
    nativeName: 'Nederlands',
    flag: '🇳🇱',
    rtl: false,
    pluralRules: [
      { count: 1, key: 'one' },
      { count: 0, key: 'other' }
    ],
    dateFormat: 'dd-MM-yyyy',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'EUR' }
  },
  tr: {
    code: 'tr',
    name: 'Turkish',
    nativeName: 'Türkçe',
    flag: '🇹🇷',
    rtl: false,
    pluralRules: [
      { count: 1, key: 'one' },
      { count: 0, key: 'other' }
    ],
    dateFormat: 'dd.MM.yyyy',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'TRY' }
  },
  hi: {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    flag: '🇮🇳',
    rtl: false,
    pluralRules: [
      { count: 1, key: 'one' },
      { count: 0, key: 'other' }
    ],
    dateFormat: 'dd/MM/yyyy',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'INR' }
  },
  bn: {
    code: 'bn',
    name: 'Bengali',
    nativeName: 'বাংলা',
    flag: '🇧🇩',
    rtl: false,
    pluralRules: [
      { count: 1, key: 'one' },
      { count: 0, key: 'other' }
    ],
    dateFormat: 'dd/MM/yyyy',
    numberFormat: { useGrouping: true },
    currencyFormat: { style: 'currency', currency: 'BDT' }
  }
};

// Offline translation cache
class OfflineTranslationCache {
  private cache: Map<string, TranslationKeys> = new Map();
  private readonly CACHE_KEY = '@ONXLink_i18n_cache';
  private readonly CACHE_VERSION_KEY = '@ONXLink_i18n_version';
  private readonly CURRENT_VERSION = '1.0.0';

  async initialize(): Promise<void> {
    try {
      const cachedVersion = await AsyncStorage.getItem(this.CACHE_VERSION_KEY);
      const cachedData = await AsyncStorage.getItem(this.CACHE_KEY);
      
      if (cachedVersion === this.CURRENT_VERSION && cachedData) {
        const parsedCache = JSON.parse(cachedData);
        this.cache = new Map(Object.entries(parsedCache));
      } else {
        await this.loadDefaultTranslations();
        await this.saveCache();
      }
    } catch (error) {
      console.error('Failed to initialize translation cache:', error);
      await this.loadDefaultTranslations();
    }
  }

  private async loadDefaultTranslations(): Promise<void> {
    // Load essential translations for offline use
    const defaultTranslations = {
      en: await import('../assets/locales/en.json'),
      es: await import('../assets/locales/es.json'),
      fr: await import('../assets/locales/fr.json'),
      de: await import('../assets/locales/de.json'),
      zh: await import('../assets/locales/zh.json'),
      ja: await import('../assets/locales/ja.json'),
      ko: await import('../assets/locales/ko.json'),
      ar: await import('../assets/locales/ar.json'),
      ru: await import('../assets/locales/ru.json'),
      pt: await import('../assets/locales/pt.json'),
      it: await import('../assets/locales/it.json'),
      nl: await import('../assets/locales/nl.json'),
      tr: await import('../assets/locales/tr.json'),
      hi: await import('../assets/locales/hi.json'),
      bn: await import('../assets/locales/bn.json'),
    };

    for (const [lang, translations] of Object.entries(defaultTranslations)) {
      this.cache.set(lang, translations.default || translations);
    }
  }

  async saveCache(): Promise<void> {
    try {
      const cacheObject = Object.fromEntries(this.cache.entries());
      await AsyncStorage.multiSet([
        [this.CACHE_KEY, JSON.stringify(cacheObject)],
        [this.CACHE_VERSION_KEY, this.CURRENT_VERSION]
      ]);
    } catch (error) {
      console.warn('Failed to save translation cache:', error);
    }
  }

  getTranslations(language: string): TranslationKeys | null {
    return this.cache.get(language) || null;
  }

  updateTranslations(language: string, translations: TranslationKeys): void {
    this.cache.set(language, { ...this.cache.get(language), ...translations });
    this.saveCache();
  }
}

// Main I18n class
class I18nManager {
  private currentLanguage: string = 'en';
  private currentConfig: LanguageConfig = SUPPORTED_LANGUAGES.en;
  private translations: TranslationKeys = {};
  private fallbackTranslations: TranslationKeys = {};
  private cache = new OfflineTranslationCache();
  private listeners: Set<(language: string) => void> = new Set();
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.cache.initialize();
      
      // Load saved language preference
      const savedLanguage = await AsyncStorage.getItem('@ONXLink_language');
      const systemLanguage = this.getSystemLanguage();
      
      this.currentLanguage = savedLanguage || systemLanguage;
      this.currentConfig = SUPPORTED_LANGUAGES[this.currentLanguage] || SUPPORTED_LANGUAGES.en;
      
      await this.loadTranslations(this.currentLanguage);
      await this.loadFallbackTranslations();
      
      // Set RTL configuration
      I18nManager.forceRTL(this.currentConfig.rtl);
      I18nManager.allowRTL(this.currentConfig.rtl);
      
      this.isInitialized = true;
    } catch (error) {
      console.error('I18n initialization failed:', error);
      this.currentLanguage = 'en';
      this.currentConfig = SUPPORTED_LANGUAGES.en;
      await this.loadTranslations('en');
    }
  }

  private getSystemLanguage(): string {
    try {
      const systemLocale = Platform.select({
        ios: () => {
          const locale = require('react-native').NativeModules.SettingsManager?.settings?.AppleLocale;
          return locale?.split('_')[0] || 'en';
        },
        android: () => {
          const locale = require('react-native').NativeModules.I18nManager?.localeIdentifier;
          return locale?.split('_')[0] || 'en';
        },
        default: () => 'en'
      })();

      return SUPPORTED_LANGUAGES[systemLocale] ? systemLocale : 'en';
    } catch {
      return 'en';
    }
  }

  private async loadTranslations(language: string): Promise<void> {
    try {
      // Try to load from cache first (offline support)
      const cachedTranslations = this.cache.getTranslations(language);
      if (cachedTranslations) {
        this.translations = cachedTranslations;
        return;
      }

      // Fallback to bundled translations
      const translations = await import(`../assets/locales/${language}.json`);
      this.translations = translations.default || translations;
      
      // Cache for offline use
      this.cache.updateTranslations(language, this.translations);
    } catch (error) {
      console.warn(`Failed to load translations for ${language}:`, error);
      // Use fallback language
      if (language !== 'en') {
        await this.loadTranslations('en');
      }
    }
  }

  private async loadFallbackTranslations(): Promise<void> {
    if (this.currentLanguage === 'en') return;

    try {
      const fallback = this.cache.getTranslations('en');
      if (fallback) {
        this.fallbackTranslations = fallback;
      } else {
        const translations = await import('../assets/locales/en.json');
        this.fallbackTranslations = translations.default || translations;
      }
    } catch (error) {
      console.warn('Failed to load fallback translations:', error);
    }
  }

  async changeLanguage(language: string): Promise<void> {
    if (!SUPPORTED_LANGUAGES[language]) {
      throw new Error(`Unsupported language: ${language}`);
    }

    const previousLanguage = this.currentLanguage;
    const wasRTL = this.currentConfig.rtl;
    
    this.currentLanguage = language;
    this.currentConfig = SUPPORTED_LANGUAGES[language];
    
    await this.loadTranslations(language);
    await AsyncStorage.setItem('@ONXLink_language', language);
    
    // Handle RTL changes
    const isNowRTL = this.currentConfig.rtl;
    if (wasRTL !== isNowRTL) {
      I18nManager.forceRTL(isNowRTL);
      I18nManager.allowRTL(isNowRTL);
      
      if (Platform.OS !== 'web') {
        // Restart app for RTL changes to take effect
        setTimeout(() => RNRestart.Restart(), 100);
        return;
      }
    }
    
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.currentLanguage);
      } catch (error) {
        console.warn('Language change listener error:', error);
      }
    });
  }

  addLanguageChangeListener(listener: (language: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  t(key: string, params?: InterpolationParams, count?: number): string {
    if (!this.isInitialized) {
      console.warn('I18n not initialized, returning key:', key);
      return key;
    }

    try {
      let translation = this.getNestedTranslation(key, this.translations);
      
      // Fallback to English if translation not found
      if (!translation && this.currentLanguage !== 'en') {
        translation = this.getNestedTranslation(key, this.fallbackTranslations);
      }
      
      // Final fallback to key itself
      if (!translation) {
        console.warn(`Translation missing for key: ${key}`);
        return key;
      }

      // Handle pluralization
      if (count !== undefined && typeof translation === 'object') {
        const pluralKey = this.getPluralKey(count);
        translation = translation[pluralKey] || translation.other || translation.one || '';
      }

      // Handle interpolation
      if (typeof translation === 'string' && params) {
        return this.interpolate(translation, params);
      }

      return typeof translation === 'string' ? translation : key;
    } catch (error) {
      console.error(`Translation error for key ${key}:`, error);
      return key;
    }
  }

  private getNestedTranslation(key: string, translations: TranslationKeys): any {
    return key.split('.').reduce((obj, k) => {
      return obj && typeof obj === 'object' ? obj[k] : undefined;
    }, translations);
  }

  private getPluralKey(count: number): string {
    const rules = this.currentConfig.pluralRules;
    
    for (const rule of rules) {
      switch (rule.key) {
        case 'zero':
          if (count === 0) return 'zero';
          break;
        case 'one':
          if (count === 1) return 'one';
          break;
        case 'two':
          if (count === 2) return 'two';
          break;
        case 'few':
          if (count >= 3 && count <= 10) return 'few';
          break;
        case 'many':
          if (count >= 11 && count <= 99) return 'many';
          break;
      }
    }
    
    return 'other';
  }

  private interpolate(template: string, params: InterpolationParams): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = params[key];
      return value !== undefined ? String(value) : match;
    });
  }

  // Utility methods
  getCurrentLanguage(): string {
    return this.currentLanguage;
  }

  getCurrentConfig(): LanguageConfig {
    return this.currentConfig;
  }

  getSupportedLanguages(): LanguageConfig[] {
    return Object.values(SUPPORTED_LANGUAGES);
  }

  isRTL(): boolean {
    return this.currentConfig.rtl;
  }

  formatDate(date: Date): string {
    try {
      return new Intl.DateTimeFormat(this.currentLanguage, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date);
    } catch {
      return date.toLocaleDateString();
    }
  }

  formatNumber(number: number): string {
    try {
      return new Intl.NumberFormat(this.currentLanguage, this.currentConfig.numberFormat).format(number);
    } catch {
      return number.toString();
    }
  }

  formatCurrency(amount: number, currency?: string): string {
    try {
      const options = { ...this.currentConfig.currencyFormat };
      if (currency) options.currency = currency;
      
      return new Intl.NumberFormat(this.currentLanguage, options).format(amount);
    } catch {
      return `${currency || '$'}${amount}`;
    }
  }

  formatRelativeTime(date: Date): string {
    try {
      const now = new Date();
      const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
      
      const rtf = new Intl.RelativeTimeFormat(this.currentLanguage, { numeric: 'auto' });
      
      if (diffInSeconds < 60) {
        return rtf.format(-diffInSeconds, 'second');
      } else if (diffInSeconds < 3600) {
        return rtf.format(-Math.floor(diffInSeconds / 60), 'minute');
      } else if (diffInSeconds < 86400) {
        return rtf.format(-Math.floor(diffInSeconds / 3600), 'hour');
      } else {
        return rtf.format(-Math.floor(diffInSeconds / 86400), 'day');
      }
    } catch {
      return this.formatDate(date);
    }
  }

  // Smart content localization for AI-generated content
  async localizeContent(content: string, targetLanguage?: string): Promise<string> {
    const lang = targetLanguage || this.currentLanguage;
    
    if (lang === 'en') return content;
    
    try {
      // Use offline content adaptation rules
      const adaptationRules = await this.getContentAdaptationRules(lang);
      return this.applyContentAdaptation(content, adaptationRules);
    } catch (error) {
      console.warn('Content localization failed:', error);
      return content;
    }
  }

  private async getContentAdaptationRules(language: string): Promise<any> {
    // Load cached adaptation rules for offline content localization
    const cacheKey = `@ONXLink_adaptation_${language}`;
    try {
      const cached = await AsyncStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  }

  private applyContentAdaptation(content: string, rules: any): string {
    // Apply offline content adaptation rules
    let adapted = content;
    
    if (rules.replacements) {
      for (const [pattern, replacement] of Object.entries(rules.replacements)) {
        adapted = adapted.replace(new RegExp(pattern, 'gi'), replacement as string);
      }
    }
    
    return adapted;
  }

  // Cultural sensitivity checking (offline)
  checkCulturalSensitivity(content: string): { sensitive: boolean; issues: string[] } {
    const issues: string[] = [];
    const config = this.currentConfig;
    
    // Load cached cultural sensitivity rules
    const sensitivePatterns = this.getCachedSensitivityPatterns(config.code);
    
    for (const pattern of sensitivePatterns) {
      if (new RegExp(pattern.regex, 'i').test(content)) {
        issues.push(pattern.issue);
      }
    }
    
    return {
      sensitive: issues.length > 0,
      issues
    };
  }

  private getCachedSensitivityPatterns(language: string): Array<{regex: string; issue: string}> {
    // Return cached cultural sensitivity patterns for offline checking
    const patterns: Record<string, Array<{regex: string; issue: string}>> = {
      ar: [
        { regex: '\\b(alcohol|beer|wine)\\b', issue: 'alcohol_reference' },
        { regex: '\\b(pork|bacon|ham)\\b', issue: 'pork_reference' }
      ],
      hi: [
        { regex: '\\b(beef|cow)\\b', issue: 'beef_reference' }
      ],
      // Add more patterns for other languages
    };
    
    return patterns[language] || [];
  }
}

// Create singleton instance
const i18n = new I18nManager();

// Export instance and utilities
export default i18n;

export const t = (key: string, params?: InterpolationParams, count?: number): string => 
  i18n.t(key, params, count);

export const changeLanguage = (language: string): Promise<void> => 
  i18n.changeLanguage(language);

export const getCurrentLanguage = (): string => 
  i18n.getCurrentLanguage();

export const getSupportedLanguages = (): LanguageConfig[] => 
  i18n.getSupportedLanguages();

export const isRTL = (): boolean => 
  i18n.isRTL();

export const formatDate = (date: Date): string => 
  i18n.formatDate(date);

export const formatNumber = (number: number): string => 
  i18n.formatNumber(number);

export const formatCurrency = (amount: number, currency?: string): string => 
  i18n.formatCurrency(amount, currency);

export const formatRelativeTime = (date: Date): string => 
  i18n.formatRelativeTime(date);

export const addLanguageChangeListener = (listener: (language: string) => void): (() => void) => 
  i18n.addLanguageChangeListener(listener);

export const localizeContent = (content: string, targetLanguage?: string): Promise<string> => 
  i18n.localizeContent(content, targetLanguage);

export const checkCulturalSensitivity = (content: string): { sensitive: boolean; issues: string[] } => 
  i18n.checkCulturalSensitivity(content);

// Initialize on import
i18n.initialize().catch(error => {
  console.error('Failed to initialize i18n:', error);
});