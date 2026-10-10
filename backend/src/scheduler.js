// Periodic scans. A timer inside the backend checks every SCHEDULER_TICK_MS
// whether a schedule is due, and if so queues a run with trigger "scheduled".
// Schedules are stored in SQLite, so they survive a backend restart.
// The browser does not need to be open; the backend does need to be running.
import * as store from './db.js';
import { startRun } from './runner.js';
import { SCHEDULER_TICK_MS } from './config.js';

export function startScheduler() {
  tick();
  return setInterval(tick, SCHEDULER_TICK_MS);
}

function tick() {
  const now = new Date();
  for (const schedule of store.getSchedules()) {
    if (!schedule.enabled || !schedule.next_run_at) continue;
    if (new Date(schedule.next_run_at) > now) continue; // not due yet

    // Don't pile up runs: if the previous one of this type hasn't finished,
    // try again on the next tick.
    if (store.hasActiveRun(schedule.type)) continue;

    const next = new Date(now.getTime() + schedule.interval_minutes * 60_000);
    store.markScheduleStarted(schedule.type, now.toISOString(), next.toISOString());
    startRun(schedule.type, 'scheduled', schedule.params);
  }
}
