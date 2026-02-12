const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { wrapWithReanimatedMetroConfig } = require('react-native-reanimated/metro-config');

// Get default Metro configuration
const defaultConfig = getDefaultConfig(__dirname);

/**
 * Metro configuration for ONXLink
 * Optimized for performance, security, and offline capabilities
 */
const config = {
  transformer: {
    // Enable inline requires for better performance
    inlineRequires: true,
    
    // Asset plugins for optimized bundling
    assetPlugins: ['react-native-svg-asset-plugin'],
    
    // Minifier options for production builds
    minifierConfig: {
      keep_fnames: true,
      mangle: {
        keep_fnames: true,
      },
    },
    
    // Platform-specific transformations
    platforms: ['ios', 'android', 'native', 'web'],
    
    // Experimental features for better performance
    experimentalImportSupport: true,
    unstable_allowRequireContext: true,
  },

  resolver: {
    // Asset extensions for multimedia content
    assetExts: [
      ...defaultConfig.resolver.assetExts,
      'db',
      'sqlite',
      'sqlite3',
      'ttf',
      'otf',
      'woff',
      'woff2',
      'eot',
      'ico',
      'webp',
      'gif',
      'mp4',
      'webm',
      'wav',
      'mp3',
      'ogg',
      'aac',
      'm4a',
      'json5',
      'yml',
      'yaml',
    ],

    // Source extensions for code files
    sourceExts: [
      ...defaultConfig.resolver.sourceExts,
      'ts',
      'tsx',
      'js',
      'jsx',
      'json',
      'mjs',
      'cjs',
      'svg',
    ],

    // Platform-specific extensions
    platforms: ['ios', 'android', 'native', 'web'],

    // Alias mappings for cleaner imports
    alias: {
      '@': './src',
      '@components': './src/components',
      '@screens': './src/screens',
      '@services': './src/services',
      '@store': './src/store',
      '@utils': './src/utils',
      '@assets': './src/assets',
      '@types': './src/types',
      '@navigation': './src/navigation',
      '@hooks': './src/hooks',
      '@constants': './src/utils/constants',
      '@config': './src/config',
      '@i18n': './src/utils/i18n',
      '@offline': './src/offline',
      '@security': './src/security',
      '@theme': './src/theme',
    },

    // Node modules to avoid transforming
    blockList: [
      /node_modules\/react-native-vector-icons\/.*\.js$/,
      /node_modules\/react-native-reanimated\/.*\.js$/,
    ],

    // Unstable features for better module resolution
    unstable_enableSymlinks: false,
    unstable_enablePackageExports: true,
  },

  serializer: {
    // Custom serializer options for optimized bundles
    getModulesRunBeforeMainModule: () => [
      require.resolve('./src/utils/polyfills'),
      require.resolve('./src/offline/bootstrap'),
    ],

    // Custom process for module filtering
    createModuleIdFactory: () => (path) => {
      // Create deterministic module IDs for better caching
      const crypto = require('crypto');
      return crypto.createHash('sha1').update(path).digest('hex').substr(0, 8);
    },

    // Experimental serializer features
    experimentalSerializerHook: (graph, delta) => {
      // Custom logic for bundle optimization
      return delta;
    },
  },

  server: {
    // Development server configuration
    port: 8081,
    
    // Enable HTTP/2 for better performance
    enhanceMiddleware: (middleware) => {
      return (req, res, next) => {
        // Add security headers
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        
        // CORS configuration for development
        if (process.env.NODE_ENV === 'development') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        }
        
        return middleware(req, res, next);
      };
    },
  },

  watchFolders: [
    // Watch additional folders for changes
    './src',
    './assets',
    './locales',
    '../shared', // If you have shared code between platforms
  ],

  cacheStores: [
    // Custom cache stores for better performance
    {
      get: (key) => {
        // Custom cache retrieval logic
        return null;
      },
      set: (key, value) => {
        // Custom cache storage logic
      },
    },
  ],

  maxWorkers: (() => {
    // Optimize worker count based on system capabilities
    const os = require('os');
    const cpuCount = os.cpus().length;
    
    if (process.env.NODE_ENV === 'production') {
      return Math.max(1, Math.floor(cpuCount * 0.8));
    }
    
    return Math.max(1, Math.floor(cpuCount * 0.6));
  })(),

  // Custom transformerPath for advanced transformations
  transformerPath: require.resolve('./metro.transformer.js'),

  // Performance optimizations
  resetCache: process.env.METRO_RESET_CACHE === 'true',
};

