import { ConfigContext, ExpoConfig } from "expo/config";
import { APP_NAME, APP_SLUG } from "@packages/shared";

const IS_DEV = process.env.APP_VARIANT === "development";
const IS_PREVIEW = process.env.APP_VARIANT === "preview";

const getUniqueIdentifier = () => {
  if (IS_DEV) {
    return `com.${APP_SLUG}.dev`;
  }

  if (IS_PREVIEW) {
    return `com.${APP_SLUG}.preview`;
  }

  return `com.${APP_SLUG}`;
};

const getAppName = () => {
  if (IS_DEV) {
    return `${APP_NAME} (Dev)`;
  }

  if (IS_PREVIEW) {
    return `${APP_NAME} (Preview)`;
  }

  return APP_NAME;
};

export const getGoogleServicesJson = () => {
  if (IS_DEV) {
    return "./google-services-dev.json";
  }

  if (IS_PREVIEW) {
    return "./google-services-preview.json";
  }

  return "./google-services.json";
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  name: getAppName(),
  slug: APP_SLUG,
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: APP_SLUG,
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: false,
    bundleIdentifier: getUniqueIdentifier(),
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: getUniqueIdentifier(),
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    // googleServicesFile: getGoogleServicesJson(),
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
    bundler: "metro",
  },
  plugins: [
    "expo-camera",
    "expo-image",
    "expo-image-picker",
    "expo-media-library",
    "expo-notifications",
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  owner: "nativesquare-expo",
  extra: {
    router: {},
    /**
     * #394 — `criticalIndex` of the « couche OTA » of the boot force-update
     * gate (PRD 20 §13 + [ADR 0017](../../docs/adr/0017-force-update-expo-pattern-deux-couches.md)).
     *
     * Strict monotonic counter (integer ≥ 0) BUMPED BY HAND in the same commit
     * that publishes a critical OTA hotfix. At boot the native gate compares
     * the incoming bundle's `criticalIndex` (from
     * `Updates.checkForUpdateAsync().manifest.extra.expoClient.extra.criticalIndex`)
     * to the running one (this constant via `Constants.expoConfig.extra.criticalIndex`):
     * if incoming > running, the app fetches + reloads ON SPLASH, the user
     * never sees the old code.
     *
     * NEVER decrement, NEVER skip — every bump is a fleet-wide forced reload.
     * Non-critical updates keep this value unchanged (the regular EAS Update
     * flow then applies on next manual reload, not at boot).
     */
    criticalIndex: 0,
  },
  /**
   * #394 — `runtimeVersion: "fingerprint"` (Expo SDK 52+) is the ADR 0017
   * prerequisite that lets EAS Update exclude bundles incompatible with the
   * binary actually installed on the device. With the previous `appVersion`
   * policy, two binaries with the same `version` would share a bundle channel
   * even if their native modules diverged — a critical OTA push could ship JS
   * relying on a native API the older binary doesn't have, hard-crash on boot,
   * and we have no escape hatch (the user is stuck before the gate can render).
   * `fingerprint` keys the bundle channel on the actual native fingerprint, so
   * an incompatible binary never even SEES the incoming critical bundle.
   */
  runtimeVersion: "fingerprint",
});
