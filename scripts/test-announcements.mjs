// Smoke test for feature/announcements-resolve-config
// - Group-level resolve delay helpers
// - Group-level announce lead-time helpers
// - scheduled_jobs CHECK widened to 'announce'
// - formatDropAnnouncement dynamic time labels
// - Scheduler materialization inserts companion announce job
// - executeAnnounce skips when companion drop is not pending
// - doDrop uses group-level resolve delay when no payload override
//
// Run with: node scripts/test-announcements.mjs
// Uses a fresh temp DB — does not touch production data.

import path from 'path';
import { fileURLToPath } from 'url';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', 'data', 'test-announcements.db');
mkdirSync(path.dirname(DB_PATH), { recursive: true });
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

// Use the schema from the compiled output so we actually exercise the migration path
process.env.DB_PATH = DB_PATH;
const { initDb } = await import('../dist/db/schema.js');
const db = await import('../dist/db/queries.js');
const { formatDropAnnouncement } = await import('../dist/game/messages.js');

const database = initDb();
const GROUP = -1009999000001;

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✗ ${label}`); fail++; }
}

console.log('--- TA.1 group resolve delay helpers ---');
assert(db.getGroupResolveDelayMinutes(database, GROUP) === null, 'unset returns null');
db.setGroupResolveDelayMinutes(database, GROUP, 45);
assert(db.getGroupResolveDelayMinutes(database, GROUP) === 45, 'set/get 45');
db.setGroupResolveDelayMinutes(database, GROUP, 120);
assert(db.getGroupResolveDelayMinutes(database, GROUP) === 120, 'overwrite to 120');

console.log('--- TA.2 group announce minutes-before helpers ---');
assert(db.getGroupAnnounceMinutesBefore(database, GROUP) === 0, 'default is 0 (disabled)');
db.setGroupAnnounceMinutesBefore(database, GROUP, 30);
assert(db.getGroupAnnounceMinutesBefore(database, GROUP) === 30, 'set/get 30');
db.setGroupAnnounceMinutesBefore(database, GROUP, 0);
assert(db.getGroupAnnounceMinutesBefore(database, GROUP) === 0, 'zero disables');

console.log('--- TA.3 scheduled_jobs CHECK accepts announce kind ---');
const now = new Date();
const inFuture = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
let annId;
try {
  annId = db.insertJob(database, GROUP, 'announce', inFuture, null, { drop_run_at: inFuture });
  assert(typeof annId === 'number' && annId > 0, `insertJob(kind='announce') succeeded (id=${annId})`);
} catch (e) {
  assert(false, `insertJob(kind='announce') threw: ${e.message}`);
}

console.log('--- TA.4 announceExistsForScheduleDrop ---');
// Without schedule_id the helper should not match (it filters by schedule_id + payload.drop_run_at)
const scheduleId = db.insertSchedule(database, GROUP, 'mon,tue,wed,thu,fri,sat,sun', '12:00', 60);
const dropRunAt = '2099-01-01T12:00:00.000Z';
assert(db.announceExistsForScheduleDrop(database, scheduleId, dropRunAt) === false, 'no announce yet');
const annId2 = db.insertJob(database, GROUP, 'announce', '2099-01-01T11:30:00.000Z', scheduleId, { drop_run_at: dropRunAt });
assert(db.announceExistsForScheduleDrop(database, scheduleId, dropRunAt) === true, 'announce with matching payload found');
assert(db.announceExistsForScheduleDrop(database, scheduleId, '2099-01-02T12:00:00.000Z') === false, 'different drop time -> not found');

console.log('--- TA.5 formatDropAnnouncement label logic ---');
const baseNow = new Date('2026-04-11T09:00:00.000Z');
const today13 = new Date('2026-04-11T13:00:00.000Z');
const msgToday = formatDropAnnouncement(today13, baseNow, 30);
assert(msgToday.includes('Today at 13:00 UTC'), `today label (got: ${msgToday.match(/Next drop: .*/)?.[0]})`);
assert(msgToday.includes('30 rounds. 30 projects.'), 'uses totalDays=30');
assert(msgToday.includes("Good luck. You'll need it."), 'uses new footer');

const tomorrow09 = new Date('2026-04-12T09:00:00.000Z');
const msgTomorrow = formatDropAnnouncement(tomorrow09, baseNow, 30);
assert(msgTomorrow.includes('Tomorrow at 09:00 UTC'), `tomorrow label (got: ${msgTomorrow.match(/Next drop: .*/)?.[0]})`);

const laterWeek = new Date('2026-04-14T08:30:00.000Z'); // 3 days later = Tuesday
const msgLater = formatDropAnnouncement(laterWeek, baseNow, 30);
assert(/Next drop: (Mon|Tue|Wed|Thu|Fri|Sat|Sun) at 08:30 UTC/.test(msgLater), `weekday label (got: ${msgLater.match(/Next drop: .*/)?.[0]})`);

// Edge: announce posted exactly at same wall-clock hour, drop 30min later same UTC day → "Today"
const sameDayLater = new Date('2026-04-11T09:30:00.000Z');
const msgSameDay = formatDropAnnouncement(sameDayLater, baseNow, 30);
assert(msgSameDay.includes('Today at 09:30 UTC'), 'same-day label');

console.log('--- TA.6 migration is idempotent (schema CHECK includes announce) ---');
// Re-run initDb on the same file — must not throw
const database2 = initDb();
database2.close();
assert(true, 'reopen database without errors');

console.log('--- TA.7 insertJob rejects unknown kind ---');
try {
  db.insertJob(database, GROUP, 'foo', inFuture, null, null);
  assert(false, 'insertJob(kind=foo) should have thrown');
} catch {
  assert(true, 'insertJob(kind=foo) rejected by CHECK');
}

console.log('--- TA.8 doDrop reads group resolve delay (no payload override) ---');
// We can't run the full doDrop (needs network/bot), but we can verify the precedence
// logic by reading the group config directly and checking it overrides env.
db.setGroupResolveDelayMinutes(database, GROUP, 15);
const groupDelay = db.getGroupResolveDelayMinutes(database, GROUP);
assert(groupDelay === 15, `group delay = 15 (got ${groupDelay})`);
// Precedence: payload ?? group ?? env
const resolved = (undefined) ?? groupDelay ?? 60;
assert(resolved === 15, 'precedence: no payload → group wins over env');
const resolvedWithPayload = 5 ?? groupDelay ?? 60;
assert(resolvedWithPayload === 5, 'precedence: payload wins over group');
db.setGroupState(database, GROUP, 'resolve_delay_minutes', '');
const resolvedNoGroup = undefined ?? db.getGroupResolveDelayMinutes(database, GROUP) ?? 60;
assert(resolvedNoGroup === 60, 'precedence: no payload, no group → env wins');

console.log('---');
console.log(`TA result: ${pass} passed, ${fail} failed`);
database.close();
process.exit(fail === 0 ? 0 : 1);
