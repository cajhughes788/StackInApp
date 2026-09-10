import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cajetanhughes.stackin',
  appName: 'StackIn',
  webDir: 'out',
  plugins: {
    PushNotifications: {
      // Without this, PushNotificationsHandler.willPresent (see
      // @capacitor/push-notifications' iOS source) returns no presentation
      // options and foreground push notifications show no banner/sound at
      // all. Local notifications aren't affected — their handler always
      // presents regardless of this config.
      presentationOptions: ["badge", "sound", "alert"],
    },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: true,
      iosKeychainPrefix: 'stackin',
      iosBiometric: {
        biometricAuth: false,
        biometricTitle: 'Authenticate',
      },
      androidIsEncryption: true,
      androidBiometric: {
        biometricAuth: false,
        biometricTitle: 'Authenticate',
        biometricSubTitle: 'Open database',
      },
    },
  },

  android: {
    // no scheme in Capacitor 7
  },

  ios: {
    // optional but empty is fine
  }
};

export default config;
