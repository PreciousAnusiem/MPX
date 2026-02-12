import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  TextInput,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  ViewStyle,
  TextStyle,
  KeyboardTypeOptions,
  ReturnKeyTypeOptions,
  TextInputProps,
  AccessibilityInfo,
} from 'react-native';
import { useSelector } from 'react-redux';
import CryptoJS from 'crypto-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';

import { RootState } from '../store';
import { useI18n } from '../utils/i18n';
import { validateInput, sanitizeInput, encryptSensitiveData } from '../utils/security';
import { hapticFeedback, playSuccessSound } from '../utils/accessibility';
import { logSecureEvent } from '../utils/analytics';

export interface InputRef {
  focus: () => void;
  blur: () => void;
  clear: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
  validate: () => boolean;
  getEncryptedValue: () => string;
}

interface InputProps extends Omit<TextInputProps, 'style' | 'onChangeText' | 'value'> {
  // Core Props
  label?: string;
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string, isValid: boolean) => void;
  
  // Validation & Security
  validationType?: 'email' | 'password' | 'phone' | 'name' | 'text' | 'url' | 'number' | 'none';
  isRequired?: boolean;
  minLength?: number;
  maxLength?: number;
  customValidator?: (value: string) => { isValid: boolean; message?: string };
  encryptValue?: boolean;
  storageKey?: string; // For offline persistence
  
  // UI Customization
  variant?: 'default' | 'outlined' | 'filled' | 'underlined';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  leftIcon?: string;
  rightIcon?: string;
  showCharacterCount?: boolean;
  
  // Enhanced Features
  autoSave?: boolean;
  debounceMs?: number;
  showSuccessIndicator?: boolean;
  allowOfflineEdit?: boolean;
  
  // Accessibility
  helpText?: string;
  errorMessage?: string;
  successMessage?: string;
  testID?: string;
  
  // Events
  onFocus?: () => void;
  onBlur?: () => void;
  onValidationChange?: (isValid: boolean, message?: string) => void;
  onRightIconPress?: () => void;
  onLeftIconPress?: () => void;
  
  // Styling
  containerStyle?: ViewStyle;
  inputStyle?: TextStyle;
  labelStyle?: TextStyle;
}

