/* Works out which notifications are due. Pure functions, so they can be tested without Firebase. */
import { parseIST, istParts, istTime } from './common.mjs';

const CLOSED = new Set(['Not Interested', 'Deal Done']);
export const MORNING_HOUR = 9;          // morning summary at 9 AM India time
const CATCH_UP_MS = 20 * 60000;         // a reminder missed by a late run is still sent within 20 min

function latestFollowUp(lead) {
  const f = lead.followUps || [];
  for (let i = f.length - 1; i >= 0; i--) if (f[i] && f[i].disposition) return f[i];
  return null;
}
const isEvent = (fu) => !!fu && (fu.disposition === 'Schedule Meeting' || fu.disposition === 'Demo Scheduled') && !!fu.meetingDateTime;
const who = (lead) => [lead.name, lead.company].filter(Boolean).join(' · ') || 'a lead';

/* Returns [{ key, payload }] for everything due at time `now` (ms). `key` is unique per notification. */
export function dueNotifications(leads, tasks, now) {
  const out = [];
  leads = Array.isArray(leads) ? leads : [];
  tasks = Array.isArray(tasks) ? tasks : [];

  // Meetings and demos: 30 minutes before, and at the start
  for (const lead of leads) {
    if (!lead || lead.isParked) continue;
    const fu = latestFollowUp(lead);
    if (!isEvent(fu)) continue;
    const at = parseIST(fu.meetingDateTime);
    if (at == null) continue;
    const label = fu.disposition === 'Demo Scheduled' ? 'Demo' : 'Meeting';
    const id = `${lead.id || lead.name || ''}|${fu.meetingDateTime}`;
    for (const [mins, text] of [[30, `${label} in 30 minutes`], [0, `${label} starting now`]]) {
      const fire = at - mins * 60000;
      if (fire <= now && fire > now - CATCH_UP_MS) {
        out.push({ key: `ev-${mins}-${id}`, payload: {
          title: `📅 ${text}`, body: `${who(lead)} — ${istTime(at)}`, tag: `ev-${id}`, url: '/' } });
      }
    }
  }

  // Tasks with a reminder time
  for (const t of tasks) {
    if (!t || t.done || !t.dueDate || !t.reminderTime) continue;
    const rk = `${t.dueDate}T${t.reminderTime}`;
    if (t.reminderHandledFor === rk) continue;            // already dismissed or done in the app
    const fire = parseIST(rk);
    if (fire != null && fire <= now && fire > now - CATCH_UP_MS) {
      out.push({ key: `task-${t.id || t.title}-${rk}`, payload: {
        title: '✅ Task reminder', body: t.title + (t.priority === 'High' ? ' (High priority)' : ''), tag: `task-${t.id}`, url: '/' } });
    }
  }

  // Morning summary
  const today = istParts(now);
  if (today.hour >= MORNING_HOUR && today.hour < 12) {
    const s = morningSummary(leads, tasks, today.ymd);
    if (s) out.push({ key: `morning-${today.ymd}`, payload: { title: '☀️ Today in your CRM', body: s, tag: 'morning', url: '/' } });
  }
  return out;
}

export function morningSummary(leads, tasks, ymd) {
  let followUps = 0, missed = 0;
  const events = [];
  for (const lead of leads) {
    if (!lead || lead.isParked) continue;
    const fu = latestFollowUp(lead);
    if (!fu || CLOSED.has(fu.disposition)) continue;
    const date = isEvent(fu) ? fu.meetingDateTime.slice(0, 10) : (fu.nextDate || null);
    if (!date) continue;
    if (date < ymd) missed++;
    else if (date === ymd) {
      if (isEvent(fu)) events.push(`${fu.disposition === 'Demo Scheduled' ? 'demo' : 'meeting'} with ${lead.name || lead.company || 'a lead'} at ${istTime(parseIST(fu.meetingDateTime))}`);
      else followUps++;
    }
  }
  const dueTasks = tasks.filter(t => t && !t.done && t.dueDate === ymd).length;
  const overdueTasks = tasks.filter(t => t && !t.done && t.dueDate && t.dueDate < ymd).length;

  const parts = [];
  if (events.length) parts.push(events.length === 1 ? cap(events[0]) : `${events.length} meetings/demos (first: ${events[0]})`);
  if (followUps) parts.push(`${followUps} follow-up${followUps > 1 ? 's' : ''} due`);
  if (dueTasks) parts.push(`${dueTasks} task${dueTasks > 1 ? 's' : ''} due`);
  if (missed) parts.push(`${missed} missed follow-up${missed > 1 ? 's' : ''}`);
  if (overdueTasks) parts.push(`${overdueTasks} overdue task${overdueTasks > 1 ? 's' : ''}`);
  return parts.length ? parts.join(' · ') : null;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
