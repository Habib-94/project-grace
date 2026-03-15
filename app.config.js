require('dotenv/config');
const { withAndroidManifest } = require('@expo/config-plugins');

/** Injects EXPO_PUBLIC_GOOGLE_MAPS_API_KEY into the AndroidManifest meta-data during prebuild */
const withGoogleMapsKey = (config) => {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) return cfg;
    application['meta-data'] = application['meta-data'] ?? [];
    const keyName = 'com.google.android.geo.API_KEY';
    const idx = application['meta-data'].findIndex(
      (m) => m.$?.['android:name'] === keyName
    );
    const entry = {
      $: {
        'android:name': keyName,
        'android:value': process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
      },
    };
    if (idx >= 0) application['meta-data'][idx] = entry;
    else application['meta-data'].push(entry);
    return cfg;
  });
};

module.exports = ({ config }) => withGoogleMapsKey({
  ...config,
  name: 'Project Grace',
  slug: 'project-grace',
  owner: 'kaney94',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'projectgrace',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  updates: {
    url: 'https://u.expo.dev/8263e92c-1f0d-438d-98cd-4287e8f79437',
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
  icon: './assets/images/icon.png',
  splash: {
    image: './assets/images/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.projectgrace.app',
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? './GoogleService-Info.plist',
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    package: 'com.projectgrace.app',
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
    ],
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-location',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
      },
    ],
    '@react-native-firebase/app',
    '@react-native-firebase/auth',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: { origin: false },
    eas: { projectId: '8263e92c-1f0d-438d-98cd-4287e8f79437' },
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
    googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
  },
});
