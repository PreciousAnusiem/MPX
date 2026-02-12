import React, { useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { 
  Platform, 
  StatusBar, 
  Appearance, 
  AppState, 
  NetInfo,
  Alert,
  BackHandler
} from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { enableScreens } from 'react-native-screens';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import notifee from '@notifee/react-native';
import crashlytics from '@react-native-firebase/crashlytics';

// Enable native screens for performance
enableScreens();

// Screen imports
import SplashScreen from '../screens/SplashScreen';
import AuthScreen from '../screens/AuthScreen';
import SubscriptionScreen from '../screens/SubscriptionScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ContentStudio from '../screens/ContentStudio';
import SocialManager from '../screens/SocialManager';
import InfluencerLab from '../screens/InfluencerLab';
import SettingsScreen from '../screens/SettingsScreen';
import OfflineScreen from '../screens/OfflineScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import ProfileScreen from '../screens/ProfileScreen';
import HelpScreen from '../screens/HelpScreen';
import NotificationScreen from '../screens/NotificationScreen';

// Redux imports
import { RootState } from '../store';
import { setTheme, setOffline } from '../store/userSlice';
import { logout } from '../store/authSlice';

// Utils
import { THEME_CONSTANTS, COLORS } from '../utils/constants';
import { secureStorage } from '../services/storage';
import { i18n } from '../utils/i18n';

// Stack navigators
const RootStack = createStackNavigator();
const AuthStack = createStackNavigator();
const MainStack = createStackNavigator();
const Tab = createBottomTabNavigator();
const Drawer = createDrawerNavigator();

// Types
export type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Auth: undefined;
  Main: undefined;
  Subscription: { tier?: string };
  Profile: undefined;
  Settings: undefined;
  Help: undefined;
  Offline: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  ContentStudio: undefined;
  SocialManager: undefined;
  InfluencerLab: undefined;
  Notifications: undefined;
};

// Custom theme configuration
const createCustomTheme = (isDark: boolean, userTheme: any) => ({
  ...(isDark ? DarkTheme : DefaultTheme),
  colors: {
    ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
    primary: userTheme?.primary || COLORS.BRAND_PURPLE,
    background: userTheme?.background || (isDark ? COLORS.DARK_BG : COLORS.LIGHT_BG),
    card: userTheme?.card || (isDark ? COLORS.DARK_CARD : COLORS.LIGHT_CARD),
    text: userTheme?.text || (isDark ? COLORS.DARK_TEXT : COLORS.LIGHT_TEXT),
    border: userTheme?.border || (isDark ? COLORS.DARK_BORDER : COLORS.LIGHT_BORDER),
    notification: COLORS.CORAL_PINK,
  },
});

// Tab bar configuration
const TabBarIcon = ({ name, color, size, focused }: any) => (
  <MaterialIcons 
    name={name} 
    size={focused ? size + 2 : size} 
    color={focused ? COLORS.BRAND_PURPLE : color} 
  />
);

// Navigation options
const screenOptions = {
  headerShown: false,
  gestureEnabled: true,
  cardStyleInterpolator: ({ current, layouts }: any) => ({
    cardStyle: {
      transform: [
        {
          translateX: current.progress.interpolate({
            inputRange: [0, 1],
            outputRange: [layouts.screen.width, 0],
          }),
        },
      ],
    },
  }),
};

// Main tab navigator
const MainTabs = () => {
  const { subscriptionTier, theme } = useSelector((state: RootState) => state.user);
  const isFreemium = subscriptionTier === 'freemium';

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: string;
          
          switch (route.name) {
            case 'Dashboard':
              iconName = 'dashboard';
              break;
            case 'ContentStudio':
              iconName = 'auto-awesome';
              break;
            case 'SocialManager':
              iconName = 'share';
              break;
            case 'InfluencerLab':
              iconName = 'person-add';
              break;
            case 'Notifications':
              iconName = 'notifications';
              break;
            default:
              iconName = 'circle';
          }

          return <TabBarIcon name={iconName} color={color} size={size} focused={focused} />;
        },
        tabBarActiveTintColor: COLORS.BRAND_PURPLE,
        tabBarInactiveTintColor: theme.isDark ? COLORS.DARK_TEXT_SECONDARY : COLORS.LIGHT_TEXT_SECONDARY,
        tabBarStyle: {
          backgroundColor: theme.isDark ? COLORS.DARK_CARD : COLORS.LIGHT_CARD,
          borderTopColor: theme.isDark ? COLORS.DARK_BORDER : COLORS.LIGHT_BORDER,
          elevation: 10,
          shadowOpacity: 0.1,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -5 },
          height: Platform.OS === 'ios' ? 90 : 70,
          paddingBottom: Platform.OS === 'ios' ? 25 : 10,
          paddingTop: 10,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        headerShown: false,
      })}
    >
      <Tab.Screen 
        name="Dashboard" 
        component={DashboardScreen}
        options={{ tabBarLabel: i18n.t('nav.dashboard') }}
      />
      <Tab.Screen 
        name="ContentStudio" 
        component={ContentStudio}
        options={{ 
          tabBarLabel: i18n.t('nav.content'),
          tabBarBadge: isFreemium ? '!' : undefined,
        }}
      />
      <Tab.Screen 
        name="SocialManager" 
        component={SocialManager}
        options={{ tabBarLabel: i18n.t('nav.social') }}
      />
      <Tab.Screen 
        name="InfluencerLab" 
        component={InfluencerLab}
        options={{ 
          tabBarLabel: i18n.t('nav.influencer'),
          tabBarBadge: isFreemium ? 'PRO' : undefined,
        }}
      />
      <Tab.Screen 
        name="Notifications" 
        component={NotificationScreen}
        options={{ tabBarLabel: i18n.t('nav.notifications') }}
      />
    </Tab.Navigator>
  );
};

