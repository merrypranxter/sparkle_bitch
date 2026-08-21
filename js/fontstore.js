/* Sparkle Bitch — fontstore.js
 * Tiny IndexedDB wrapper that remembers user-loaded font files across visits.
 * Font binaries are stored per-origin in the browser (never uploaded anywhere);
 * on a hosted site they persist, on file:// IndexedDB may be unavailable — every
 * call is guarded, so the app degrades to session-only fonts.
 */
(function (global) {
  'use strict';
  var SB = global.SB = global.SB || {};
  var DB = 'sparklebitch', STORE = 'fonts', VER = 1;

  function open() {
    return new Promise(function (res, rej) {
      if (!global.indexedDB) return rej(new Error('no indexedDB'));
      var r;
      try { r = global.indexedDB.open(DB, VER); } catch (e) { return rej(e); }
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'family' });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }

  function put(family, buffer) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put({ family: family, buffer: buffer });
        t.oncomplete = function () { res(); db.close(); };
        t.onerror = function () { rej(t.error); db.close(); };
      });
    });
  }

  function all() {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, 'readonly');
        var req = t.objectStore(STORE).getAll();
        req.onsuccess = function () { res(req.result || []); db.close(); };
        req.onerror = function () { rej(req.error); db.close(); };
      });
    });
  }

  function remove(family) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).delete(family);
        t.oncomplete = function () { res(); db.close(); };
        t.onerror = function () { rej(t.error); db.close(); };
      });
    });
  }

  SB.fontStore = { put: put, all: all, remove: remove };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
