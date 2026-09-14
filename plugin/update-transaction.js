/* Staged, validated, rollback-safe Motion Plug updates.
 *
 * A downloaded release is copied into a complete sibling directory and
 * validated before the live extension directory is renamed. If either swap
 * or the post-swap validation fails, the original directory is restored.
 * ES5 syntax keeps this compatible with Premiere Pro 2020's CEP runtime. */
(function (global, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.MotionPlugUpdateTransaction = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var MAX_PAYLOAD_BYTES = 1024 * 1024 * 1024;
  var REQUIRED = [
    'CSXS/manifest.xml',
    'index.html',
    'cs-bridge.js',
    'version.js',
    'license.js',
    'update-transaction.js',
    'updater.js',
    'main.js',
    'renderer.html',
    'renderer.js',
    'styles.css',
    'catalog.json',
    'jsx/host.jsx'
  ];

  function ensureDir(fs, path, directory) {
    if (fs.existsSync(directory)) return;
    var parent = path.dirname(directory);
    if (parent && parent !== directory) ensureDir(fs, path, parent);
    try { fs.mkdirSync(directory); }
    catch (error) { if (!fs.existsSync(directory)) throw error; }
  }

  function removeTree(fs, path, target) {
    if (!target || !fs.existsSync(target)) return;
    var stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fs.unlinkSync(target);
      return;
    }
    var names = fs.readdirSync(target);
    for (var i = 0; i < names.length; i++) removeTree(fs, path, path.join(target, names[i]));
    fs.rmdirSync(target);
  }

  function copyTree(fs, path, source, destination, stats) {
    var sourceStat = fs.lstatSync(source);
    if (sourceStat.isSymbolicLink()) {
      throw new Error('The update contains an unsupported symbolic link: ' + path.basename(source) + '.');
    }
    if (!sourceStat.isDirectory()) throw new Error('The update root is not a directory.');
    ensureDir(fs, path, destination);
    try { if (fs.chmodSync) fs.chmodSync(destination, sourceStat.mode & 511); }
    catch (directoryModeError) { /* permissions are best-effort */ }
    var names = fs.readdirSync(source);
    for (var i = 0; i < names.length; i++) {
      var from = path.join(source, names[i]);
      var to = path.join(destination, names[i]);
      var stat = fs.lstatSync(from);
      if (stat.isSymbolicLink()) {
        throw new Error('The update contains an unsupported symbolic link: ' + names[i] + '.');
      }
      if (stat.isDirectory()) {
        copyTree(fs, path, from, to, stats);
      } else if (stat.isFile()) {
        stats.bytes += stat.size;
        if (stats.bytes > MAX_PAYLOAD_BYTES) throw new Error('The extracted update is unexpectedly large.');
        fs.copyFileSync(from, to);
        try { if (fs.chmodSync) fs.chmodSync(to, stat.mode & 511); }
        catch (fileModeError) { /* permissions are best-effort */ }
        stats.copied++;
      }
    }
  }

  function versionFromManifest(text) {
    var match = String(text || '').match(/ExtensionBundleVersion="([0-9]+\.[0-9]+\.[0-9]+)"/);
    return match ? match[1] : '';
  }

  function versionFromScript(text) {
    var match = String(text || '').match(/MP_VERSION\s*=\s*['"]([0-9]+\.[0-9]+\.[0-9]+)['"]/);
    return match ? match[1] : '';
  }

  function localReference(reference) {
    var value = String(reference || '').trim().replace(/^['"]|['"]$/g, '');
    value = value.split('#')[0].split('?')[0];
    if (!value || value.charAt(0) === '#' || /^[a-z][a-z0-9+.-]*:/i.test(value) || /^\/\//.test(value)) return '';
    return value;
  }

  function validateReference(fs, path, root, ownerFile, reference) {
    var value = localReference(reference);
    if (!value) return;
    var target = path.resolve(path.dirname(ownerFile), value);
    var relative = path.relative(root, target);
    if (!relative || relative === '.') return;
    if (relative === '..' || relative.indexOf('..' + path.sep) === 0 || path.isAbsolute(relative)) {
      throw new Error('The update contains an unsafe asset reference: ' + reference + '.');
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error('The update is incomplete (missing referenced asset ' + relative.replace(/\\/g, '/') + ').');
    }
  }

  function validateDocumentReferences(fs, path, root, documentFile) {
    var html = fs.readFileSync(documentFile, 'utf8');
    var assetPattern = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    var match;
    var cssFiles = [];
    while ((match = assetPattern.exec(html))) {
      validateReference(fs, path, root, documentFile, match[1]);
      if (/\.css(?:[?#].*)?$/i.test(match[1])) {
        cssFiles.push(path.resolve(path.dirname(documentFile), localReference(match[1])));
      }
    }
    for (var i = 0; i < cssFiles.length; i++) {
      var css = fs.readFileSync(cssFiles[i], 'utf8');
      var urlPattern = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
      while ((match = urlPattern.exec(css))) validateReference(fs, path, root, cssFiles[i], match[2]);
    }
  }

  function validateCatalogAssets(fs, path, root) {
    var catalog;
    try { catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8')); }
    catch (error) { throw new Error('The update catalog is unreadable.'); }
    if (!Array.isArray(catalog) || !catalog.length) throw new Error('The update catalog is empty.');
    for (var i = 0; i < catalog.length; i++) {
      var preset = catalog[i] || {};
      if (!preset.id || !/^[a-z0-9._-]+$/i.test(preset.id)) throw new Error('The update catalog contains an invalid preset.');
      var files = [
        path.join(root, 'previews', preset.id + '.jpg'),
        path.join(root, 'previews', preset.id + '.mp4'),
        path.join(root, 'sfx', preset.id + '.wav')
      ];
      if (preset.sfx && preset.sfx.sample) files.push(path.join(root, 'sfx', 'samples', preset.sfx.sample + '.wav'));
      for (var j = 0; j < files.length; j++) {
        if (!fs.existsSync(files[j]) || !fs.statSync(files[j]).isFile()) {
          throw new Error('The update is incomplete (missing catalog media for ' + preset.id + ').');
        }
      }
    }
  }

  function validate(fs, path, root, expectedVersion) {
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error('The staged Motion Plug update is missing.');
    }
    if (fs.existsSync(path.join(root, '.git')) || fs.existsSync(path.join(root, 'package.json'))) {
      throw new Error('The update archive contains development files instead of a release payload.');
    }
    for (var i = 0; i < REQUIRED.length; i++) {
      var file = path.join(root, REQUIRED[i]);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        throw new Error('The update is incomplete (missing ' + REQUIRED[i] + ').');
      }
    }
    var manifestText = fs.readFileSync(path.join(root, 'CSXS', 'manifest.xml'), 'utf8');
    if (!/ExtensionBundleId="com\.motionplug"/.test(manifestText) || !/<Extension Id="com\.motionplug\.panel"/.test(manifestText)) {
      throw new Error('The downloaded extension is not Motion Plug.');
    }
    var manifestVersion = versionFromManifest(manifestText);
    var scriptVersion = versionFromScript(fs.readFileSync(path.join(root, 'version.js'), 'utf8'));
    if (!manifestVersion || manifestVersion !== scriptVersion || (expectedVersion && manifestVersion !== String(expectedVersion))) {
      throw new Error('The update version metadata is inconsistent. No files were installed.');
    }
    validateDocumentReferences(fs, path, root, path.join(root, 'index.html'));
    validateDocumentReferences(fs, path, root, path.join(root, 'renderer.html'));
    validateCatalogAssets(fs, path, root);
    return manifestVersion;
  }

  function uniqueSibling(fs, path, liveRoot, label) {
    var parent = path.dirname(liveRoot);
    var base = path.basename(liveRoot) + '.' + label + '-' + Date.now();
    var candidate = path.join(parent, base);
    var suffix = 0;
    while (fs.existsSync(candidate)) {
      suffix++;
      candidate = path.join(parent, base + '-' + suffix);
    }
    return candidate;
  }

  function preserveWindowsUninstaller(fs, path, liveRoot, staging, stats) {
    var name = 'Uninstall Motion Plug.exe';
    var source = path.join(liveRoot, name);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return;
    fs.copyFileSync(source, path.join(staging, name));
    stats.copied++;
    stats.bytes += fs.statSync(source).size;
  }

  function isDeveloperCheckout(fs, path, root) {
    return fs.existsSync(path.join(root, '.git')) ||
      (fs.existsSync(path.join(root, 'package.json')) && fs.existsSync(path.join(root, 'src')));
  }

  function install(sourceRoot, liveRoot, expectedVersion, options) {
    options = options || {};
    var fs = options.fs;
    var path = options.path;
    if (!fs || !path) throw new Error('File-system services are unavailable for the update.');
    validate(fs, path, sourceRoot, expectedVersion);
    if (!liveRoot || !fs.existsSync(liveRoot) || !fs.statSync(liveRoot).isDirectory()) {
      throw new Error('The live Motion Plug folder is missing. Reinstall Motion Plug.');
    }
    if (isDeveloperCheckout(fs, path, liveRoot)) {
      throw new Error('Automatic updates cannot replace a developer checkout. Use a packaged installation.');
    }

    var staging = uniqueSibling(fs, path, liveRoot, 'update-staging');
    var backup = uniqueSibling(fs, path, liveRoot, 'rollback');
    var stats = { copied: 0, bytes: 0 };
    var liveMoved = false;
    var rejected = '';

    try {
      copyTree(fs, path, sourceRoot, staging, stats);
      preserveWindowsUninstaller(fs, path, liveRoot, staging, stats);
      validate(fs, path, staging, expectedVersion);
      if (options.beforeSwap) options.beforeSwap(staging, liveRoot);
      fs.renameSync(liveRoot, backup);
      liveMoved = true;
      fs.renameSync(staging, liveRoot);
      validate(fs, path, liveRoot, expectedVersion);
    } catch (error) {
      if (liveMoved && fs.existsSync(liveRoot)) {
        rejected = uniqueSibling(fs, path, liveRoot, 'rejected-update');
        try { fs.renameSync(liveRoot, rejected); }
        catch (rejectMoveError) {
          try { removeTree(fs, path, liveRoot); }
          catch (rejectCleanupError) { /* rollback message below names the backup */ }
        }
      }
      if (liveMoved && !fs.existsSync(liveRoot) && fs.existsSync(backup)) {
        try { fs.renameSync(backup, liveRoot); }
        catch (rollbackError) {
          error.message += ' Rollback could not restore the live folder. The original remains at ' + backup + '.';
        }
      } else if (liveMoved && fs.existsSync(backup)) {
        error.message += ' The original installation remains recoverable at ' + backup + '.';
      }
      try { if (fs.existsSync(staging)) removeTree(fs, path, staging); }
      catch (cleanupError) { /* do not hide the install failure */ }
      try { if (rejected && fs.existsSync(rejected)) removeTree(fs, path, rejected); }
      catch (rejectedCleanupError) { /* do not hide the install failure */ }
      throw error;
    }

    var backupPath = '';
    try { removeTree(fs, path, backup); }
    catch (backupCleanupError) { backupPath = backup; }
    return {
      version: String(expectedVersion || ''),
      copied: stats.copied,
      bytes: stats.bytes,
      failed: 0,
      backupPath: backupPath
    };
  }

  return {
    REQUIRED: REQUIRED,
    install: install,
    validate: validate,
    removeTree: removeTree
  };
});