// Auth stack navigator
const AuthNavigator = () => (
  <AuthStack.Navigator screenOptions={screenOptions}>
    <AuthStack.Screen name="Auth" component={AuthScreen} />
    <AuthStack.Screen name="Subscription" component={SubscriptionScreen} />
  </AuthStack.Navigator>
);

// Main app navigator with drawer
const MainNavigator = () => {
  const { theme } = useSelector((state: RootState) => state.user);
  
  return (
    <Drawer.Navigator
      screenOptions={{
        headerShown: false,
        drawerStyle: {
          backgroundColor: theme.isDark ? COLORS.DARK_CARD : COLORS.LIGHT_CARD,
          width: 280,
        },
        drawerActiveTintColor: COLORS.BRAND_PURPLE,
        drawerInactiveTintColor: theme.isDark ? COLORS.DARK_TEXT : COLORS.LIGHT_TEXT,
        drawerLabelStyle: {
          fontWeight: '600',
          fontSize: 16,
        },
      }}
      drawerContent={(props) => <CustomDrawerContent {...props} />}
    >
      <Drawer.Screen 
        name="MainTabs" 
        component={MainTabs}
        options={{
          drawerLabel: i18n.t('nav.home'),
          drawerIcon: ({ color, size }) => (
            <MaterialIcons name="home" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen 
        name="Profile" 
        component={ProfileScreen}
        options={{
          drawerLabel: i18n.t('nav.profile'),
          drawerIcon: ({ color, size }) => (
            <MaterialIcons name="person" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen 
        name="Settings" 
        component={SettingsScreen}
        options={{
          drawerLabel: i18n.t('nav.settings'),
          drawerIcon: ({ color, size }) => (
            <MaterialIcons name="settings" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen 
        name="Help" 
        component={HelpScreen}
        options={{
          drawerLabel: i18n.t('nav.help'),
          drawerIcon: ({ color, size }) => (
            <MaterialIcons name="help" size={size} color={color} />
          ),
        }}
      />
    </Drawer.Navigator>
  );
};

// Custom drawer content
const CustomDrawerContent = (props: any) => {
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);
  const { subscriptionTier, theme } = useSelector((state: RootState) => state.user);
  
  const handleLogout = async () => {
    Alert.alert(
      i18n.t('auth.logout'),
      i18n.t('auth.logoutConfirm'),
      [
        { text: i18n.t('common.cancel'), style: 'cancel' },
        {
          text: i18n.t('auth.logout'),
          style: 'destructive',
          onPress: async () => {
            try {
              await secureStorage.removeItem('auth_token');
              await secureStorage.removeItem('refresh_token');
              dispatch(logout());
            } catch (error) {
              crashlytics().recordError(error as Error);
            }
          },
        },
      ]
    );
  };

  return (
    <DrawerContentScrollView {...props}>
      <View style={{
        backgroundColor: theme.isDark ? COLORS.DARK_BG : COLORS.LIGHT_BG,
        padding: 20,
        marginBottom: 20,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: COLORS.BRAND_PURPLE,
            justifyContent: 'center',
            alignItems: 'center',
          }}>
            <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold' }}>
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </Text>
          </View>
          <View style={{ marginLeft: 15, flex: 1 }}>
            <Text style={{
              fontSize: 18,
              fontWeight: 'bold',
              color: theme.isDark ? COLORS.DARK_TEXT : COLORS.LIGHT_TEXT,
            }}>
              {user?.name || 'User'}
            </Text>
            <Text style={{
              fontSize: 14,
              color: theme.isDark ? COLORS.DARK_TEXT_SECONDARY : COLORS.LIGHT_TEXT_SECONDARY,
            }}>
              {subscriptionTier.toUpperCase()} Plan
            </Text>
          </View>
        </View>
      </View>
      
      <DrawerItemList {...props} />
      
      <DrawerItem
        label={i18n.t('auth.logout')}
        icon={({ color, size }) => (
          <MaterialIcons name="logout" size={size} color={color} />
        )}
        onPress={handleLogout}
        activeTintColor={COLORS.CORAL_PINK}
        inactiveTintColor={theme.isDark ? COLORS.DARK_TEXT : COLORS.LIGHT_TEXT}
      />
    </DrawerContentScrollView>
  );
};

// Connection status handler
const useConnectionStatus = () => {
  const [isConnected, setIsConnected] = useState(true);
  const dispatch = useDispatch();

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const connected = state.isConnected && state.isInternetReachable;
      setIsConnected(connected);
      dispatch(setOffline(!connected));
      
      if (!connected) {
        // Show offline notification
        notifee.displayNotification({
          title: i18n.t('offline.title'),
          body: i18n.t('offline.message'),
          android: {
            channelId: 'offline',
            importance: AndroidImportance.LOW,
          },
        });
      }
    });

    return unsubscribe;
  }, [dispatch]);

  return isConnected;
};

// App state handler
const useAppStateHandler = () => {
  const dispatch = useDispatch();

  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'background') {
        // Save app state for offline use
        secureStorage.setItem('app_last_active', new Date().toISOString());
      } else if (nextAppState === 'active') {
        // Refresh data when app becomes active
        // This will be handled by individual screens
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [dispatch]);
};

// Back handler for Android
const useBackHandler = () => {
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Custom back handling logic
      return false; // Allow default behavior
    });

    return () => backHandler.remove();
  }, []);
};

