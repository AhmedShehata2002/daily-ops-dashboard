/* derived.js — browser global + Node.js module (UMD-lite)
 * All calculations happen client-side from data.json.
 * No external dependencies. */
(function (global) {
  'use strict';

  const STALE_ELLIE_MIN  = 30;  // minutes before Ellie data is considered stale
  const STALE_GCAL_MIN   = 20;

  /* ------------------------------------------------------------------ */
  /* Tasks                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Returns the active task list: Ellie if connected, else gcal today (all-day events).
   * Each task: { label, done, dueDate? }
   */
  function getTodaysTasks(data) {
    if (data.ellie && data.ellie.connected && Array.isArray(data.ellie.tasks) && data.ellie.tasks.length > 0) {
      return data.ellie.tasks;
    }
    return Array.isArray(data.gcal && data.gcal.tasks) ? data.gcal.tasks : [];
  }

  /** Returns tasks where done === false (and optionally past their dueDate). */
  function getOverdueTasks(data) {
    const now = Date.now();
    return getTodaysTasks(data).filter(t => {
      if (t.done) return false;
      if (t.dueDate) return new Date(t.dueDate).getTime() < now;
      return false;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Attention items                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Returns array of attention items:
   * { type: 'error'|'warn'|'info', text: string }
   */
  function calculateAttentionItems(data) {
    const items = [];
    const now   = Date.now();

    // Sync errors
    if (data.ellie && data.ellie.error) {
      items.push({ type: 'error', text: 'Ellie sync failed' });
    }
    if (data.gcal && data.gcal.error) {
      items.push({ type: 'error', text: 'Calendar sync failed' });
    }

    // Stale Ellie data
    if (data.ellie && data.ellie.connected && data.ellie.syncedAt) {
      const ageMin = (now - new Date(data.ellie.syncedAt).getTime()) / 60000;
      if (ageMin > STALE_ELLIE_MIN) {
        items.push({ type: 'warn', text: `Ellie data ${Math.round(ageMin)}m old` });
      }
    }

    // Stale calendar data
    if (data.gcal && data.gcal.syncedAt) {
      const ageMin = (now - new Date(data.gcal.syncedAt).getTime()) / 60000;
      if (ageMin > STALE_GCAL_MIN) {
        items.push({ type: 'warn', text: `Calendar ${Math.round(ageMin)}m old` });
      }
    }

    // Overdue tasks
    const overdue = getOverdueTasks(data);
    if (overdue.length > 0) {
      items.push({ type: 'urgent', text: `${overdue.length} overdue task${overdue.length !== 1 ? 's' : ''}` });
    }

    // Ellie not connected
    if (!data.ellie || !data.ellie.connected) {
      items.push({ type: 'info', text: 'Ellie not connected' });
    }

    // Calendar conflicts (timed events within 30 min of each other)
    const timedEvents = Array.isArray(data.gcal && data.gcal.today)
      ? data.gcal.today.filter(e => e.startMs)
      : [];
    for (let i = 1; i < timedEvents.length; i++) {
      const prev = timedEvents[i - 1];
      const curr = timedEvents[i];
      if (prev.endMs && curr.startMs && curr.startMs - prev.endMs < 0) {
        items.push({ type: 'warn', text: 'Calendar conflict detected' });
        break;
      }
    }

    return items;
  }

  /* ------------------------------------------------------------------ */
  /* Day status                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Returns { total, done, pct, status }
   * status: 'CLEAR' | 'ON TRACK' | 'TIGHT' | 'OVERLOADED'
   */
  function calculateDayStatus(data) {
    const tasks = getTodaysTasks(data);
    const total = tasks.length;
    const done  = tasks.filter(t => t.done).length;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

    let status;
    if (total === 0)   status = 'CLEAR';
    else if (pct >= 80) status = 'ON TRACK';
    else if (pct >= 50) status = 'TIGHT';
    else                status = 'OVERLOADED';

    return { total, done, pct, status };
  }

  /* ------------------------------------------------------------------ */
  /* Weekly stats                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Returns { tasksTotal, tasksDone, overdue, focusSessions }
   * focusSessions comes from localStorage key 'timer_sessions_YYYY-MM-DD' (browser only).
   */
  function calculateWeeklyStats(data) {
    const tasks       = getTodaysTasks(data);
    const tasksTotal  = tasks.length;
    const tasksDone   = tasks.filter(t => t.done).length;
    const overdue     = getOverdueTasks(data).length;

    let focusSessions = 0;
    if (typeof localStorage !== 'undefined') {
      // Sum sessions over last 7 days
      const today = new Date();
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = `timer_sessions_${d.toISOString().slice(0, 10)}`;
        focusSessions += parseInt(localStorage.getItem(key) || '0', 10);
      }
    }

    return { tasksTotal, tasksDone, overdue, focusSessions };
  }

  /* ------------------------------------------------------------------ */
  /* Up next                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Returns upcoming events from gcal.upcoming.
   * Each: { title, inDays }
   */
  function getUpcomingItems(data) {
    return Array.isArray(data.gcal && data.gcal.upcoming) ? data.gcal.upcoming : [];
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                               */
  /* ------------------------------------------------------------------ */

  const Derived = {
    getTodaysTasks,
    getOverdueTasks,
    calculateAttentionItems,
    calculateDayStatus,
    calculateWeeklyStats,
    getUpcomingItems
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Derived;
  } else {
    global.Derived = Derived;
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
