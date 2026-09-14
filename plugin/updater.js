/* Public, account-free Motion Plug updater.
 *
 * The panel checks a small JSON release manifest at launch and every 30
 * minutes. A selected update is downloaded, SHA-256 verified, extracted with
 * the operating system's archive tool, then installed through the staged
 * rollback transaction. The new code loads after Premiere restarts.
 * ES5 syntax keeps this compatible with Premiere Pro 2020's CEP runtime. */
(function (global) {
  'use strict';

  var CHECK_EVERY_MS = 30 * 60 * 1000;
  var MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
  var CHECK_KEY = 'motionplug.lastUpdateCheck';
  var INSTALLED_KEY = 'motionplug.updateInstalledTo';
  var autoCheckTimer = null;

  function nreq(name) { return global.CSBridge.require(name); }

  function once(callback) {
    var called = false;
    return function () {
      if (called) return;
      called = true;
      callback.apply(null, arguments);
    };
  }

  function ensureDirSync(directory) {
    var fs = nreq('fs');
    var path = nreq('path');
    if (fs.existsSync(directory)) return;
    var parent = path.dirname(directory);
    if (parent && parent !== directory) ensureDirSync(parent);
    try { fs.mkdirSync(directory); }
    catch (error) { if (!fs.existsSync(directory)) throw error; }
  }

  function semverNewer(a, b) {
    var left = String(a).split('.');
    var right = String(b).split('.');
    for (var i = 0; i < 3; i++) {
      var leftPart = parseInt(left[i], 10) || 0;
      var rightPart = parseInt(right[i], 10) || 0;
      if (leftPart !== rightPart) return leftPart > rightPart;
    }
    return false;
  }

  function validVersion(value) {
    return /^\d+\.\d+\.\d+$/.test(String(value || ''));
  }

  function isAllowedUrl(value) {
    var url = String(value || '');
    if (/^https:\/\//i.test(url)) return true;
    return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(url);
  }

  function resolveUrl(base, value) {
    try { return nreq('url').resolve(base, value); }
    catch (error) { return String(value || ''); }
  }

  function nextAutoCheckDelay() {
    try {
      var last = parseInt(localStorage.getItem(CHECK_KEY), 10) || 0;
      if (!last) return 0;
      var elapsed = Math.max(0, Date.now() - last);
      return Math.max(0, CHECK_EVERY_MS - Math.min(elapsed, CHECK_EVERY_MS));
    } catch (error) {
      return CHECK_EVERY_MS;
    }
  }

  function request(method, address, callback, redirects) {
    callback = once(callback);
    if (!isAllowedUrl(address)) return callback(new Error('The update feed must use HTTPS.'));
    var urlModule;
    var parsed;
    var transport;
    try {
      urlModule = nreq('url');
      parsed = urlModule.parse(address);
      transport = nreq(parsed.protocol === 'http:' ? 'http' : 'https');
    } catch (error) {
      return callback(error);
    }
    var requestHandle = transport.request({
      host: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: method,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'MotionPlug/' + global.MP_VERSION
      }
    }, function (response) {
      if (response.statusCode >= 301 && response.statusCode <= 308 && response.headers.location && (redirects || 0) < 5) {
        response.resume();
        return request(method, resolveUrl(address, response.headers.location), callback, (redirects || 0) + 1);
      }
      var body = '';
      response.on('data', function (chunk) {
        body += chunk;
        if (body.length > 1024 * 1024) requestHandle.abort();
      });
      response.on('end', function () { callback(null, response.statusCode, body); });
      response.on('error', callback);
    });
    requestHandle.setTimeout(20000, function () {
      requestHandle.abort();
      callback(new Error('The update check timed out.'));
    });
    requestHandle.on('error', callback);
    requestHandle.end();
  }

  function normalizeInfo(json, manifestUrl) {
    if (!json || !validVersion(json.version)) throw new Error('The update feed returned an invalid version.');
    var archiveUrl = resolveUrl(manifestUrl, json.url || '');
    var checksum = String(json.sha256 || '').toLowerCase();
    if (!isAllowedUrl(archiveUrl)) throw new Error('The update download must use HTTPS.');
    if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('The update feed is missing a valid SHA-256 checksum.');
    return {
      version: String(json.version),
      notes: String(json.notes || '').slice(0, 10000),
      url: archiveUrl,
      sha256: checksum,
      isNewer: semverNewer(json.version, global.MP_VERSION),
      restartPending: Updater.restartPending()
    };
  }

  function downloadFile(address, destination, onProgress, callback, redirects) {
    callback = once(callback);
    if (!isAllowedUrl(address)) return callback(new Error('The update download must use HTTPS.'));
    var parsed;
    var transport;
    try {
      var urlModule = nreq('url');
      parsed = urlModule.parse(address);
      transport = nreq(parsed.protocol === 'http:' ? 'http' : 'https');
    } catch (error) {
      return callback(error);
    }
    var fs = nreq('fs');
    var requestHandle = transport.get({
      host: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      headers: { 'User-Agent': 'MotionPlug/' + global.MP_VERSION }
    }, function (response) {
      if (response.statusCode >= 301 && response.statusCode <= 308 && response.headers.location && (redirects || 0) < 5) {
        response.resume();
        return downloadFile(resolveUrl(address, response.headers.location), destination, onProgress, callback, (redirects || 0) + 1);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return callback(new Error('Update download failed (HTTP ' + response.statusCode + ').'));
      }
      var total = parseInt(response.headers['content-length'], 10) || 0;
      if (total > MAX_ARCHIVE_BYTES) {
        response.resume();
        return callback(new Error('The update archive is unexpectedly large.'));
      }
      var received = 0;
      var output = fs.createWriteStream(destination);
      response.on('data', function (chunk) {
        received += chunk.length;
        if (received > MAX_ARCHIVE_BYTES) {
          requestHandle.abort();
          output.destroy();
          callback(new Error('The update archive exceeded the size limit.'));
          return;
        }
        if (onProgress && total) onProgress(Math.min(99, Math.round((received / total) * 100)));
      });
      response.pipe(output);
      output.on('close', function () {
        if (onProgress) onProgress(100);
        callback(null);
      });
      output.on('error', callback);
      response.on('error', callback);
    });
    requestHandle.setTimeout(60000, function () {
      requestHandle.abort();
      callback(new Error('The update download timed out.'));
    });
    requestHandle.on('error', callback);
  }

  function verifyChecksum(file, expected) {
    var fs = nreq('fs');
    var crypto = nreq('crypto');
    var actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toLowerCase();
    if (actual !== expected) throw new Error('The update failed its SHA-256 integrity check. No files were installed.');
  }

  function extractZip(zipPath, destination) {
    var childProcess = nreq('child_process');
    var os = nreq('os');
    ensureDirSync(destination);
    if (os.platform() === 'darwin') {
      childProcess.execFileSync('ditto', ['-x', '-k', zipPath, destination], { stdio: 'ignore' });
      return;
    }
    try {
      childProcess.execFileSync('tar.exe', ['-xf', zipPath, '-C', destination], { stdio: 'ignore', windowsHide: true });
      return;
    } catch (tarError) { /* older Windows uses PowerShell below */ }
    var command = 'Expand-Archive -LiteralPath \'' + zipPath.replace(/'/g, "''") +
      '\' -DestinationPath \'' + destination.replace(/'/g, "''") + '\' -Force -ErrorAction Stop';
    childProcess.execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      "$ErrorActionPreference = 'Stop'; " + command
    ], { stdio: 'ignore', windowsHide: true });
  }

  function findPanelRoot(directory) {
    var fs = nreq('fs');
    var path = nreq('path');
    if (fs.existsSync(path.join(directory, 'CSXS', 'manifest.xml'))) return directory;
    var names;
    try { names = fs.readdirSync(directory); }
    catch (error) { return null; }
    for (var i = 0; i < names.length; i++) {
      var candidate = path.join(directory, names[i]);
      try {
        if (fs.statSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, 'CSXS', 'manifest.xml'))) return candidate;
      } catch (candidateError) { /* skip unreadable entries */ }
    }
    return null;
  }

  function cleanWork(fs, path, work) {
    try {
      if (global.MotionPlugUpdateTransaction && fs.existsSync(work)) {
        global.MotionPlugUpdateTransaction.removeTree(fs, path, work);
      }
    } catch (cleanupError) { /* best effort */ }
  }

  function updateWindowsRegistration(version) {
    try {
      if (nreq('os').platform() !== 'win32') return;
      nreq('child_process').execFileSync('reg', [
        'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MotionPlug',
        '/v', 'DisplayVersion', '/t', 'REG_SZ', '/d', version, '/f'
      ], { stdio: 'ignore', windowsHide: true });
    } catch (error) { /* registration is best-effort; the panel is installed */ }
  }

  var Updater = {
    restartPending: function () {
      try {
        var installedVersion = localStorage.getItem(INSTALLED_KEY);
        return !!(installedVersion && semverNewer(installedVersion, global.MP_VERSION));
      } catch (error) { return false; }
    },

    check: function (manual, callback) {
      if (!manual) {
        try {
          var last = parseInt(localStorage.getItem(CHECK_KEY), 10) || 0;
          if (Date.now() - last < CHECK_EVERY_MS) return false;
        } catch (storageError) { /* continue without throttling */ }
      }
      var manifestUrl = global.MP_UPDATE_MANIFEST_URL;
      if (!manifestUrl) {
        if (callback) callback(new Error('No Motion Plug update feed is configured.'));
        return false;
      }
      request('GET', manifestUrl, function (error, status, body) {
        try { localStorage.setItem(CHECK_KEY, String(Date.now())); }
        catch (storageError) { /* storage unavailable */ }
        if (error || status !== 200) {
          if (callback) callback(error || new Error('Version check failed (HTTP ' + status + ').'));
          return;
        }
        var json;
        try { json = JSON.parse(body); }
        catch (parseError) {
          if (callback) callback(new Error('The update feed returned invalid JSON.'));
          return;
        }
        try {
          if (callback) callback(null, normalizeInfo(json, manifestUrl));
        } catch (validationError) {
          if (callback) callback(validationError);
        }
      });
      return true;
    },

    startAutoChecks: function (callback) {
      function scheduleNext() {
        var delay = nextAutoCheckDelay();
        autoCheckTimer = setTimeout(run, delay || CHECK_EVERY_MS);
      }
      function run() {
        autoCheckTimer = null;
        var started = Updater.check(false, function (error, info) {
          if (callback) callback(error, info);
          scheduleNext();
        });
        if (!started) scheduleNext();
      }
      if (autoCheckTimer) clearTimeout(autoCheckTimer);
      run();
    },

    install: function (info, onProgress, callback) {
      callback = once(callback);
      var normalized;
      try { normalized = normalizeInfo(info, global.MP_UPDATE_MANIFEST_URL); }
      catch (error) { return callback(error); }
      if (!normalized.isNewer) return callback(new Error('This Motion Plug build is already current.'));

      var extensionDirectory = global.CSBridge.extensionPath();
      if (!extensionDirectory) return callback(new Error('Could not locate the Motion Plug extension folder.'));
      var fs = nreq('fs');
      var path = nreq('path');
      var os = nreq('os');
      if (fs.existsSync(path.join(extensionDirectory, '.git')) ||
          (fs.existsSync(path.join(extensionDirectory, 'package.json')) && fs.existsSync(path.join(extensionDirectory, 'src')))) {
        return callback(new Error('Automatic updates are disabled for a developer checkout. Install a packaged build to test updates.'));
      }

      var work = fs.mkdtempSync(path.join(os.tmpdir(), 'motionplug-update-'));
      var zipPath = path.join(work, 'update.zip');
      var extracted = path.join(work, 'extracted');
      if (onProgress) onProgress(0);
      downloadFile(normalized.url, zipPath, onProgress, function (downloadError) {
        if (downloadError) {
          cleanWork(fs, path, work);
          return callback(downloadError);
        }
        var processReference = null;
        var movedWorkingDirectory = false;
        try {
          verifyChecksum(zipPath, normalized.sha256);
          extractZip(zipPath, extracted);
          var root = findPanelRoot(extracted);
          if (!root) throw new Error('The downloaded ZIP is not a Motion Plug release.');
          if (!global.MotionPlugUpdateTransaction) throw new Error('The safe update installer is unavailable. Reinstall Motion Plug.');

          processReference = nreq('process');
          var currentDirectory = path.resolve(processReference.cwd());
          var relative = path.relative(path.resolve(extensionDirectory), currentDirectory);
          if (!relative || (relative !== '..' && relative.indexOf('..' + path.sep) !== 0 && !path.isAbsolute(relative))) {
            processReference.chdir(path.dirname(extensionDirectory));
            movedWorkingDirectory = true;
          }

          var stats = global.MotionPlugUpdateTransaction.install(root, extensionDirectory, normalized.version, { fs: fs, path: path });
          if (movedWorkingDirectory) {
            try { processReference.chdir(extensionDirectory); }
            catch (restoreDirectoryError) { /* the parent remains a safe working directory */ }
          }
          updateWindowsRegistration(normalized.version);
          try { localStorage.setItem(INSTALLED_KEY, normalized.version); }
          catch (storageError) { /* the update still succeeded */ }
          cleanWork(fs, path, work);
          callback(null, {
            version: normalized.version,
            copied: stats.copied,
            failed: 0,
            backupPath: stats.backupPath || ''
          });
        } catch (installError) {
          if (movedWorkingDirectory && processReference) {
            try { processReference.chdir(extensionDirectory); }
            catch (restoreError) { /* the parent remains safe */ }
          }
          cleanWork(fs, path, work);
          callback(installError);
        }
      });
    }
  };

  global.MotionPlugUpdater = Updater;
})(window);
