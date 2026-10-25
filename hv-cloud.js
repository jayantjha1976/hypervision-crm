/* Hypervision CRM — cloud sync, part 2.
   Sign-in screen, upload of changed data to Firebase (Firestore),
   download of changes made on another device, and a small status chip.

   Cloud layout:  users/{uid}/store/{key}            -> { rev, parts, isNull, size, device, updatedAt }
                  users/{uid}/store/{key}/parts/{i}  -> { s: <slice of the JSON text> }
   Each key holds the same JSON text the dashboard keeps in localStorage. */

import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const C = window.hvCloud;
const CHUNK = 200000;            // characters per part (keeps each Firestore doc well under 1 MB)
const DEVICE_KEY = 'hvCloudDevice';

let auth, db, fb = {}, uid = null;
const pushing = {}, again = {}, timers = {};
const myRevs = new Set();
let unsubscribe = null, reloadWanted = false, online = navigator.onLine;

/* ---------- UI ---------- */
const css = `
#hvAuth{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;
  background:#0f172a;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
#hvAuth .box{background:#fff;color:#0f172a;border-radius:14px;padding:28px 24px;width:100%;max-width:360px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
#hvAuth img{height:44px;display:block;margin:0 auto 10px}
#hvAuth h2{margin:0 0 4px;font-size:20px;text-align:center}
#hvAuth p{margin:0 0 18px;font-size:13px;color:#64748b;text-align:center}
#hvAuth input{width:100%;box-sizing:border-box;padding:11px 12px;margin:0 0 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px}
#hvAuth button{width:100%;padding:11px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
#hvAuth button:disabled{opacity:.6;cursor:default}
#hvAuth .link{background:none;color:#2563eb;font-weight:500;font-size:13px;margin-top:8px;padding:4px}
#hvAuth .msg{min-height:18px;font-size:13px;margin:8px 0 0;text-align:center}
#hvAuth .msg.err{color:#dc2626}
#hvAuth .wait{text-align:center;color:#64748b;font-size:14px}
#hvChip{position:fixed;right:10px;bottom:10px;z-index:99990;display:flex;gap:6px;align-items:center;
  font:12px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:rgba(15,23,42,.88);color:#fff;
  padding:5px 8px 5px 10px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.25)}
#hvChip button{background:rgba(255,255,255,.15);color:#fff;border:0;border-radius:999px;padding:3px 8px;font-size:11px;cursor:pointer}
#hvBanner{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:99995;background:#f59e0b;color:#1f2937;
  font:600 13px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:8px 12px;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.25);display:flex;gap:10px;align-items:center;max-width:calc(100% - 32px)}
#hvBanner button{background:#1f2937;color:#fff;border:0;border-radius:6px;padding:5px 10px;font-weight:600;cursor:pointer}
`;
const styleEl = document.createElement('style');
styleEl.textContent = css;
document.head.appendChild(styleEl);

function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

function showAuth(mode, message) {
  let box = document.getElementById('hvAuth');
  if (!box) { box = el('<div id="hvAuth"></div>'); document.body.appendChild(box); }
  if (mode === 'wait') {
    box.innerHTML = `<div class="box"><img src="HVLogo.png" alt="" onerror="this.remove()"><div class="wait">${message || 'Loading your data…'}</div></div>`;
    return;
  }
  box.innerHTML = `
    <form class="box" autocomplete="on">
      <img src="HVLogo.png" alt="" onerror="this.remove()">
      <h2>Hypervision CRM</h2>
      <p>Sign in to open your leads</p>
      <input id="hvEmail" type="email" placeholder="Email" autocomplete="username" required>
      <input id="hvPass" type="password" placeholder="Password" autocomplete="current-password" required>
      <button type="submit" id="hvGo">Sign in</button>
      <button type="button" class="link" id="hvForgot">Forgot password?</button>
      <div class="msg ${message && message.err ? 'err' : ''}" id="hvMsg">${message ? message.text : ''}</div>
    </form>`;
  const form = box.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const go = box.querySelector('#hvGo'); go.disabled = true; go.textContent = 'Signing in…';
    try {
      await fb.signInWithEmailAndPassword(auth, box.querySelector('#hvEmail').value.trim(), box.querySelector('#hvPass').value);
    } catch (err) {
      go.disabled = false; go.textContent = 'Sign in';
      const m = box.querySelector('#hvMsg'); m.className = 'msg err';
      m.textContent = /network/i.test(err.code || '') ? 'No internet connection. Try again when online.'
        : /too-many/i.test(err.code || '') ? 'Too many attempts. Wait a few minutes and try again.'
        : 'Wrong email or password.';
    }
  };
  box.querySelector('#hvForgot').onclick = async () => {
    const email = box.querySelector('#hvEmail').value.trim();
    const m = box.querySelector('#hvMsg');
    if (!email) { m.className = 'msg err'; m.textContent = 'Type your email above first.'; return; }
    try { await fb.sendPasswordResetEmail(auth, email); m.className = 'msg'; m.textContent = 'Password reset email sent.'; }
    catch (err) { m.className = 'msg err'; m.textContent = 'Could not send the reset email.'; }
  };
}
function hideAuth() {
  const box = document.getElementById('hvAuth'); if (box) box.remove();
  document.documentElement.classList.remove('hv-locked');
}

