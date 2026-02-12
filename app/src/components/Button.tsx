import React, { useCallback, useMemo, useState } from 'react';
import {
  TouchableOpacity,
  Text,
  View,
  StyleSheet,
  Dimensions,
  Vibration,
  ActivityIndicator,
  AccessibilityInfo,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolateColor,
} from 'react-native-reanimated';
import { Haptics } from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTheme } from '../store/themeSlice';
import { useAuth } from '../store/authSlice';
import { useAnalytics } from '../services/analytics';
import { ThemeColors } from '../types';

const { width: screenWidth } = Dimensions.get('window');

// Comprehensive button variant types for different use cases
export type ButtonVariant = 
  | 'primary' 
  | 'secondary' 
  | 'ghost' 
  | 'danger' 
  | 'success' 
  | 'premium' 
  | 'enterprise' 
  | 'social' 
  | 'gradient' 
  | 'outline'
  | 'glass'
  | 'minimal';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface ButtonProps {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  loadingText?: string;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  onPress?: () => void | Promise<void>;
  onLongPress?: () => void;
  style?: any;
  textStyle?: any;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  hapticFeedback?: boolean;
  analytics?: {
    event: string;
    parameters?: Record<string, any>;
  };
  requiresAuth?: boolean;
  requiresPremium?: boolean;
  gradientColors?: string[];
  borderRadius?: number;
  shadow?: boolean;
  rippleEffect?: boolean;
  debounceMs?: number;
  minimumWidth?: number;
  maximumWidth?: number;
  flex?: number;
  children?: React.ReactNode;
}

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);
const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