// Theme persistence
const useThemePersistence = () => {
  const dispatch = useDispatch();
  const { theme } = useSelector((state: RootState) => state.user);

  useEffect(() => {
    // Load saved theme
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem('user_theme');
        if (savedTheme) {
          dispatch(setTheme(JSON.parse(savedTheme)));
        } else {
          // Use system theme
          const colorScheme = Appearance.getColorScheme();
          dispatch(setTheme({
            isDark: colorScheme === 'dark',
            primary: COLORS.BRAND_PURPLE,
            background: colorScheme === 'dark' ? COLORS.DARK_BG : COLORS.LIGHT_BG,
          }));
        }
      } catch (error) {
        crashlytics().recordError(error as Error);
      }
    };

    loadTheme();

    // Listen for system theme changes
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      dispatch(setTheme({
        ...theme,
        isDark: colorScheme === 'dark',
      }));
    });

    return () => subscription?.remove();
  }, [dispatch]);

  // Save theme changes
  useEffect(() => {
    AsyncStorage.setItem('user_theme', JSON.stringify(theme));
  }, [theme]);
};

// Main app navigator
const AppNavigator: React.FC = () => {
  const { isAuthenticated, isLoading } = useSelector((state: RootState) => state.auth);
  const { theme, isOffline } = useSelector((state: RootState) => state.user);
  const [showOnboarding, setShowOnboarding] = useState(false);
  
  // Custom hooks
  const isConnected = useConnectionStatus();
  useAppStateHandler();
  useBackHandler();
  useThemePersistence();

  // Check onboarding status
  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        const hasSeenOnboarding = await AsyncStorage.getItem('has_seen_onboarding');
        setShowOnboarding(!hasSeenOnboarding);
      } catch (error) {
        crashlytics().recordError(error as Error);
      }
    };
    
    checkOnboarding();
  }, []);

  // Create navigation theme
  const navigationTheme = createCustomTheme(theme.isDark, theme);

  // Status bar configuration
  useEffect(() => {
    StatusBar.setBarStyle(theme.isDark ? 'light-content' : 'dark-content');
    if (Platform.OS === 'android') {
      StatusBar.setBackgroundColor(navigationTheme.colors.card);
    }
  }, [theme.isDark, navigationTheme.colors.card]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer theme={navigationTheme}>
        <RootStack.Navigator
          screenOptions={{
            ...screenOptions,
            animationEnabled: true,
            gestureEnabled: true,
          }}
        >
          {isLoading ? (
            <RootStack.Screen 
              name="Splash" 
              component={SplashScreen}
              options={{ headerShown: false }}
            />
          ) : showOnboarding ? (
            <RootStack.Screen 
              name="Onboarding" 
              component={OnboardingScreen}
              options={{ headerShown: false }}
            />
          ) : !isAuthenticated ? (
            <RootStack.Screen 
              name="Auth" 
              component={AuthNavigator}
              options={{ headerShown: false }}
            />
          ) : isOffline ? (
            <RootStack.Screen 
              name="Offline" 
              component={OfflineScreen}
              options={{ headerShown: false }}
            />
          ) : (
            <RootStack.Screen 
              name="Main" 
              component={MainNavigator}
              options={{ headerShown: false }}
            />
          )}
        </RootStack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
};

export default AppNavigator;