let chip;
function setChip() {
  if (!uid) { if (chip) chip.remove(); chip = null; return; }
  if (!chip) {
    chip = el('<div id="hvChip"><span id="hvChipText"></span><button type="button" id="hvOut" title="Sign out of this device">Sign out</button></div>');
    document.body.appendChild(chip);
    chip.querySelector('#hvOut').onclick = signOutHere;
  }
  const s = C.state();
  const busy = C.KEYS.some(k => pushing[k] || timers[k] || (s[k] && s[k].dirty));
  chip.querySelector('#hvChipText').textContent =
    !online ? (busy ? '⚠ Offline · changes will sync' : '⚠ Offline') : busy ? '⟳ Saving…' : '☁ Synced';
}

/* ---------- helpers ---------- */
function deviceName() {
  let d = localStorage.getItem(DEVICE_KEY);
  if (!d) {
    d = (/Android|iPhone|iPad/i.test(navigator.userAgent) ? 'phone-' : 'computer-') + Math.random().toString(36).slice(2, 7);
    C.rawSet(DEVICE_KEY, d);
  }
  return d;
}
const newRev = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const metaRef = (key) => fb.doc(db, 'users', uid, 'store', key);
const partRef = (key, i) => fb.doc(db, 'users', uid, 'store', key, 'parts', String(i));
function updateLocalState(key, patch) {
  const s = C.state(); s[key] = Object.assign({}, s[key], patch); C.saveState(s);
}

/* ---------- upload ---------- */
function schedulePush(key) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => { timers[key] = null; push(key); }, 700);
  setChip();
}
async function push(key) {
  if (!uid) return;
  if (pushing[key]) { again[key] = true; return; }
  pushing[key] = true; setChip();
  try {
    do {
      again[key] = false;
      const before = C.state()[key] || {};
      const seq = before.dirty || 0;
      const val = localStorage.getItem(key);
      const chunks = [];
      if (val != null) for (let i = 0; i < val.length; i += CHUNK) chunks.push(val.slice(i, i + CHUNK));
      const rev = newRev();
      myRevs.add(rev);
      const batch = fb.writeBatch(db);
      batch.set(metaRef(key), { rev, parts: chunks.length, isNull: val == null, size: val ? val.length : 0,
        device: deviceName(), updatedAt: fb.serverTimestamp() });
      chunks.forEach((c, i) => batch.set(partRef(key, i), { s: c }));
      for (let i = chunks.length; i < (before.parts || 0); i++) batch.delete(partRef(key, i));
      await batch.commit();
      const now = C.state()[key] || {};
      updateLocalState(key, { rev, parts: chunks.length, dirty: (now.dirty || 0) === seq ? 0 : now.dirty });
      if ((now.dirty || 0) !== seq) again[key] = true;
    } while (again[key]);
  } catch (err) {
    console.error('[hvCloud] upload failed for', key, err);
    setTimeout(() => push(key), 15000);   // keep trying; data is safe in this browser meanwhile
  } finally {
    pushing[key] = false; setChip();
  }
}

/* ---------- download ---------- */
async function pull(key, meta) {
  let text = null;
  if (!meta.isNull) {
    const parts = await Promise.all(Array.from({ length: meta.parts || 0 }, (_, i) => fb.getDoc(partRef(key, i))));
    text = parts.map(p => (p.exists() ? p.data().s : '')).join('');
    if (text.length !== (meta.size || 0)) throw new Error('incomplete download for ' + key);
  }
  C.applying = true;
  try { if (text == null) C.rawRemove(key); else C.rawSet(key, text); }
  finally { C.applying = false; }
  updateLocalState(key, { rev: meta.rev, parts: meta.parts || 0, dirty: 0 });
}

/* First sync after sign-in. Returns true if data came down from the cloud (page must reload). */
async function reconcile() {
  let changed = false;
  for (const key of C.KEYS) {
    const s = C.state()[key] || {};
    try {
      if (s.dirty) { push(key); continue; }                 // unsent changes from this device win
      const snap = await fb.getDoc(metaRef(key));
      if (!snap.exists()) {
        if (localStorage.getItem(key) != null) { updateLocalState(key, { dirty: 1 }); push(key); }
        continue;
      }
      const meta = snap.data();
      if (meta.rev !== s.rev) { await pull(key, meta); changed = true; }
    } catch (err) {
      console.warn('[hvCloud] could not check', key, err);   // offline: keep using this device's copy
    }
  }
  return changed;
}