export const Button: React.FC<ButtonProps> = ({
  title,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  loadingText,
  icon,
  iconPosition = 'left',
  onPress,
  onLongPress,
  style,
  textStyle,
  testID,
  accessibilityLabel,
  accessibilityHint,
  hapticFeedback = true,
  analytics,
  requiresAuth = false,
  requiresPremium = false,
  gradientColors,
  borderRadius,
  shadow = true,
  rippleEffect = true,
  debounceMs = 300,
  minimumWidth,
  maximumWidth,
  flex,
  children,
}) => {
  const theme = useTheme();
  const { user, subscriptionTier } = useAuth();
  const { trackEvent } = useAnalytics();
  
  const [lastPressed, setLastPressed] = useState(0);
  const [pressCount, setPressCount] = useState(0);
  
  // Animation values
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const rippleScale = useSharedValue(0);
  const rippleOpacity = useSharedValue(0);
  const colorProgress = useSharedValue(0);

  // Memoized style calculations for performance
  const buttonStyles = useMemo(() => {
    const colors = theme.colors;
    return createButtonStyles(colors, theme.isDark);
  }, [theme.colors, theme.isDark]);

  // Check authentication and premium requirements
  const isAccessible = useMemo(() => {
    if (requiresAuth && !user) return false;
    if (requiresPremium && subscriptionTier === 'freemium') return false;
    return true;
  }, [requiresAuth, requiresPremium, user, subscriptionTier]);

  // Get variant-specific styles
  const variantStyle = useMemo(() => {
    return getVariantStyle(variant, buttonStyles, gradientColors);
  }, [variant, buttonStyles, gradientColors]);

  // Get size-specific styles
  const sizeStyle = useMemo(() => {
    return getSizeStyle(size, minimumWidth, maximumWidth);
  }, [size, minimumWidth, maximumWidth]);

  // Haptic feedback handler
  const triggerHapticFeedback = useCallback(async () => {
    if (!hapticFeedback) return;
    
    try {
      // Check if haptics are enabled in device settings
      const hapticsEnabled = await AsyncStorage.getItem('haptics_enabled');
      if (hapticsEnabled === 'false') return;
      
      if (Haptics.impactAsync) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        Vibration.vibrate(50);
      }
    } catch (error) {
      // Fallback to vibration if Haptics fails
      Vibration.vibrate(50);
    }
  }, [hapticFeedback]);

  // Debounced press handler
  const handlePress = useCallback(async () => {
    const now = Date.now();
    if (now - lastPressed < debounceMs) return;
    setLastPressed(now);

    if (!isAccessible) {
      handleRestrictedAccess();
      return;
    }

    if (disabled || loading || !onPress) return;

    // Track analytics
    if (analytics) {
      trackEvent(analytics.event, {
        ...analytics.parameters,
        variant,
        size,
        button_text: title,
        timestamp: now,
      });
    }

    // Increment press count for user engagement metrics
    setPressCount(prev => prev + 1);
    
    // Trigger haptic feedback
    await triggerHapticFeedback();

    // Execute press handler
    try {
      await onPress();
    } catch (error) {
      console.error('Button press error:', error);
      // Could integrate with error reporting service here
    }
  }, [
    lastPressed,
    debounceMs,
    isAccessible,
    disabled,
    loading,
    onPress,
    analytics,
    variant,
    size,
    title,
    triggerHapticFeedback,
  ]);

  // Handle restricted access (auth/premium required)
  const handleRestrictedAccess = useCallback(() => {
    if (requiresAuth && !user) {
      // Navigate to auth screen or show auth modal
      trackEvent('button_auth_required', { button_text: title });
    } else if (requiresPremium && subscriptionTier === 'freemium') {
      // Show premium upgrade modal
      trackEvent('button_premium_required', { button_text: title });
    }
  }, [requiresAuth, requiresPremium, user, subscriptionTier, title]);

  // Press animation
  const handlePressIn = useCallback(() => {
    if (disabled || loading) return;
    
    scale.value = withSpring(0.95, { damping: 15 });
    colorProgress.value = withTiming(1, { duration: 150 });
    
    if (rippleEffect) {
      rippleScale.value = 0;
      rippleOpacity.value = 0.3;
      rippleScale.value = withTiming(1, { duration: 400 });
      rippleOpacity.value = withTiming(0, { duration: 400 });
    }
  }, [disabled, loading, rippleEffect]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 15 });
    colorProgress.value = withTiming(0, { duration: 200 });
  }, []);

  // Animated styles
  const animatedStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      colorProgress.value,
      [0, 1],
      [variantStyle.backgroundColor, variantStyle.pressedBackgroundColor || variantStyle.backgroundColor]
    );

    return {
      transform: [{ scale: scale.value }],
      opacity: opacity.value,
      backgroundColor: gradientColors ? 'transparent' : backgroundColor,
    };
  });

  const rippleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rippleScale.value }],
    opacity: rippleOpacity.value,
  }));

  // Loading indicator
  const renderLoadingIndicator = () => (
    <ActivityIndicator
      size={size === 'xs' || size === 'sm' ? 'small' : 'large'}
      color={variantStyle.textColor}
      style={{ marginRight: loadingText ? 8 : 0 }}
    />
  );

  // Icon rendering
  const renderIcon = () => {
    if (!icon) return null;
    return (
      <View style={[
        styles.iconContainer,
        iconPosition === 'right' && styles.iconRight,
      ]}>
        {icon}
      </View>
    );
  };

  // Content rendering
  const renderContent = () => (
    <View style={styles.contentContainer}>
      {loading && renderLoadingIndicator()}
      {!loading && iconPosition === 'left' && renderIcon()}
      
      <Text
        style={[
          buttonStyles.baseText,
          sizeStyle.textStyle,
          variantStyle.textStyle,
          textStyle,
          loading && styles.loadingText,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {loading && loadingText ? loadingText : title}
      </Text>
      
      {!loading && iconPosition === 'right' && renderIcon()}
      {children}
    </View>
  );

  // Gradient button
  if (gradientColors || variant === 'gradient') {
    const colors = gradientColors || buttonStyles.gradientColors;
    return (
      <AnimatedTouchableOpacity
        style={[
          buttonStyles.base,
          sizeStyle.containerStyle,
          style,
          { flex },
          animatedStyle,
        ]}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={onLongPress}
        disabled={disabled || loading}
        testID={testID}
        accessibilityLabel={accessibilityLabel || title}
        accessibilityHint={accessibilityHint}
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || loading }}
      >
        <AnimatedLinearGradient
          colors={colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[
            StyleSheet.absoluteFillObject,
            { borderRadius: borderRadius || sizeStyle.borderRadius },
          ]}
        />
        {rippleEffect && (
          <Animated.View
            style={[
              StyleSheet.absoluteFillObject,
              styles.ripple,
              rippleAnimatedStyle,
              { borderRadius: borderRadius || sizeStyle.borderRadius },
            ]}
          />
        )}
        {renderContent()}
      </AnimatedTouchableOpacity>
    );
  }

  // Standard button
  return (
    <AnimatedTouchableOpacity
      style={[
        buttonStyles.base,
        sizeStyle.containerStyle,
        variantStyle.containerStyle,
        shadow && buttonStyles.shadow,
        style,
        { flex },
        animatedStyle,
      ]}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onLongPress={onLongPress}
      disabled={disabled || loading}
      testID={testID}
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
    >
      {rippleEffect && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            styles.ripple,
            rippleAnimatedStyle,
            { borderRadius: borderRadius || sizeStyle.borderRadius },
          ]}
        />
      )}
      {renderContent()}
    </AnimatedTouchableOpacity>
  );
};

