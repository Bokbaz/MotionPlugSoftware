/* Motion Plug runtime version and public update-feed configuration.
 * build-release.sh keeps MP_VERSION synchronized with package.json and the
 * CEP manifest. The update feed is public; no account or license is involved. */
(function (global) {
  'use strict';

  global.MP_VERSION = '0.3.1';
  /* The feed is served by the Caption Plug site deployment, which is where
   * Motion Plug's pages, checkout, and release storage already live.
   * motionplug.com is not pointed at that deployment, so it must not be the
   * default: the panel would silently fail every update check. */
  global.MP_UPDATE_MANIFEST_URL = 'https://www.captionplug.com/api/motion-plug/latest';

  /* Local testing override:
   * localStorage.setItem('motionplug.updateManifestUrl',
   *   'http://localhost:4173/latest.json'); */
  try {
    var override = localStorage.getItem('motionplug.updateManifestUrl');
    if (override) global.MP_UPDATE_MANIFEST_URL = override;
  } catch (error) { /* storage unavailable */ }
})(window);
