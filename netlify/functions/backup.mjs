/* Nightly backup at 11:59 PM India time (18:29 UTC).
   Writes all CRM data to backup.json in the private GitHub repository set in GITHUB_BACKUP_REPO
   (default jayantjha1976/hypervision-crm-backups). Each night replaces the file; GitHub keeps
   every earlier version in its history. The file uses the same format as the app's 💾 Backup,
   so it can be loaded with 📂 Restore. */
import { admin, readKey, istParts } from '../lib/common.mjs';

const REPO = process.env.GITHUB_BACKUP_REPO || 'jayantjha1976/hypervision-crm-backups';

async function github(path, init = {}) {
  const token = process.env.GITHUB_BACKUP_TOKEN;
  if (!token) throw new Error('GITHUB_BACKUP_TOKEN is not set in Netlify environment variables');
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'user-agent': 'hypervision-crm-backup', ...(init.headers || {}) }
  });
  return res;
}

export async function backupUser(uid, email) {
  const [leads, tasks, notes, txns, imports] = await Promise.all(
    ['crmLeads', 'crmTasks', 'crmNotes', 'hvFinanceTxns', 'hvFinanceImports'].map(k => readKey(uid, k)));
  const L = leads || [], T = tasks || [], N = notes || [];
  const F = { transactions: txns || [], imports: imports || [] };
  const data = { app: 'Hypervision CRM', version: 1, exportedAt: new Date().toISOString(), source: 'nightly cloud backup',
    leadCount: L.length, leads: L, taskCount: T.length, tasks: T, noteCount: N.length, notes: N,
    financeTxnCount: F.transactions.length, finance: F };
  return { data, file: 'backup.json', label: email || uid };
}

export async function writeBackup({ data, file }) {
  const text = JSON.stringify(data, null, 2);
  const existing = await github(`contents/${encodeURIComponent(file)}`);
  const sha = existing.ok ? (await existing.json()).sha : undefined;
  if (!existing.ok && existing.status !== 404) throw new Error(`GitHub read failed: ${existing.status} ${await existing.text()}`);
  const day = istParts(Date.now()).ymd;
  const res = await github(`contents/${encodeURIComponent(file)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Backup ${day}: ${data.leadCount} leads, ${data.taskCount} tasks, ${data.noteCount} notes, ${data.financeTxnCount} finance entries`,
      content: Buffer.from(text, 'utf8').toString('base64'),
      ...(sha ? { sha } : {})
    })
  });
  if (!res.ok) throw new Error(`GitHub write failed: ${res.status} ${await res.text()}`);
  return { bytes: text.length };
}

export async function runBackup() {
  const { db, auth } = admin();
  const userRefs = await db.collection('users').listDocuments();
  const results = [];
  for (const u of userRefs) {
    const meta = await db.doc(`users/${u.id}/store/crmLeads`).get();
    if (!meta.exists) continue;                         // no CRM data for this account
    let email = null;
    try { email = (await auth.getUser(u.id)).email; } catch (e) {}
    const b = await backupUser(u.id, email);
    if (userRefs.length > 1 && results.length) b.file = `backup-${(email || u.id).replace(/[^a-z0-9@._-]/gi, '_')}.json`;
    const r = await writeBackup(b);
    results.push({ user: b.label, file: b.file, leads: b.data.leadCount, bytes: r.bytes });
  }
  return results;
}

export default async () => {
  try {
    const results = await runBackup();
    console.log('backup done', JSON.stringify(results));
    return new Response('ok');
  } catch (err) {
    console.error('backup failed', err.message);
    return new Response('failed', { status: 500 });
  }
};

export const config = { schedule: '29 18 * * *' };
