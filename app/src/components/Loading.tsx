import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  Animated, 
  StyleSheet, 
  Dimensions, 
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Platform
} from 'react-native';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { RootState } from '../store';
import { offlineStorage } from '../services/storage';

interface LoadingProps {
  size?: 'small' | 'medium' | 'large';
  variant?: 'spinner' | 'dots' | 'wave' | 'brand' | 'skeleton';
  message?: string;
  showProgress?: boolean;
  progress?: number;
  showTips?: boolean;
  onCancel?: () => void;
  timeout?: number;
  transparent?: boolean;
  overlay?: boolean;
  retryAction?: () => void;
  offlineMode?: boolean;
}

interface LoadingTip {
  id: string;
  text: string;
  category: 'feature' | 'productivity' | 'tip';
  tier: 'freemium' | 'premium' | 'enterprise' | 'all';
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const Loading: React.FC<LoadingProps> = ({
  size = 'medium',
  variant = 'brand',
  message,
  showProgress = false,
  progress = 0,
  showTips = true,
  onCancel,
  timeout = 30000,
  transparent = false,
  overlay = true,
  retryAction,
  offlineMode = false
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useSelector((state: RootState) => state.auth);
  const { isOffline } = useSelector((state: RootState) => state.app);
  
  const [currentTip, setCurrentTip] = useState<LoadingTip | null>(null);
  const [showTimeout, setShowTimeout] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  const animationValue = useRef(new Animated.Value(0)).current;
  const scaleValue = useRef(new Animated.Value(0.8)).current;
  const fadeValue = useRef(new Animated.Value(0)).current;
  const progressValue = useRef(new Animated.Value(0)).current;
  const tipFadeValue = useRef(new Animated.Value(0)).current;
  
  const rotationValues = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0)
  ]).current;
  
  const waveValues = useRef(
    Array.from({ length: 5 }, () => new Animated.Value(0))
  ).current;

  const loadingTips: LoadingTip[] = [
    {
      id: 'tip_1',
      text: t('loading.tips.aiInfluencer'),
      category: 'feature',
      tier: 'premium'
    },
    {
      id: 'tip_2',
      text: t('loading.tips.crossPosting'),
      category: 'productivity',
      tier: 'all'
    },
    {
      id: 'tip_3',
      text: t('loading.tips.culturalAdaptation'),
      category: 'feature',
      tier: 'premium'
    },
    {
      id: 'tip_4',
      text: t('loading.tips.voiceControl'),
      category: 'tip',
      tier: 'premium'
    },
    {
      id: 'tip_5',
      text: t('loading.tips.predictiveInventory'),
      category: 'feature',
      tier: 'enterprise'
    },
    {
      id: 'tip_6',
      text: t('loading.tips.offlineMode'),
      category: 'tip',
      tier: 'all'
    },
    {
      id: 'tip_7',
      text: t('loading.tips.bulkOperations'),
      category: 'productivity',
      tier: 'premium'
    },
    {
      id: 'tip_8',
      text: t('loading.tips.trendAnalysis'),
      category: 'feature',
      tier: 'premium'
    }
  ];

  useEffect(() => {
    initializeAnimations();
    initializeTips();
    
    const timeoutTimer = setTimeout(() => {
      setShowTimeout(true);
    }, timeout);

    const elapsedTimer = setInterval(() => {
      setElapsedTime(prev => prev + 1000);
    }, 1000);

    return () => {
      clearTimeout(timeoutTimer);
      clearInterval(elapsedTimer);
    };
  }, []);

  useEffect(() => {
    if (showProgress && progress !== undefined) {
      Animated.timing(progressValue, {
        toValue: progress,
        duration: 500,
        useNativeDriver: false
      }).start();
    }
  }, [progress, showProgress]);

  const initializeAnimations = () => {
    // Fade in animation
    Animated.parallel([
      Animated.timing(fadeValue, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true
      }),
      Animated.spring(scaleValue, {
        toValue: 1,
        tension: 100,
        friction: 8,
        useNativeDriver: true
      })
    ]).start();

    // Continuous animations based on variant
    switch (variant) {
      case 'spinner':
        startSpinnerAnimation();
        break;
      case 'dots':
        startDotsAnimation();
        break;
      case 'wave':
        startWaveAnimation();
        break;
      case 'brand':
        startBrandAnimation();
        break;
      case 'skeleton':
        startSkeletonAnimation();
        break;
    }
  };

  const initializeTips = async () => {
    if (!showTips) return;
    
    try {
      const userTier = user?.subscriptionTier || 'freemium';
      const relevantTips = loadingTips.filter(tip => 
        tip.tier === 'all' || tip.tier === userTier
      );
      
      const lastShownTips = await offlineStorage.getItem('lastShownTips') || [];
      const availableTips = relevantTips.filter(tip => 
        !lastShownTips.includes(tip.id)
      );
      
      if (availableTips.length > 0) {
        const randomTip = availableTips[Math.floor(Math.random() * availableTips.length)];
        setCurrentTip(randomTip);
        
        // Update shown tips
        const updatedShownTips = [...lastShownTips, randomTip.id];
        await offlineStorage.setItem('lastShownTips', updatedShownTips);
        
        // Reset if all tips shown
        if (updatedShownTips.length >= relevantTips.length) {
          await offlineStorage.setItem('lastShownTips', []);
        }
      }
      
      startTipAnimation();
    } catch (error) {
      console.warn('Failed to load loading tips:', error);
    }
  };

  const startSpinnerAnimation = () => {
    Animated.loop(
      Animated.timing(animationValue, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true
      })
    ).start();
  };

  const startDotsAnimation = () => {
    const animations = rotationValues.map((value, index) => 
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 200),
          Animated.timing(value, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true
          })
        ])
      )
    );
    
    Animated.stagger(100, animations).start();
  };

  const startWaveAnimation = () => {
    const animations = waveValues.map((value, index) => 
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 100),
          Animated.timing(value, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 800,
            useNativeDriver: true
          })
        ])
      )
    );
    
    Animated.stagger(50, animations).start();
  };

  const startBrandAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animationValue, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true
        }),
        Animated.timing(animationValue, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true
        })
      ])
    ).start();
  };

  const startSkeletonAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animationValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true
        }),
        Animated.timing(animationValue, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true
        })
      ])
    ).start();
  };

  const startTipAnimation = () => {
    Animated.sequence([
      Animated.delay(1000),
      Animated.timing(tipFadeValue, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true
      })
    ]).start();
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return { width: 24, height: 24 };
      case 'large':
        return { width: 60, height: 60 };
      default:
        return { width: 40, height: 40 };
    }
  };

  const renderSpinner = () => {
    const spin = animationValue.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg']
    });

    return (
      <Animated.View
        style={[
          styles.spinner,
          getSizeStyles(),
          { transform: [{ rotate: spin }] }
        ]}
      >
        <View style={[styles.spinnerRing, { borderColor: theme.colors.primary }]} />
      </Animated.View>
    );
  };

  const renderDots = () => {
    return (
      <View style={styles.dotsContainer}>
        {rotationValues.map((value, index) => {
          const opacity = value.interpolate({
            inputRange: [0, 1],
            outputRange: [0.3, 1]
          });
          
          const scale = value.interpolate({
            inputRange: [0, 1],
            outputRange: [0.8, 1.2]
          });

          return (
            <Animated.View
              key={index}
              style={[
                styles.dot,
                {
                  backgroundColor: theme.colors.primary,
                  opacity,
                  transform: [{ scale }]
                }
              ]}
            />
          );
        })}
      </View>
    );
  };

  const renderWave = () => {
    return (
      <View style={styles.waveContainer}>
        {waveValues.map((value, index) => {
          const height = value.interpolate({
            inputRange: [0, 1],
            outputRange: [4, 20]
          });

          return (
            <Animated.View
              key={index}
              style={[
                styles.waveBar,
                {
                  backgroundColor: theme.colors.primary,
                  height
                }
              ]}
            />
          );
        })}
      </View>
    );
  };

  const renderBrand = () => {
    const opacity = animationValue.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.4, 1, 0.4]
    });

    const scale = animationValue.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.9, 1.1, 0.9]
    });

    return (
      <Animated.View
        style={[
          styles.brandContainer,
          {
            opacity,
            transform: [{ scale }]
          }
        ]}
      >
        <View style={[styles.brandLogo, { backgroundColor: theme.colors.primary }]}>
          <Text style={[styles.brandText, { color: theme.colors.onPrimary }]}>
            ONX
          </Text>
        </View>
      </Animated.View>
    );
  };

  const renderSkeleton = () => {
    const opacity = animationValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 0.7]
    });

    return (
      <View style={styles.skeletonContainer}>
        {[...Array(3)].map((_, index) => (
          <Animated.View
            key={index}
            style={[
              styles.skeletonLine,
              {
                backgroundColor: theme.colors.surface,
                opacity,
                width: index === 0 ? '80%' : index === 1 ? '60%' : '40%'
              }
            ]}
          />
        ))}
      </View>
    );
  };

  const renderAnimation = () => {
    switch (variant) {
      case 'spinner':
        return renderSpinner();
      case 'dots':
        return renderDots();
      case 'wave':
        return renderWave();
      case 'brand':
        return renderBrand();
      case 'skeleton':
        return renderSkeleton();
      default:
        return renderBrand();
    }
  };

  const renderProgress = () => {
    if (!showProgress) return null;

    const progressWidth = progressValue.interpolate({
      inputRange: [0, 100],
      outputRange: [0, screenWidth * 0.8]
    });

    return (
      <View style={styles.progressContainer}>
        <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceVariant }]}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                backgroundColor: theme.colors.primary,
                width: progressWidth
              }
            ]}
          />
        </View>
        <Text style={[styles.progressText, { color: theme.colors.onSurface }]}>
          {Math.round(progress)}%
        </Text>
      </View>
    );
  };

  const renderTip = () => {
    if (!currentTip || !showTips) return null;

    const getTipIcon = () => {
      switch (currentTip.category) {
        case 'feature':
          return '✨';
        case 'productivity':
          return '⚡';
        case 'tip':
          return '💡';
        default:
          return '💡';
      }
    };

    const getTierColor = () => {
      switch (currentTip.tier) {
        case 'premium':
          return theme.colors.secondary;
        case 'enterprise':
          return theme.colors.tertiary;
        default:
          return theme.colors.primary;
      }
    };

    return (
      <Animated.View
        style={[
          styles.tipContainer,
          {
            backgroundColor: theme.colors.surface,
            opacity: tipFadeValue
          }
        ]}
      >
        <View style={styles.tipHeader}>
          <Text style={styles.tipIcon}>{getTipIcon()}</Text>
          <View style={[styles.tipBadge, { backgroundColor: getTierColor() }]}>
            <Text style={[styles.tipBadgeText, { color: theme.colors.onPrimary }]}>
              {currentTip.tier.toUpperCase()}
            </Text>
          </View>
        </View>
        <Text style={[styles.tipText, { color: theme.colors.onSurface }]}>
          {currentTip.text}
        </Text>
      </Animated.View>
    );
  };

  const renderOfflineIndicator = () => {
    if (!isOffline && !offlineMode) return null;

    return (
      <View style={[styles.offlineIndicator, { backgroundColor: theme.colors.warning }]}>
        <Text style={[styles.offlineText, { color: theme.colors.onWarning }]}>
          📶 {t('loading.offlineMode')}
        </Text>
      </View>
    );
  };

  const renderTimeout = () => {
    if (!showTimeout) return null;

    return (
      <View style={styles.timeoutContainer}>
        <Text style={[styles.timeoutText, { color: theme.colors.onSurface }]}>
          {t('loading.takingLonger')}
        </Text>
        <View style={styles.timeoutActions}>
          {retryAction && (
            <TouchableOpacity
              style={[styles.retryButton, { backgroundColor: theme.colors.primary }]}
              onPress={retryAction}
            >
              <Text style={[styles.retryButtonText, { color: theme.colors.onPrimary }]}>
                {t('loading.retry')}
              </Text>
            </TouchableOpacity>
          )}
          {onCancel && (
            <TouchableOpacity
              style={[styles.cancelButton, { borderColor: theme.colors.outline }]}
              onPress={onCancel}
            >
              <Text style={[styles.cancelButtonText, { color: theme.colors.onSurface }]}>
                {t('loading.cancel')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  if (!overlay) {
    return (
      <View style={styles.inlineContainer}>
        {renderAnimation()}
        {message && (
          <Text style={[styles.inlineMessage, { color: theme.colors.onSurface }]}>
            {message}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={[
      styles.overlay,
      {
        backgroundColor: transparent ? 'transparent' : theme.colors.backdrop
      }
    ]}>
      <Animated.View
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.surface,
            opacity: fadeValue,
            transform: [{ scale: scaleValue }]
          }
        ]}
      >
        {renderOfflineIndicator()}
        
        <View style={styles.content}>
          {renderAnimation()}
          
          {message && (
            <Text style={[styles.message, { color: theme.colors.onSurface }]}>
              {message}
            </Text>
          )}
          
          {renderProgress()}
          {renderTip()}
          {renderTimeout()}
        </View>
        
        <View style={styles.footer}>
          <Text style={[styles.elapsedTime, { color: theme.colors.onSurfaceVariant }]}>
            {Math.floor(elapsedTime / 1000)}s
          </Text>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999
  },
  container: {
    borderRadius: 16,
    paddingVertical: 32,
    paddingHorizontal: 24,
    minWidth: 280,
    maxWidth: screenWidth * 0.9,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12
      },
      android: {
        elevation: 8
      }
    })
  },
  content: {
    alignItems: 'center'
  },
  inlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16
  },
  inlineMessage: {
    marginLeft: 12,
    fontSize: 14,
    fontWeight: '500'
  },
  message: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 22
  },
  progressContainer: {
    marginTop: 20,
    width: '100%',
    alignItems: 'center'
  },
  progressTrack: {
    height: 4,
    width: '100%',
    borderRadius: 2,
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    borderRadius: 2
  },
  progressText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600'
  },
  tipContainer: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    width: '100%'
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8
  },
  tipIcon: {
    fontSize: 16
  },
  tipBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8
  },
  tipBadgeText: {
    fontSize: 10,
    fontWeight: '700'
  },
  tipText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center'
  },
  offlineIndicator: {
    position: 'absolute',
    top: -8,
    left: 16,
    right: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center'
  },
  offlineText: {
    fontSize: 12,
    fontWeight: '600'
  },
  timeoutContainer: {
    marginTop: 20,
    alignItems: 'center'
  },
  timeoutText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16
  },
  timeoutActions: {
    flexDirection: 'row',
    gap: 12
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600'
  },
  cancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '500'
  },
  footer: {
    marginTop: 16,
    alignItems: 'center'
  },
  elapsedTime: {
    fontSize: 12
  },
  spinner: {
    justifyContent: 'center',
    alignItems: 'center'
  },
  spinnerRing: {
    width: '100%',
    height: '100%',
    borderRadius: 50,
    borderWidth: 3,
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent'
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  waveContainer: {
    flexDirection: 'row',
    alignItems: 'end',
    gap: 2
  },
  waveBar: {
    width: 3,
    borderRadius: 1.5
  },
  brandContainer: {
    alignItems: 'center'
  },
  brandLogo: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center'
  },
  brandText: {
    fontSize: 18,
    fontWeight: '800'
  },
  skeletonContainer: {
    width: 200,
    gap: 8
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6
  }
});

export default Loading;