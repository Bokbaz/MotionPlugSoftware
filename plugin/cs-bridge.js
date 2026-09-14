/* Minimal CEP bridge used by Motion Plug. The host implementation lives in
 * jsx/host.jsx and Node.js is enabled by CSXS/manifest.xml. */
(function (global) {
  'use strict';

  var cepAvailable = typeof global.__adobe_cep__ !== 'undefined';

  function nodeRequire(name) {
    if (typeof require !== 'undefined') return require(name);
    if (global.cep_node && global.cep_node.require) return global.cep_node.require(name);
    throw new Error('Node.js is not enabled in this CEP panel.');
  }

  function normalizeSystemPath(value) {
    if (typeof value !== 'string') return '';
    try {
      var parsed = JSON.parse(value);
      if (typeof parsed === 'string') value = parsed;
    } catch (ignore) {}
    if (!/^file:/i.test(value)) return value;
    try {
      var url = nodeRequire('url');
      if (url.fileURLToPath) return url.fileURLToPath(value);
    } catch (ignoreUrl) {}
    var match = /^file:\/\/([^/]*)(\/.*)$/i.exec(value);
    var host = match ? match[1] : '';
    var pathname = match ? match[2] : value.replace(/^file:(?:\/\/)?/i, '');
    try { host = decodeURIComponent(host); } catch (ignoreHost) {}
    try { pathname = decodeURIComponent(pathname); } catch (ignorePath) {}
    if (/^\/[a-zA-Z][|:]\//.test(pathname)) {
      pathname = pathname.slice(1).replace(/^([a-zA-Z])\|/, '$1:');
    }
    if (host && host.toLowerCase() !== 'localhost') return '//' + host + pathname;
    return pathname;
  }

  var Bridge = {
    available: cepAvailable,
    require: nodeRequire,

    evalScript: function (script) {
      return new Promise(function (resolve, reject) {
        if (!cepAvailable) {
          reject(new Error('Motion Plug is not running inside Adobe Premiere Pro.'));
          return;
        }
        try {
          global.__adobe_cep__.evalScript(script, function (result) {
            if (result === 'EvalScript error.') {
              reject(new Error('Premiere could not run the Motion Plug host command.'));
            } else {
              resolve(result);
            }
          });
        } catch (error) {
          reject(error);
        }
      });
    },

    extensionPath: function () {
      if (!cepAvailable) return '';
      try {
        return normalizeSystemPath(global.__adobe_cep__.getSystemPath('extension'));
      } catch (ignore) {
        return '';
      }
    }
  };

  global.CSBridge = Bridge;
})(window);