// Style creation functions
const createButtonStyles = (colors: ThemeColors, isDark: boolean) => {
  return StyleSheet.create({
    base: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      overflow: 'hidden',
    },
    baseText: {
      fontFamily: 'SF-Pro-Display-Medium',
      fontWeight: '600',
      textAlign: 'center',
    },
    shadow: {
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.4 : 0.2,
      shadowRadius: 8,
      elevation: 8,
    },
    gradientColors: ['#6C5CE7', '#A29BFE', '#00CEC9'],
  });
};

const getVariantStyle = (variant: ButtonVariant, styles: any, gradientColors?: string[]) => {
  const variantStyles = {
    primary: {
      containerStyle: { backgroundColor: '#6C5CE7' },
      textStyle: { color: '#FFFFFF' },
      backgroundColor: '#6C5CE7',
      textColor: '#FFFFFF',
      pressedBackgroundColor: '#5A4FCF',
    },
    secondary: {
      containerStyle: { 
        backgroundColor: '#A29BFE',
        borderWidth: 1,
        borderColor: '#6C5CE7',
      },
      textStyle: { color: '#6C5CE7' },
      backgroundColor: '#A29BFE',
      textColor: '#6C5CE7',
      pressedBackgroundColor: '#8B7FF5',
    },
    ghost: {
      containerStyle: { backgroundColor: 'transparent' },
      textStyle: { color: '#6C5CE7' },
      backgroundColor: 'transparent',
      textColor: '#6C5CE7',
      pressedBackgroundColor: 'rgba(108, 92, 231, 0.1)',
    },
    danger: {
      containerStyle: { backgroundColor: '#E17055' },
      textStyle: { color: '#FFFFFF' },
      backgroundColor: '#E17055',
      textColor: '#FFFFFF',
      pressedBackgroundColor: '#D63031',
    },
    success: {
      containerStyle: { backgroundColor: '#00CEC9' },
      textStyle: { color: '#FFFFFF' },
      backgroundColor: '#00CEC9',
      textColor: '#FFFFFF',
      pressedBackgroundColor: '#00B894',
    },
    premium: {
      containerStyle: { 
        backgroundColor: '#6C5CE7',
        borderWidth: 2,
        borderColor: '#FDCB6E',
      },
      textStyle: { color: '#FFFFFF' },
      backgroundColor: '#6C5CE7',
      textColor: '#FFFFFF',
      pressedBackgroundColor: '#5A4FCF',
    },
    enterprise: {
      containerStyle: { backgroundColor: '#2D3436' },
      textStyle: { color: '#FFFFFF' },
      backgroundColor: '#2D3436',
      textColor: '#FFFFFF',
      pressedBackgroundColor: '#636E72',
    },
    social: {
      containerStyle: { backgroundColor: '#FD79A8' },
      textStyle: { color: '#FFFFFF' },
      backgroundColor: '#FD79A8',
      textColor: '#FFFFFF',
      pressedBackgroundColor: '#E84393',
    },
    gradient: {
      containerStyle: { backgroundColor: 'transparent' },
      textStyle: { color: '#FFFFFF' },
      backgroundColor: 'transparent',
      textColor: '#FFFFFF',
    },
    outline: {
      containerStyle: { 
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderColor: '#6C5CE7',
      },
      textStyle: { color: '#6C5CE7' },
      backgroundColor: 'transparent',
      textColor: '#6C5CE7',
      pressedBackgroundColor: 'rgba(108, 92, 231, 0.1)',
    },
    glass: {
      containerStyle: { 
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.2)',
      },
      textStyle: { color: '#FFFFFF' },
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      textColor: '#FFFFFF',
      pressedBackgroundColor: 'rgba(255, 255, 255, 0.2)',
    },
    minimal: {
      containerStyle: { 
        backgroundColor: 'transparent',
        paddingHorizontal: 8,
      },
      textStyle: { color: '#6C5CE7' },
      backgroundColor: 'transparent',
      textColor: '#6C5CE7',
      pressedBackgroundColor: 'rgba(108, 92, 231, 0.05)',
    },
  };

  return variantStyles[variant] || variantStyles.primary;
};

