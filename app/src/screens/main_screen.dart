import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:cached_network_image/cached_network_image.dart';

import '../services/auth_service.dart';
import '../services/subscription_service.dart';
import '../services/api_service.dart';
import '../services/offline_service.dart';
import '../models/user_model.dart';
import '../utils/environment.dart';
import '../utils/error_handler.dart';
import 'freemium_dashboard.dart';
import 'premium_dashboard.dart';
import 'enterprise_dashboard.dart';
import 'offline_content_screen.dart';
import 'upgrade_screen.dart';
import '../widgets/connectivity_banner.dart';

class MainScreen extends StatefulWidget {
  const MainScreen({Key? key}) : super(key: key);

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> with WidgetsBindingObserver {
  late StreamSubscription<ConnectivityResult> _connectivitySubscription;
  bool _isOnline = true;
  bool _isLoadingProfile = true;
  UserModel? _cachedUser;
  Map<String, dynamic> _offlineContent = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initConnectivity();
    _loadCachedData();
    _fetchUserProfile();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkConnectivity();
    }
  }

  Future<void> _initConnectivity() async {
    // Initial connectivity check
    _checkConnectivity();
    
    // Subscribe to connectivity changes
    _connectivitySubscription = Connectivity()
        .onConnectivityChanged
        .listen((ConnectivityResult result) {
      setState(() {
        _isOnline = result != ConnectivityResult.none;
      });
      
      // Refresh data when coming back online
      if (_isOnline) {
        _fetchUserProfile();
        Provider.of<SubscriptionService>(context, listen: false).init();
      }
    });
  }

  Future<void> _checkConnectivity() async {
    final connectivityResult = await Connectivity().checkConnectivity();
    setState(() {
      _isOnline = connectivityResult != ConnectivityResult.none;
    });
  }

  Future<void> _loadCachedData() async {
    final offlineService = Provider.of<OfflineService>(context, listen: false);
    
    // Load cached user profile
    _cachedUser = await offlineService.getCachedUserProfile();
    
    // Load cached content
    _offlineContent = await offlineService.getCachedContent();
    
    if (mounted) {
      setState(() {
        _isLoadingProfile = false;
      });
    }
  }

  Future<void> _fetchUserProfile() async {
    if (!_isOnline) return;

    setState(() => _isLoadingProfile = true);
    
    try {
      final authService = Provider.of<AuthService>(context, listen: false);
      final offlineService = Provider.of<OfflineService>(context, listen: false);
      
      if (authService.currentUser != null) {
        final apiService = Provider.of<ApiService>(context, listen: false);
        final user = await apiService.getUserProfile(authService.currentUser!.id);
        
        // Cache the fetched profile
        await offlineService.cacheUserProfile(user);
        
        setState(() {
          _cachedUser = user;
          _isLoadingProfile = false;
        });
      }
    } on ApiException catch (e) {
      ErrorHandler.showError(context, e);
      setState(() => _isLoadingProfile = false);
    }
  }

  UserModel? get _effectiveUser {
    final authService = Provider.of<AuthService>(context, listen: false);
    return _cachedUser ?? authService.currentUser;
  }

  @override
  void dispose() {
    _connectivitySubscription.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final subscription = context.watch<SubscriptionService>();
    final tier = subscription.tier;
    final localizations = AppLocalizations.of(context)!;

    return Scaffold(
      appBar: AppBar(
        title: Text(Environment.appName),
        actions: [
          if (_effectiveUser != null) ...[
            IconButton(
              icon: _effectiveUser!.photoUrl.isNotEmpty
                  ? CircleAvatar(
                      backgroundImage: CachedNetworkImageProvider(
                        _effectiveUser!.photoUrl,
                        errorListener: () => const Icon(Icons.error),
                      ),
                    )
                  : const Icon(Icons.account_circle),
              onPressed: () => _showAccountDialog(context),
            ),
          ],
        ],
      ),
      body: Column(
        children: [
          if (!_isOnline) ConnectivityBanner(isOnline: _isOnline),
          Expanded(
            child: _isLoadingProfile
                ? const Center(child: CircularProgressIndicator())
                : _isOnline
                    ? _buildOnlineContent(tier)
                    : OfflineContentScreen(
                        cachedContent: _offlineContent,
                        user: _effectiveUser,
                      ),
          ),
        ],
      ),
      floatingActionButton: tier == 'freemium' && _isOnline
          ? FloatingActionButton.extended(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => const UpgradeScreen(),
                ),
              ),
              label: Text(localizations.upgradeButton),
              icon: const Icon(Icons.rocket_launch),
            )
          : null,
    );
  }

  Widget _buildOnlineContent(String tier) {
    switch (tier) {
      case 'enterprise':
        return const EnterpriseDashboard();
      case 'premium':
        return const PremiumDashboard();
      default:
        return const FreemiumDashboard();
    }
  }

  void _showAccountDialog(BuildContext context) {
    final localizations = AppLocalizations.of(context)!;
    final authService = Provider.of<AuthService>(context, listen: false);
    final subscription = Provider.of<SubscriptionService>(context, listen: false);

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(localizations.accountSettings),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_effectiveUser != null) ...[
              ListTile(
                leading: const Icon(Icons.person),
                title: Text(_effectiveUser!.name),
                subtitle: Text(_effectiveUser!.email),
              ),
              const Divider(),
            ],
            ListTile(
              leading: const Icon(Icons.credit_card),
              title: Text(localizations.subscription),
              subtitle: Text(
                '${localizations.currentPlan}: ${subscription.tier.toUpperCase()}',
              ),
              onTap: () => _showSubscriptionManagement(context),
            ),
            ListTile(
              leading: const Icon(Icons.security),
              title: Text(localizations.securitySettings),
              onTap: _showSecuritySettings,
            ),
            ListTile(
              leading: const Icon(Icons.logout),
              title: Text(localizations.signOut),
              onTap: () {
                authService.signOut();
                Navigator.pushNamedAndRemoveUntil(
                  context, 
                  '/login', 
                  (route) => false
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showSecuritySettings() {
    // Navigate to biometric/security settings screen
    // Implementation would depend on your security setup
  }

  void _showSubscriptionManagement(BuildContext context) {
    final subscription = Provider.of<SubscriptionService>(context, listen: false);
    final localizations = AppLocalizations.of(context)!;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => Container(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '${localizations.currentPlan}: ${subscription.tier.toUpperCase()}',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 20),
            if (subscription.products.isNotEmpty)
              ...subscription.products.map((product) => ListTile(
                    title: Text(product.title),
                    subtitle: Text(product.description),
                    trailing: Text(product.price),
                    onTap: () => subscription.purchaseProduct(product),
                  )),
            const SizedBox(height: 20),
            if (subscription.tier != 'freemium')
              TextButton(
                onPressed: () => _showCancelSubscriptionDialog(context),
                child: Text(
                  localizations.cancelSubscription,
                  style: const TextStyle(color: Colors.red),
                ),
              ),
            TextButton(
              onPressed: subscription.restorePurchases,
              child: Text(localizations.restorePurchases),
            ),
            const SizedBox(height: MediaQuery.of(context).viewInsets.bottom),
          ],
        ),
      ),
    );
  }

  void _showCancelSubscriptionDialog(BuildContext context) {
    final localizations = AppLocalizations.of(context)!;
    
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(localizations.confirmCancelSubscription),
        content: Text(localizations.cancelSubscriptionWarning),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(localizations.back),
          ),
          TextButton(
            onPressed: () {
              // Implement subscription cancellation logic
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(localizations.subscriptionCancelled)),
              );
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: Text(localizations.confirmCancel),
          ),
        ],
      ),
    );
  }
}