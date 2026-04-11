// T3 — DB query helper smoke test against test-scheduler.db
// Run with: node scripts/test-queries.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from '../dist/db/queries.js';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', 'data', 'test-scheduler.db');
const GROUP_ID = -1003653746011;

const database = new Database(DB_PATH);
database.pragma('journal_mode = WAL');

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✗ ${label}`); fail++; }
}

console.log('--- T3.1 getSchedulesForGroup ---');
let schedules = db.getSchedulesForGroup(database, GROUP_ID);
assert(schedules.length === 1, `expected 1 schedule, got ${schedules.length}`);
const s1 = schedules[0];
assert(s1.days_of_week === 'sat', `days='sat' (got '${s1.days_of_week}')`);
assert(s1.time_utc === '11:30', `time='11:30' (got '${s1.time_utc}')`);
assert(s1.enabled === 1, `enabled=1 (got ${s1.enabled})`);

console.log('--- T3.2 setScheduleEnabled(false) + getActiveSchedules ---');
db.setScheduleEnabled(database, s1.id, false);
const after = db.getScheduleById(database, s1.id);
assert(after.enabled === 0, `enabled=0 (got ${after.enabled})`);
const active = db.getActiveSchedules(database);
assert(!active.find(s => s.id === s1.id), `disabled schedule excluded from getActiveSchedules`);

console.log('--- T3.3 setScheduleEnabled(true) re-enables ---');
db.setScheduleEnabled(database, s1.id, true);
const reenabled = db.getScheduleById(database, s1.id);
assert(reenabled.enabled === 1, `enabled=1 again (got ${reenabled.enabled})`);

console.log('--- T3.4 insert second schedule, getSchedulesForGroup returns 2 ---');
const id2 = db.insertSchedule(database, GROUP_ID, 'mon,wed,fri', '08:00', 60);
schedules = db.getSchedulesForGroup(database, GROUP_ID);
assert(schedules.length === 2, `expected 2, got ${schedules.length}`);

console.log('--- T3.5 deleteSchedule removes it ---');
db.deleteSchedule(database, id2);
schedules = db.getSchedulesForGroup(database, GROUP_ID);
assert(schedules.length === 1, `expected 1 after delete, got ${schedules.length}`);

console.log('--- T3.6 jobExistsForScheduleSlot ---');
const existsTrue = db.jobExistsForScheduleSlot(database, s1.id, '2026-04-11T11:30:00.000Z');
assert(existsTrue === true, `existing slot returns true (got ${existsTrue})`);
const existsFalse = db.jobExistsForScheduleSlot(database, s1.id, '2099-01-01T00:00:00.000Z');
assert(existsFalse === false, `non-existing slot returns false (got ${existsFalse})`);

console.log('--- T3.7 getPendingJobsForGroup returns 0 (all done) ---');
const pending = db.getPendingJobsForGroup(database, GROUP_ID);
assert(pending.length === 0, `expected 0 pending, got ${pending.length}`);

console.log('--- T3.8 insert pending resolve, cancelPendingResolveForGroup marks it skipped ---');
const fake = db.insertJob(database, GROUP_ID, 'resolve', new Date(Date.now() + 60_000).toISOString(), null, null);
const before = db.getPendingResolveJobForGroup(database, GROUP_ID);
assert(before?.id === fake, `pending resolve found by id (got ${before?.id})`);
// cancelPendingResolveForGroup needs the scheduler module; we replicate its DB-only effect
const pendingResolve = db.getPendingResolveJobForGroup(database, GROUP_ID);
db.markJobSkipped(database, pendingResolve.id, 'test cleanup');
const after2 = db.getJobById(database, fake);
assert(after2.status === 'skipped', `status=skipped (got ${after2.status})`);
assert(after2.error === 'test cleanup', `error preserved (got ${after2.error})`);

console.log('---');
console.log(`T3 result: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