// Security enhancements for production builds
if (process.env.NODE_ENV === 'production') {
  config.transformer.minifierConfig = {
    ...config.transformer.minifierConfig,
    keep_classnames: false,
    keep_fnames: false,
    mangle: {
      toplevel: true,
      keep_classnames: false,
      keep_fnames: false,
      properties: {
        regex: /^_/,
      },
    },
    compress: {
      drop_console: true,
      drop_debugger: true,
      pure_funcs: ['console.log', 'console.info', 'console.debug'],
    },
  };
}

// Environment-specific configurations
const envConfig = (() => {
  switch (process.env.NODE_ENV) {
    case 'development':
      return {
        transformer: {
          ...config.transformer,
          inlineRequires: false, // Better debugging
        },
        server: {
          ...config.server,
          port: process.env.METRO_PORT || 8081,
        },
      };
      
    case 'production':
      return {
        transformer: {
          ...config.transformer,
          inlineRequires: true,
          getTransformOptions: async () => ({
            transform: {
              experimentalImportSupport: false,
              inlineRequires: true,
            },
          }),
        },
      };
      
    case 'test':
      return {
        resolver: {
          ...config.resolver,
          sourceExts: [...config.resolver.sourceExts, 'test.ts', 'test.tsx'],
        },
      };
      
    default:
      return {};
  }
})();

// Merge environment-specific config
const finalConfig = mergeConfig(defaultConfig, {
  ...config,
  ...envConfig,
});

// Wrap with Reanimated config for animations
module.exports = wrapWithReanimatedMetroConfig(finalConfig);

// Export additional utilities for build scripts
module.exports.createAssetResolver = (platform) => {
  return (asset) => {
    // Custom asset resolution logic
    const scaleSuffix = asset.httpServerLocation.includes('@2x') ? '@2x' : 
                       asset.httpServerLocation.includes('@3x') ? '@3x' : '';
    
    return {
      ...asset,
      httpServerLocation: asset.httpServerLocation,
      hash: require('crypto')
        .createHash('md5')
        .update(asset.httpServerLocation)
        .digest('hex')
        .substring(0, 8),
    };
  };
};

// Bundle analyzer helper
module.exports.analyzeBundleSize = (bundlePath) => {
  const fs = require('fs');
  const path = require('path');
  
  if (fs.existsSync(bundlePath)) {
    const stats = fs.statSync(bundlePath);
    const fileSizeInBytes = stats.size;
    const fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);
    
    console.log(`Bundle size: ${fileSizeInMegabytes.toFixed(2)} MB`);
    
    // Warn if bundle is too large
    if (fileSizeInMegabytes > 50) {
      console.warn('⚠️  Bundle size is large. Consider code splitting.');
    }
  }
};

// Offline cache configuration
module.exports.offlineConfig = {
  assetCachePatterns: [
    /\.(png|jpg|jpeg|gif|webp|svg)$/,
    /\.(ttf|otf|woff|woff2|eot)$/,
    /\.(json|yml|yaml)$/,
  ],
  
  serviceCachePatterns: [
    /\/api\/content\/templates/,
    /\/api\/user\/profile/,
    /\/api\/subscription\/tiers/,
  ],
  
  offlineAssets: [
    'src/assets/images/logo.png',
    'src/assets/images/placeholder.png',
    'src/assets/fonts/*',
    'src/assets/locales/*.json',
  ],
};

// Security configuration
module.exports.securityConfig = {
  // Disable source maps in production
  sourceMaps: process.env.NODE_ENV !== 'production',
  
  // Bundle obfuscation settings
  obfuscation: {
    enabled: process.env.NODE_ENV === 'production',
    stringArrayThreshold: 0.8,
    rotateStringArray: true,
    shuffleStringArray: true,
    splitStrings: true,
    splitStringsChunkLength: 5,
  },
  
  // Asset integrity checks
  assetIntegrity: process.env.NODE_ENV === 'production',
};

// Performance monitoring
if (process.env.ENABLE_PERF_MONITORING === 'true') {
  const originalTransform = finalConfig.transformer.transform;
  
  finalConfig.transformer.transform = function(params) {
    const start = Date.now();
    const result = originalTransform.call(this, params);
    const duration = Date.now() - start;
    
    if (duration > 1000) {
      console.log(`⚠️  Slow transform: ${params.filename} (${duration}ms)`);
    }
    
    return result;
  };
}

// Debug logging for development
if (process.env.NODE_ENV === 'development' && process.env.METRO_DEBUG === 'true') {
  console.log('🚀 Metro Config Loaded');
  console.log('📱 Platforms:', finalConfig.resolver.platforms);
  console.log('🔧 Source Extensions:', finalConfig.resolver.sourceExts);
  console.log('📦 Asset Extensions:', finalConfig.resolver.assetExts.slice(0, 10), '...');
  console.log('🎯 Aliases:', Object.keys(finalConfig.resolver.alias));
  console.log('⚡ Max Workers:', finalConfig.maxWorkers);
}