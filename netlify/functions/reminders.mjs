/* Runs every 5 minutes on Netlify: sends meeting/demo, task and morning-summary notifications. */
import { admin, readKey, sendToUser, FieldValue } from '../lib/common.mjs';
import { dueNotifications } from '../lib/plan.mjs';

export default async () => {
  const { db } = admin();
  const now = Date.now();
  const userRefs = await db.collection('users').listDocuments();   // includes users with only sub-collections
  const uids = [];
  for (const u of userRefs) {
    const any = await db.collection(`users/${u.id}/push`).limit(1).get();
    if (!any.empty) uids.push(u.id);
  }
  let sent = 0;

  for (const uid of uids) {
    const [leads, tasks] = await Promise.all([readKey(uid, 'crmLeads'), readKey(uid, 'crmTasks')]);
    for (const n of dueNotifications(leads, tasks, now)) {
      // Record first, so a notification is never sent twice even if two runs overlap.
      const logRef = db.doc(`users/${uid}/pushLog/${encodeURIComponent(n.key).slice(0, 400)}`);
      try { await logRef.create({ at: FieldValue.serverTimestamp(), title: n.payload.title }); }
      catch (e) { continue; }                         // already sent
      sent += await sendToUser(uid, n.payload);
    }
    // Tidy the log: entries older than 3 days are no longer needed.
    const old = await db.collection(`users/${uid}/pushLog`).where('at', '<', new Date(now - 3 * 86400000)).limit(200).get();
    await Promise.all(old.docs.map(d => d.ref.delete()));
  }
  console.log(`reminders: ${uids.length} user(s), ${sent} notification(s) sent`);
  return new Response('ok');
};

export const config = { schedule: '*/5 * * * *' };
