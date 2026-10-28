/* Hypervision CRM — cloud sync, part 1 (runs before the dashboard code).
   Watches the dashboard's saves to browser storage and marks them for upload.
   The dashboard itself is unchanged: it keeps reading/writing localStorage,
   and hv-cloud.js copies those keys to and from Firebase. */
(function () {
  var KEYS = ['crmLeads', 'crmTasks', 'crmNotes', 'hvFinanceTxns', 'hvFinanceImports', 'hvFinanceVendors'];
  var STATE_KEY = 'hvCloudState';
  var proto = Storage.prototype;
  var oSet = proto.setItem, oRemove = proto.removeItem, oClear = proto.clear;
  var LS = window.localStorage;

  var C = window.hvCloud = {
    KEYS: KEYS,
    armed: false,      // becomes true once signed in and synced; saves before that are not uploaded
    applying: false,   // true while we write data that came from the cloud
    onLocalChange: null,
    rawSet: function (k, v) { oSet.call(LS, k, v); },
    rawRemove: function (k) { oRemove.call(LS, k); },
    state: function () {
      try { return JSON.parse(LS.getItem(STATE_KEY)) || {}; } catch (e) { return {}; }
    },
    saveState: function (s) { oSet.call(LS, STATE_KEY, JSON.stringify(s)); },
    markDirty: function (key) {
      var s = C.state();
      s[key] = s[key] || {};
      s[key].dirty = (s[key].dirty || 0) + 1;
      C.saveState(s);
      if (C.onLocalChange) C.onLocalChange(key);
    }
  };

  function watched(store, key) {
    return store === LS && !C.applying && C.armed && KEYS.indexOf(key) >= 0;
  }
  proto.setItem = function (k, v) {
    var r = oSet.call(this, k, v);
    if (watched(this, k)) C.markDirty(k);
    return r;
  };
  proto.removeItem = function (k) {
    var r = oRemove.call(this, k);
    if (watched(this, k)) C.markDirty(k);
    return r;
  };
  proto.clear = function () {
    if (this !== LS) return oClear.call(this);
    var keep = LS.getItem(STATE_KEY);
    var r = oClear.call(this);
    if (keep) oSet.call(LS, STATE_KEY, keep);
    if (C.armed && !C.applying) KEYS.forEach(C.markDirty);
    return r;
  };

  // Hide the dashboard until sign-in has finished.
  document.documentElement.classList.add('hv-locked');
  var st = document.createElement('style');
  st.textContent = 'html.hv-locked body{visibility:hidden}html.hv-locked #hvAuth{visibility:visible}';
  document.head.appendChild(st);
})();

/* Offline support + "Install app" button. */
(function () {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
  window.hvInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.hvInstallPrompt = e;
    document.dispatchEvent(new Event('hv-installable'));
  });
  window.addEventListener('appinstalled', function () {
    window.hvInstallPrompt = null;
    document.dispatchEvent(new Event('hv-installable'));
  });
})();