/* Live updates from the other device. */
function listen() {
  if (unsubscribe) unsubscribe();
  unsubscribe = fb.onSnapshot(fb.collection(db, 'users', uid, 'store'), (snap) => {
    snap.docChanges().forEach(async (ch) => {
      if (ch.doc.metadata.hasPendingWrites) return;
      const key = ch.doc.id, meta = ch.doc.data();
      if (C.KEYS.indexOf(key) < 0) return;
      const s = C.state()[key] || {};
      if (meta.rev === s.rev || myRevs.has(meta.rev) || s.dirty || pushing[key]) return;
      try { await pull(key, meta); requestReload(); }
      catch (err) { console.warn('[hvCloud] live update failed', key, err); }
    });
  }, (err) => console.warn('[hvCloud] live updates stopped', err));
}

/* The dashboard holds its data in memory, so after a download the page reloads —
   but only when you're not in the middle of typing or an open window. */
function busyOnScreen() {
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return true;
  return [...document.querySelectorAll('.modal')].some(m => getComputedStyle(m).display !== 'none');
}
function requestReload() {
  if (reloadWanted) return;
  reloadWanted = true;
  const tick = () => {
    if (document.hidden || !busyOnScreen()) { location.reload(); return; }
    if (!document.getElementById('hvBanner')) {
      const b = el('<div id="hvBanner"><span>Updated on your other device. It will refresh when you close this window.</span><button type="button">Refresh now</button></div>');
      b.querySelector('button').onclick = () => location.reload();
      document.body.appendChild(b);
    }
    setTimeout(tick, 1500);
  };
  tick();
}

/* ---------- sign out ---------- */
async function signOutHere() {
  const s = C.state();
  if (C.KEYS.some(k => s[k] && s[k].dirty) &&
      !confirm('Some changes have not reached the cloud yet (you may be offline). Sign out anyway and lose them on this device?')) return;
  reloadWanted = true;
  C.armed = false;
  if (unsubscribe) unsubscribe();
  C.KEYS.forEach(k => C.rawRemove(k));
  C.rawRemove('hvCloudState');
  try { await fb.terminate(db); await fb.clearIndexedDbPersistence(db); } catch (e) {}
  await fb.signOut(auth);
  location.reload();
}

/* ---------- start ---------- */
async function start() {
  if (!firebaseConfig || !firebaseConfig.apiKey || /PASTE/.test(firebaseConfig.apiKey)) {
    showAuth('wait', 'Setup not finished: the Firebase settings are missing from firebase-config.js.');
    return;
  }
  showAuth('wait', 'Starting…');
  const [app, a, f] = await Promise.all([
    import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
  fb = Object.assign({}, a, f);
  const fbApp = app.initializeApp(firebaseConfig);
  auth = a.getAuth(fbApp);
  try {
    db = f.initializeFirestore(fbApp, { localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }) });
  } catch (e) {
    db = f.getFirestore(fbApp);
  }

  C.onLocalChange = (key) => schedulePush(key);
  window.addEventListener('online', () => { online = true; setChip(); C.KEYS.forEach(k => { const s = C.state()[k]; if (s && s.dirty) push(k); }); });
  window.addEventListener('offline', () => { online = false; setChip(); });
  window.addEventListener('beforeunload', (e) => {
    if (!reloadWanted && online && C.KEYS.some(k => timers[k] || pushing[k])) { e.preventDefault(); e.returnValue = ''; }
  });

  let first = true;
  a.onAuthStateChanged(auth, async (user) => {
    if (!user) {
      uid = null; C.armed = false; setChip();
      showAuth('login');
      if (!first) location.reload();
      return;
    }
    const prevUid = localStorage.getItem('hvCloudUid');
    if (prevUid && prevUid !== user.uid) {           // a different account signed in on this device
      C.KEYS.forEach(k => C.rawRemove(k)); C.rawRemove('hvCloudState');
    }
    C.rawSet('hvCloudUid', user.uid);
    uid = user.uid;
    showAuth('wait', 'Syncing your data…');
    const changed = await reconcile();
    if (changed && first) { location.reload(); return; }
    first = false;
    C.armed = true;
    listen();
    hideAuth();
    setChip();
    if (changed) requestReload();
  });
}

start().catch((err) => {
  console.error('[hvCloud]', err);
  if (localStorage.getItem('hvCloudUid')) {
    // Signed in on this device before but Firebase could not load (usually no internet):
    // open this device's copy; changes are marked and upload on the next online start.
    C.armed = true;
    hideAuth();
    const c = el('<div id="hvChip"><span>⚠ Offline copy · changes sync when back online</span></div>');
    document.body.appendChild(c);
    return;
  }
  showAuth('wait', navigator.onLine
    ? 'Could not start cloud sync. Refresh the page to try again.'
    : 'You are offline and this device has not been signed in yet. Connect to the internet and refresh.');
});
