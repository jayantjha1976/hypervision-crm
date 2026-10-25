/* Shared helpers for the reminder jobs: Firebase admin access, push keys, reading CRM data. */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import webpush from 'web-push';

export { FieldValue };

let app;
export function admin() {
  if (!app) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set in Netlify environment variables');
    const sa = JSON.parse(raw);
    app = getApps()[0] || initializeApp({ credential: cert(sa), projectId: sa.project_id });
  }
  return { db: getFirestore(app), auth: getAuth(app) };
}

/* VAPID keys for Web Push. Created once and kept in Firestore at system/vapid,
   which the app's security rules keep closed to browsers (only this server can read it). */
let vapid;
export async function vapidKeys() {
  if (vapid) return vapid;
  const { db } = admin();
  const ref = db.doc('system/vapid');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) { vapid = snap.data(); return; }
    const k = webpush.generateVAPIDKeys();
    vapid = { publicKey: k.publicKey, privateKey: k.privateKey, createdAt: new Date().toISOString() };
    tx.set(ref, vapid);
  });
  webpush.setVapidDetails('mailto:hypervision22@gmail.com', vapid.publicKey, vapid.privateKey);
  return vapid;
}

/* Send one notification to every registered device of a user. Removes devices that are gone. */
export async function sendToUser(uid, payload) {
  await vapidKeys();
  const { db } = admin();
  const subs = await db.collection(`users/${uid}/push`).get();
  let sent = 0;
  await Promise.all(subs.docs.map(async (d) => {
    try {
      await webpush.sendNotification(d.data().subscription, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await d.ref.delete();
      else console.warn('push failed', uid, d.id, err.statusCode, err.body || err.message);
    }
  }));
  return sent;
}

/* Read one of the dashboard's data keys (stored as JSON text split into parts by hv-cloud.js). */
export async function readKey(uid, key) {
  const { db } = admin();
  const meta = await db.doc(`users/${uid}/store/${key}`).get();
  if (!meta.exists || meta.data().isNull) return null;
  const n = meta.data().parts || 0;
  const refs = Array.from({ length: n }, (_, i) => db.doc(`users/${uid}/store/${key}/parts/${i}`));
  const parts = n ? await db.getAll(...refs) : [];
  try { return JSON.parse(parts.map(p => (p.exists ? p.data().s : '')).join('')); }
  catch (e) { console.warn('could not read', key, e.message); return null; }
}

/* ---- India time (the dashboard stores times as Indian local time without a zone) ---- */
const IST_MS = 330 * 60000;
export function parseIST(s) {                       // '2026-10-26T15:30:00' or '2026-10-26' + '15:30'
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) - IST_MS;
}
export function istParts(ms) {
  const d = new Date(ms + IST_MS);
  const p = (n) => String(n).padStart(2, '0');
  return { ymd: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}
export function istTime(ms) {
  const { hour, minute } = istParts(ms);
  const h12 = ((hour + 11) % 12) + 1;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