const getSizeStyle = (size: ButtonSize, minWidth?: number, maxWidth?: number) => {
  const sizeStyles = {
    xs: {
      containerStyle: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        minHeight: 28,
        minWidth: minWidth || 60,
        maxWidth: maxWidth || screenWidth * 0.3,
      },
      textStyle: { fontSize: 12, lineHeight: 16 },
      borderRadius: 6,
    },
    sm: {
      containerStyle: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        minHeight: 36,
        minWidth: minWidth || 80,
        maxWidth: maxWidth || screenWidth * 0.4,
      },
      textStyle: { fontSize: 14, lineHeight: 18 },
      borderRadius: 8,
    },
    md: {
      containerStyle: {
        paddingHorizontal: 20,
        paddingVertical: 12,
        minHeight: 44,
        minWidth: minWidth || 100,
        maxWidth: maxWidth || screenWidth * 0.6,
      },
      textStyle: { fontSize: 16, lineHeight: 20 },
      borderRadius: 12,
    },
    lg: {
      containerStyle: {
        paddingHorizontal: 24,
        paddingVertical: 16,
        minHeight: 52,
        minWidth: minWidth || 120,
        maxWidth: maxWidth || screenWidth * 0.8,
      },
      textStyle: { fontSize: 18, lineHeight: 22 },
      borderRadius: 14,
    },
    xl: {
      containerStyle: {
        paddingHorizontal: 32,
        paddingVertical: 20,
        minHeight: 60,
        minWidth: minWidth || 150,
        maxWidth: maxWidth || screenWidth * 0.9,
      },
      textStyle: { fontSize: 20, lineHeight: 24 },
      borderRadius: 16,
    },
    full: {
      containerStyle: {
        paddingHorizontal: 24,
        paddingVertical: 16,
        minHeight: 52,
        width: '100%',
        maxWidth: maxWidth || screenWidth - 40,
      },
      textStyle: { fontSize: 18, lineHeight: 22 },
      borderRadius: 12,
    },
  };

  return sizeStyles[size] || sizeStyles.md;
};

const styles = StyleSheet.create({
  contentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    marginRight: 8,
  },
  iconRight: {
    marginRight: 0,
    marginLeft: 8,
  },
  loadingText: {
    opacity: 0.8,
  },
  ripple: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
});

export default Button;