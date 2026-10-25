# Hypervision CRM

Lead management dashboard for Hypervision Technologies.

- Live site: https://hypervision-crm.netlify.app (Netlify deploys every push to `main`)
- Data: Firebase project `hypervision-crm` (Firestore, Mumbai). No customer data is stored in this repository.
- `index.html` is the dashboard. `hv-cloud-boot.js` + `hv-cloud.js` add sign-in and cloud sync; the dashboard itself keeps using localStorage and these scripts mirror its data keys (`crmLeads`, `crmTasks`, `crmNotes`, `hvFinanceTxns`, `hvFinanceImports`) to Firestore.
- `firestore.rules` is a reference copy of the rules published in the Firebase console.

## Layout (since phone reminders)
- `public/` — the website (dashboard, sync scripts, service worker `sw.js`, manifest, icons).
- `netlify/functions/reminders.mjs` — runs every 5 minutes; sends push notifications for meetings/demos (30 min before and at start), task reminders, and a 9 AM summary (India time).
- `netlify/functions/push.mjs` — `/api/push-key` (public key for registering a device) and `/api/push-test`.
- `netlify/lib/` — shared code; `plan.mjs` decides what is due.
- Needs one Netlify environment variable: `FIREBASE_SERVICE_ACCOUNT` = the full JSON of a Firebase service-account key. Push (VAPID) keys are created automatically and stored in Firestore at `system/vapid` (closed to browsers by the security rules).
- Device registrations: `users/{uid}/push/{device}`; sent-notification log: `users/{uid}/pushLog` (kept 3 days).

## Nightly backup
- `netlify/functions/backup.mjs` runs at 11:59 PM India time and writes all CRM data to `backup.json` in the private repo `jayantjha1976/hypervision-crm-backups` (same format as the app's 💾 Backup; load it with 📂 Restore). Each night replaces the file; GitHub history keeps every earlier day.
- Needs Netlify environment variable `GITHUB_BACKUP_TOKEN`: a fine-grained GitHub token with access to that one repository only, permission Contents: Read and write. Optional `GITHUB_BACKUP_REPO` to use a different repository.

## archive/
Files from the old laptop folder that aren't part of the live site: `admin.html` (older admin page, local only) and logo images.
