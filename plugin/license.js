/* license.js - account sign-in + license validation against captionplug.com.
 *
 * Motion Plug and Caption Plug share one account. A Motion Plug purchase mints
 * an MP- license on the same captionplug.com user, so the panel signs in with
 * that email and password once per machine: it posts to /api/plugin/signin
 * with product 'motion_plug', the server checks the password with Supabase,
 * finds the Motion Plug license, registers this machine as an activation slot,
 * and returns the license key plus an HMAC activation signature minted
 * server-side. Key + machine hash + signature are cached in
 * ~/.motionplug/license.json (survives panel updates and reinstalls) and
 * silently revalidated in the background at most once a day. The password
 * itself is never stored.
 *
 * Refunds reach the panel here: the Stripe webhook revokes the license row,
 * and the next revalidation answers 403, which signs this machine out.
 *
 * Honest-by-design: the panel only DEACTIVATES on an explicit 403 from the
 * server (revoked / slot freed). Network failures never lock a paying user
 * out of their editor.
 *
 * ES5 syntax keeps this compatible with Premiere Pro 2020's CEP runtime. It
 * talks HTTP through the panel's Node, so no CORS is involved.
 */

(function (global) {
  'use strict';

  var PRODUCT = 'motion_plug';
  var REVALIDATE_MS = 24 * 60 * 60 * 1000; // background recheck cadence
  var REQUEST_TIMEOUT_MS = 15000;

  function nreq(name) { return global.CSBridge.require(name); }

  /* CSBridge.available only says a CEP host is present. The account layer also
   * needs Node, which a panel loaded without --enable-nodejs does not have.
   * Without it nothing here can succeed, so the panel skips the account layer
   * entirely rather than showing a sign-in wall that can never be passed. */
  var nodeReady = null;
  function nodeAvailable() {
    if (nodeReady !== null) return nodeReady;
    try {
      nreq('fs');
      nreq('path');
      nreq('os');
      nreq('crypto');
      nreq('https');
      nodeReady = true;
    } catch (error) {
      nodeReady = false;
    }
    return nodeReady;
  }

  function ensureDirSync(fs, path, directory) {
    if (fs.existsSync(directory)) return;
    var parent = path.dirname(directory);
    if (parent && parent !== directory) ensureDirSync(fs, path, parent);
    try { fs.mkdirSync(directory); }
    catch (error) { if (!fs.existsSync(directory)) throw error; }
  }

  /* ------------------------------ machine id ------------------------- */

  var cachedMachineHash = null;

  function licenseDir() {
    return nreq('path').join(nreq('os').homedir(), '.motionplug');
  }

  function stateFile() { return nreq('path').join(licenseDir(), 'license.json'); }
  function deviceFile() { return nreq('path').join(licenseDir(), 'device.json'); }

  function validHash(value) { return /^[a-f0-9]{64}$/i.test(String(value || '')); }

  function saveDeviceHash(value) {
    try {
      var fs = nreq('fs');
      var path = nreq('path');
      ensureDirSync(fs, path, licenseDir());
      fs.writeFileSync(deviceFile(), JSON.stringify({ version: 1, machineHash: value }, null, 2), 'utf8');
    } catch (error) { /* the in-memory value stays stable for this session */ }
  }

  /* A random per-machine identifier, written once and reused. It is not
   * derived from hardware, so a cloned license.json cannot masquerade as the
   * machine it was copied from: the hash in the file won't match this one. */
  function machineHash() {
    if (cachedMachineHash) return cachedMachineHash;
    var fs = nreq('fs');
    var crypto = nreq('crypto');
    try {
      var saved = JSON.parse(fs.readFileSync(deviceFile(), 'utf8'));
      if (saved && validHash(saved.machineHash)) {
        cachedMachineHash = String(saved.machineHash).toLowerCase();
        return cachedMachineHash;
      }
    } catch (readError) { /* first run, or a damaged device file */ }

    var seed;
    try { seed = crypto.randomBytes(32).toString('hex'); }
    catch (randomError) { seed = String(Date.now()) + '|' + Math.random() + '|' + Math.random(); }
    cachedMachineHash = crypto.createHash('sha256').update(seed).digest('hex').toLowerCase();
    saveDeviceHash(cachedMachineHash);
    return cachedMachineHash;
  }

  function machineLabel() {
    try {
      var os = nreq('os');
      var platform = os.platform() === 'darwin' ? 'macOS' : (os.platform() === 'win32' ? 'Windows' : os.platform());
      return (os.hostname() || 'machine').replace(/\.local$/, '') + ' (' + platform + ')';
    } catch (error) {
      return 'this machine';
    }
  }

  /* ---------------------------- state on disk ------------------------ */

  // {email, licenseKey, machineHash, signature, activatedAt, lastValidatedAt}
  var state = null;

  function loadState() {
    try {
      var saved = JSON.parse(nreq('fs').readFileSync(stateFile(), 'utf8'));
      var currentHash = null;
      try { currentHash = machineHash(); }
      catch (hashError) { currentHash = null; }
      // A license file copied from another machine carries the wrong hash.
      // Ignore it and ask for a normal sign-in here.
      if (saved && saved.licenseKey && saved.signature && currentHash && saved.machineHash === currentHash) {
        state = saved;
      }
    } catch (error) { state = null; }
  }

  function saveState() {
    try {
      var fs = nreq('fs');
      var path = nreq('path');
      ensureDirSync(fs, path, licenseDir());
      fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf8');
    } catch (error) { /* read-only disk - the session still works from memory */ }
  }

  function clearState() {
    state = null;
    try { nreq('fs').unlinkSync(stateFile()); }
    catch (error) { /* already gone */ }
  }

  /* ------------------------------- http ------------------------------ */

  /** POST JSON to the website API. callback(error, status, json). */
  function api(method, pathname, body, callback) {
    var finished = false;
    function finish(error, status, json) {
      if (finished) return;
      finished = true;
      callback(error, status, json);
    }

    try {
      var parsed = nreq('url').parse(global.MP_API_BASE + pathname);
      var transport = nreq(parsed.protocol === 'http:' ? 'http' : 'https');
      var payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
      var headers = { 'User-Agent': 'MotionPlug/' + global.MP_VERSION };
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = payload.length;
      }
      var request = transport.request({
        host: parsed.hostname,
        port: parsed.port,
        path: parsed.path,
        method: method,
        headers: headers
      }, function (response) {
        var data = '';
        var ended = false;
        response.on('data', function (chunk) { data += chunk; });
        response.on('error', function (error) { finish(error); });
        response.on('aborted', function () { finish(new Error('The server response was interrupted.')); });
        response.on('close', function () {
          if (!ended) finish(new Error('The server response closed before it completed.'));
        });
        response.on('end', function () {
          ended = true;
          var json = null;
          try { json = JSON.parse(data); }
          catch (parseError) { /* a non-JSON body is reported through the status */ }
          finish(null, response.statusCode, json);
        });
      });
      request.setTimeout(REQUEST_TIMEOUT_MS, function () {
        finish(new Error('The request timed out.'));
        request.abort();
      });
      request.on('error', function (error) { finish(error); });
      if (payload) request.write(payload);
      request.end();
    } catch (setupError) {
      finish(setupError);
    }
  }

  /* ------------------------------ public ----------------------------- */

  var listeners = [];
  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); }
      catch (error) { /* a listener's failure stays its own */ }
    }
  }

  var License = {
    /** True when the account layer can run here at all (CEP with Node). */
    available: nodeAvailable,

    /** True when this machine holds a cached, server-minted activation. */
    ok: function () { return !!state; },

    /** Account email shown in the panel. */
    email: function () { return (state && state.email) || ''; },

    keyTail: function () { return state ? String(state.licenseKey).slice(-5) : ''; },

    machineLabel: machineLabel,

    activationsUsed: function () { return state ? state.activationsUsed : undefined; },

    activationLimit: function () { return state ? state.activationLimit : undefined; },

    onChange: function (listener) { listeners.push(listener); },

    /**
     * Sign in with the captionplug.com account and activate this machine.
     * callback(error) - error.message is user-presentable; error.code
     * distinguishes 'no-license' (signed in fine, no Motion Plug purchase)
     * and 'revoked' (refunded) so the panel can offer the right next step.
     */
    signIn: function (email, password, callback) {
      email = String(email || '').trim().toLowerCase();
      password = String(password || '');
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        return callback(new Error('That does not look like an email address.'));
      }
      if (!password) return callback(new Error('Enter your password.'));

      var currentHash;
      try { currentHash = machineHash(); }
      catch (identityError) {
        return callback(new Error('Motion Plug could not identify this machine. Restart Premiere Pro and try again.'));
      }

      api('POST', '/api/plugin/signin', {
        email: email,
        password: password,
        product: PRODUCT,
        machineHash: currentHash,
        machineLabel: machineLabel()
      }, function (error, status, json) {
        if (error) {
          return callback(new Error('Could not reach captionplug.com (' + error.message + '). Check your internet connection and try again.'));
        }
        if (status !== 200 || !json || !json.signature || !json.licenseKey) {
          var failure = new Error((json && json.error) || 'Sign-in failed (HTTP ' + status + '). Try again.');
          if (json && json.code) failure.code = json.code;
          return callback(failure);
        }
        state = {
          email: json.email || email,
          licenseKey: json.licenseKey,
          machineHash: currentHash,
          signature: json.signature,
          activatedAt: new Date().toISOString(),
          lastValidatedAt: Date.now(),
          activationsUsed: json.activationsUsed,
          activationLimit: json.activationLimit
        };
        saveState();
        notify();
        callback(null);
      });
    },

    /**
     * Background revalidation - at most once per REVALIDATE_MS, never blocks
     * anything. Only an explicit 403 deactivates, which is what a refund or a
     * freed slot produces; every other outcome leaves the panel working.
     */
    revalidate: function (onSignedOut) {
      if (!state) return;
      if (Date.now() - (state.lastValidatedAt || 0) < REVALIDATE_MS) return;
      api('POST', '/api/license/validate', {
        licenseKey: state.licenseKey,
        machineHash: state.machineHash,
        product: PRODUCT
      }, function (error, status, json) {
        if (error) return; // offline - keep working, retry next launch
        if (status === 403) {
          clearState();
          notify();
          if (onSignedOut) {
            onSignedOut('This machine was signed out of Motion Plug. The license was revoked (a refunded purchase) or the slot was freed from your account page.');
          }
          return;
        }
        if (status === 200 && json && json.valid) {
          state.lastValidatedAt = Date.now();
          if (json.signature) state.signature = json.signature;
          saveState();
        }
        // 5xx and rate limiting are treated exactly like being offline.
      });
    },

    /** Sign out on this machine. The slot stays used until it is freed from
     *  the account page, which needs the logged-in website. */
    reset: function () {
      clearState();
      notify();
    },

    accountUrl: function (pathname) { return global.MP_API_BASE + (pathname || '/account'); },

    init: function () {
      if (!nodeAvailable()) return false;
      loadState();
      return License.ok();
    }
  };

  global.MotionPlugLicense = License;
})(window);
