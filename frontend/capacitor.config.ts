import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.stackin',
  appName: 'StackIn',
  webDir: 'out',
  plugins: {
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
