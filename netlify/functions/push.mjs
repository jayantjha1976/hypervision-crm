/* /api/push-key  (GET)  -> the public key the app needs to register a device for notifications
   /api/push-test (POST, signed in) -> sends a test notification to the signed-in user's devices */
import { admin, vapidKeys, sendToUser } from '../lib/common.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req) => {
  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith('/push-key') && req.method === 'GET') {
      const { publicKey } = await vapidKeys();
      return json({ publicKey });
    }
    if (path.endsWith('/push-test') && req.method === 'POST') {
      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!token) return json({ error: 'not signed in' }, 401);
      const user = await admin().auth.verifyIdToken(token);
      const sent = await sendToUser(user.uid, {
        title: '🔔 Reminders are on', body: 'You will get meeting, demo and task reminders on this device.', tag: 'test', url: '/' });
      return json({ sent });
    }
    return json({ error: 'not found' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: /FIREBASE_SERVICE_ACCOUNT/.test(err.message) ? 'server-not-configured' : 'server-error' }, 500);
  }
};

export const config = { path: ['/api/push-key', '/api/push-test'] };