const Input = forwardRef<InputRef, InputProps>(({
  // Core Props
  label,
  placeholder,
  value: externalValue,
  onChangeText,
  
  // Validation & Security
  validationType = 'text',
  isRequired = false,
  minLength,
  maxLength,
  customValidator,
  encryptValue = false,
  storageKey,
  
  // UI Customization
  variant = 'default',
  size = 'medium',
  disabled = false,
  leftIcon,
  rightIcon,
  showCharacterCount = false,
  
  // Enhanced Features
  autoSave = false,
  debounceMs = 300,
  showSuccessIndicator = false,
  allowOfflineEdit = true,
  
  // Accessibility
  helpText,
  errorMessage: externalErrorMessage,
  successMessage,
  testID,
  
  // Events
  onFocus,
  onBlur,
  onValidationChange,
  onRightIconPress,
  onLeftIconPress,
  
  // Styling
  containerStyle,
  inputStyle,
  labelStyle,
  
  // TextInput Props
  keyboardType,
  returnKeyType = 'done',
  secureTextEntry,
  multiline = false,
  numberOfLines,
  ...textInputProps
}, ref) => {
  // State Management
  const [internalValue, setInternalValue] = useState(externalValue || '');
  const [isFocused, setIsFocused] = useState(false);
  const [isValid, setIsValid] = useState(true);
  const [validationMessage, setValidationMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [offlineValue, setOfflineValue] = useState('');
  const [hasOfflineChanges, setHasOfflineChanges] = useState(false);
  
  // Redux & Context
  const theme = useSelector((state: RootState) => state.theme.currentTheme);
  const isOffline = useSelector((state: RootState) => state.network.isOffline);
  const userTier = useSelector((state: RootState) => state.user.subscriptionTier);
  const { t } = useI18n();
  
  // Refs & Animations
  const inputRef = useRef<TextInput>(null);
  const labelAnimation = useRef(new Animated.Value(externalValue ? 1 : 0)).current;
  const borderAnimation = useRef(new Animated.Value(0)).current;
  const debounceRef = useRef<NodeJS.Timeout>();
  const validationRef = useRef<NodeJS.Timeout>();
  
  // Get current value (external or internal)
  const currentValue = externalValue !== undefined ? externalValue : internalValue;
  const displayValue = isOffline && hasOfflineChanges ? offlineValue : currentValue;
  
  // Load offline data on mount
  useEffect(() => {
    if (storageKey && allowOfflineEdit) {
      loadOfflineData();
    }
  }, [storageKey]);
  
  // Sync external value changes
  useEffect(() => {
    if (externalValue !== undefined && externalValue !== internalValue) {
      setInternalValue(externalValue);
      animateLabel(externalValue.length > 0);
    }
  }, [externalValue]);
  
  // Auto-save functionality
  useEffect(() => {
    if (autoSave && storageKey && currentValue) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        saveToStorage(currentValue);
      }, debounceMs);
    }
    
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [currentValue, autoSave]);
  
  // Offline data management
  const loadOfflineData = async () => {
    try {
      const stored = await AsyncStorage.getItem(`input_${storageKey}`);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.encrypted && encryptValue) {
          const decrypted = CryptoJS.AES.decrypt(data.value, 'ONXLink_Input_Key').toString(CryptoJS.enc.Utf8);
          setOfflineValue(decrypted);
        } else {
          setOfflineValue(data.value);
        }
        setHasOfflineChanges(data.hasChanges || false);
      }
    } catch (error) {
      logSecureEvent('input_offline_load_error', { storageKey, error: error.message });
    }
  };
  
  const saveToStorage = async (valueToSave: string) => {
    if (!storageKey) return;
    
    try {
      const dataToStore = {
        value: encryptValue ? 
          CryptoJS.AES.encrypt(valueToSave, 'ONXLink_Input_Key').toString() : 
          valueToSave,
        encrypted: encryptValue,
        timestamp: Date.now(),
        hasChanges: isOffline,
      };
      
      await AsyncStorage.setItem(`input_${storageKey}`, JSON.stringify(dataToStore));
    } catch (error) {
      logSecureEvent('input_save_error', { storageKey, error: error.message });
    }
  };
  
  // Input validation
  const performValidation = (inputValue: string): { isValid: boolean; message: string } => {
    const sanitized = sanitizeInput(inputValue);
    
    // Required validation
    if (isRequired && !sanitized.trim()) {
      return { isValid: false, message: t('validation.required') };
    }
    
    // Length validation
    if (minLength && sanitized.length < minLength) {
      return { isValid: false, message: t('validation.minLength', { min: minLength }) };
    }
    
    if (maxLength && sanitized.length > maxLength) {
      return { isValid: false, message: t('validation.maxLength', { max: maxLength }) };
    }
    
    // Type-specific validation
    const typeValidation = validateInput(sanitized, validationType);
    if (!typeValidation.isValid) {
      return { isValid: false, message: typeValidation.message || t('validation.invalid') };
    }
    
    // Custom validation
    if (customValidator) {
      const customResult = customValidator(sanitized);
      if (!customResult.isValid) {
        return { isValid: false, message: customResult.message || t('validation.custom') };
      }
    }
    
    return { isValid: true, message: '' };
  };
  
  // Debounced validation
  const validateWithDebounce = (inputValue: string) => {
    if (validationRef.current) {
      clearTimeout(validationRef.current);
    }
    
    validationRef.current = setTimeout(() => {
      const validation = performValidation(inputValue);
      setIsValid(validation.isValid);
      setValidationMessage(validation.message);
      onValidationChange?.(validation.isValid, validation.message);
      
      if (validation.isValid && showSuccessIndicator && inputValue.length > 0) {
        hapticFeedback('success');
        if (userTier !== 'freemium') {
          playSuccessSound();
        }
      }
    }, 150);
  };
  
  // Animation helpers
  const animateLabel = (shouldMoveUp: boolean) => {
    Animated.timing(labelAnimation, {
      toValue: shouldMoveUp ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };
  
  const animateBorder = (focused: boolean) => {
    Animated.timing(borderAnimation, {
      toValue: focused ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };
  
  // Event handlers
  const handleChangeText = (text: string) => {
    const sanitized = sanitizeInput(text);
    
    if (externalValue === undefined) {
      setInternalValue(sanitized);
    }
    
    if (isOffline && allowOfflineEdit) {
      setOfflineValue(sanitized);
      setHasOfflineChanges(true);
      saveToStorage(sanitized);
    }
    
    validateWithDebounce(sanitized);
    
    const validation = performValidation(sanitized);
    onChangeText?.(sanitized, validation.isValid);
    
    // Animate label
    animateLabel(sanitized.length > 0 || isFocused);
  };
  
  const handleFocus = () => {
    setIsFocused(true);
    animateLabel(true);
    animateBorder(true);
    onFocus?.();
    
    // Accessibility announcement
    AccessibilityInfo.announceForAccessibility(
      t('accessibility.inputFocused', { label: label || placeholder })
    );
  };
  
  const handleBlur = () => {
    setIsFocused(false);
    animateLabel(displayValue.length > 0);
    animateBorder(false);
    onBlur?.();
    
    // Final validation on blur
    const validation = performValidation(displayValue);
    setIsValid(validation.isValid);
    setValidationMessage(validation.message);
    onValidationChange?.(validation.isValid, validation.message);
  };
  
  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
    hapticFeedback('light');
  };
  
  // Imperative methods
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur(),
    clear: () => {
      handleChangeText('');
      setOfflineValue('');
      setHasOfflineChanges(false);
    },
    getValue: () => displayValue,
    setValue: (newValue: string) => handleChangeText(newValue),
    validate: () => {
      const validation = performValidation(displayValue);
      setIsValid(validation.isValid);
      setValidationMessage(validation.message);
      return validation.isValid;
    },
    getEncryptedValue: () => encryptSensitiveData(displayValue),
  }));
  
  // Style calculations
  const getContainerStyle = (): ViewStyle => {
    const baseStyle = styles.container;
    const themeStyle = theme.input?.container || {};
    const sizeStyle = styles[`${size}Container`] || {};
    const variantStyle = styles[`${variant}Container`] || {};
    
    return {
      ...baseStyle,
      ...themeStyle,
      ...sizeStyle,
      ...variantStyle,
      opacity: disabled ? 0.6 : 1,
      ...containerStyle,
    };
  };
  
  const getInputStyle = (): TextStyle => {
    const baseStyle = styles.input;
    const themeStyle = theme.input?.text || {};
    const sizeStyle = styles[`${size}Input`] || {};
    const errorStyle = (!isValid && validationMessage) ? styles.inputError : {};
    
    return {
      ...baseStyle,
      ...themeStyle,
      ...sizeStyle,
      ...errorStyle,
      color: disabled ? theme.colors.textMuted : theme.colors.textPrimary,
      ...inputStyle,
    };
  };
  
  const getBorderStyle = () => {
    const focusColor = !isValid ? theme.colors.error : theme.colors.primary;
    const defaultColor = theme.colors.border;
    
    return {
      borderColor: borderAnimation.interpolate({
        inputRange: [0, 1],
        outputRange: [defaultColor, focusColor],
      }),
      borderWidth: borderAnimation.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 2],
      }),
    };
  };
  
  const getLabelStyle = (): TextStyle => {
    const baseStyle = styles.label;
    const themeStyle = theme.input?.label || {};
    const colorStyle = {
      color: !isValid && validationMessage ? 
        theme.colors.error : 
        isFocused ? theme.colors.primary : theme.colors.textSecondary,
    };
    
    return {
      ...baseStyle,
      ...themeStyle,
      ...colorStyle,
      ...labelStyle,
    };
  };
  
  // Dynamic keyboard type
  const getKeyboardType = (): KeyboardTypeOptions => {
    if (keyboardType) return keyboardType;
    
    switch (validationType) {
      case 'email': return 'email-address';
      case 'phone': return 'phone-pad';
      case 'number': return 'numeric';
      case 'url': return 'url';
      default: return 'default';
    }
  };
  
  // Render helpers
  const renderLeftIcon = () => {
    if (!leftIcon) return null;
    
    return (
      <TouchableOpacity
        onPress={onLeftIconPress}
        style={styles.iconContainer}
        accessible={!!onLeftIconPress}
        accessibilityRole={onLeftIconPress ? 'button' : undefined}
        accessibilityLabel={t('accessibility.leftIcon')}
      >
        <Icon 
          name={leftIcon} 
          size={theme.sizing.iconMedium} 
          color={theme.colors.textSecondary} 
        />
      </TouchableOpacity>
    );
  };
  
  const renderRightIcon = () => {
    const shouldShowPasswordToggle = validationType === 'password' && !rightIcon;
    const iconName = shouldShowPasswordToggle ? 
      (showPassword ? 'visibility-off' : 'visibility') : rightIcon;
    
    if (!iconName) return null;
    
    const handlePress = shouldShowPasswordToggle ? 
      togglePasswordVisibility : onRightIconPress;
    
    return (
      <TouchableOpacity
        onPress={handlePress}
        style={styles.iconContainer}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={
          shouldShowPasswordToggle ? 
          t('accessibility.togglePassword') : 
          t('accessibility.rightIcon')
        }
      >
        <Icon 
          name={iconName} 
          size={theme.sizing.iconMedium} 
          color={theme.colors.textSecondary} 
        />
      </TouchableOpacity>
    );
  };
  
  const renderSuccessIndicator = () => {
    if (!showSuccessIndicator || !isValid || !displayValue.length) return null;
    
    return (
      <View style={styles.successContainer}>
        <Icon 
          name="check-circle" 
          size={theme.sizing.iconSmall} 
          color={theme.colors.success} 
        />
      </View>
    );
  };
  
  const renderOfflineIndicator = () => {
    if (!hasOfflineChanges || !isOffline) return null;
    
    return (
      <View style={styles.offlineIndicator}>
        <Icon 
          name="cloud-off" 
          size={theme.sizing.iconSmall} 
          color={theme.colors.warning} 
        />
        <Text style={[styles.offlineText, { color: theme.colors.warning }]}>
          {t('input.offlineChanges')}
        </Text>
      </View>
    );
  };
  
  const renderCharacterCount = () => {
    if (!showCharacterCount || !maxLength) return null;
    
    const count = displayValue.length;
    const isNearLimit = count > maxLength * 0.8;
    const isOverLimit = count > maxLength;
    
    return (
      <Text style={[
        styles.characterCount,
        { color: isOverLimit ? theme.colors.error : 
                isNearLimit ? theme.colors.warning : 
                theme.colors.textMuted }
      ]}>
        {count}/{maxLength}
      </Text>
    );
  };
  
  const renderMessages = () => {
    const errorMsg = externalErrorMessage || (!isValid ? validationMessage : '');
    const showSuccess = isValid && successMessage && displayValue.length > 0;
    
    if (!errorMsg && !showSuccess && !helpText) return null;
    
    return (
      <View style={styles.messageContainer}>
        {errorMsg ? (
          <Text style={[styles.errorMessage, { color: theme.colors.error }]}>
            {errorMsg}
          </Text>
        ) : showSuccess ? (
          <Text style={[styles.successMessage, { color: theme.colors.success }]}>
            {successMessage}
          </Text>
        ) : helpText ? (
          <Text style={[styles.helpText, { color: theme.colors.textMuted }]}>
            {helpText}
          </Text>
        ) : null}
        
        {renderCharacterCount()}
      </View>
    );
  };
  
  const renderLabel = () => {
    if (!label) return null;
    
    const labelTransform = labelAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -theme.spacing.medium],
    });
    
    const labelScale = labelAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.85],
    });
    
    return (
      <Animated.Text
        style={[
          getLabelStyle(),
          {
            transform: [
              { translateY: labelTransform },
              { scale: labelScale },
            ],
          },
        ]}
      >
        {label}{isRequired ? ' *' : ''}
      </Animated.Text>
    );
  };
  
  return (
    <View style={getContainerStyle()}>
      {renderOfflineIndicator()}
      
      <Animated.View style={[styles.inputContainer, getBorderStyle()]}>
        {renderLeftIcon()}
        
        <View style={styles.inputWrapper}>
          {renderLabel()}
          
          <TextInput
            ref={inputRef}
            style={getInputStyle()}
            value={displayValue}
            onChangeText={handleChangeText}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={isFocused ? '' : placeholder}
            placeholderTextColor={theme.colors.textMuted}
            keyboardType={getKeyboardType()}
            returnKeyType={returnKeyType}
            secureTextEntry={validationType === 'password' ? !showPassword : secureTextEntry}
            multiline={multiline}
            numberOfLines={numberOfLines}
            editable={!disabled}
            testID={testID}
            accessible={true}
            accessibilityLabel={label || placeholder}
            accessibilityHint={helpText}
            accessibilityState={{
              disabled,
              invalid: !isValid,
            }}
            {...textInputProps}
          />
        </View>
        
        {renderSuccessIndicator()}
        {renderRightIcon()}
      </Animated.View>
      
      {renderMessages()}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  
  // Size variants
  smallContainer: {
    marginVertical: 6,
  },
  mediumContainer: {
    marginVertical: 8,
  },
  largeContainer: {
    marginVertical: 12,
  },
  
  // Input container
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: 'transparent',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  
  // Variant styles
  defaultContainer: {
    borderWidth: 1,
  },
  outlinedContainer: {
    borderWidth: 1.5,
    borderRadius: 12,
  },
  filledContainer: {
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderWidth: 0,
    borderBottomWidth: 2,
    borderRadius: 8,
  },
  underlinedContainer: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderBottomWidth: 1,
    borderRadius: 0,
    paddingHorizontal: 0,
  },
  
  // Input wrapper and text
  inputWrapper: {
    flex: 1,
    justifyContent: 'center',
  },
  
  input: {
    fontSize: 16,
    lineHeight: 20,
    paddingVertical: 8,
    margin: 0,
    padding: 0,
  },
  
  smallInput: {
    fontSize: 14,
    minHeight: 36,
  },
  mediumInput: {
    fontSize: 16,
    minHeight: 48,
  },
  largeInput: {
    fontSize: 18,
    minHeight: 56,
  },
  
  inputError: {
    borderColor: '#E53E3E',
  },
  
  // Label
  label: {
    position: 'absolute',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '400',
  },
  
  // Icons
  iconContainer: {
    padding: 4,
    marginHorizontal: 4,
  },
  
  successContainer: {
    marginLeft: 4,
  },
  
  // Messages
  messageContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  
  errorMessage: {
    fontSize: 12,
    flex: 1,
  },
  
  successMessage: {
    fontSize: 12,
    flex: 1,
  },
  
  helpText: {
    fontSize: 12,
    flex: 1,
  },
  
  characterCount: {
    fontSize: 12,
    marginLeft: 8,
  },
  
  // Offline indicator
  offlineIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  
  offlineText: {
    fontSize: 12,
    marginLeft: 4,
  },
});

Input.displayName = 'Input';

export default Input;