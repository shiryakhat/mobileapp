// Keeps the app locked to portrait (activity screenOrientation) but marks the
// android.hardware.screen.portrait *hardware feature* as optional, so Play does
// not restrict install availability on tablets / desktop / Android XR.
const { withAndroidManifest } = require('@expo/config-plugins');

const FEATURE = 'android.hardware.screen.portrait';

module.exports = function withOptionalPortrait(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-feature'] = manifest['uses-feature'] || [];
    const feats = manifest['uses-feature'];
    const existing = feats.find(
      (f) => f && f.$ && f.$['android:name'] === FEATURE
    );
    if (existing) {
      existing.$['android:required'] = 'false';
    } else {
      feats.push({ $: { 'android:name': FEATURE, 'android:required': 'false' } });
    }
    return cfg;
  });
};
