# Hypervision CRM

Lead management dashboard for Hypervision Technologies.

- Live site: https://hypervision-crm.netlify.app (Netlify deploys every push to `main`)
- Data: Firebase project `hypervision-crm` (Firestore, Mumbai). No customer data is stored in this repository.
- `index.html` is the dashboard. `hv-cloud-boot.js` + `hv-cloud.js` add sign-in and cloud sync; the dashboard itself keeps using localStorage and these scripts mirror its data keys (`crmLeads`, `crmTasks`, `crmNotes`, `hvFinanceTxns`, `hvFinanceImports`) to Firestore.
- `firestore.rules` is a reference copy of the rules published in the Firebase console.
