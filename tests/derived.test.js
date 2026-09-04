/**
 * derived.test.js — Tests for js/derived.js
 * Run with: node tests/derived.test.js
 * No external test framework required.
 */
const Derived = require('../js/derived.js');

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    failed++;
  }
}

function assertEqual(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                             */
/* ------------------------------------------------------------------ */

const EMPTY_DATA = {
  cfa:   { percent: 37, topic: 'Test', progressText: '1h', next: 'Next' },
  ellie: { tasks: [], syncedAt: null, connected: false, error: null },
  gcal:  { tasks: [], events: [], upcoming: [], syncedAt: null, error: null }
};

const ELLIE_CONNECTED = {
  ...EMPTY_DATA,
  ellie: {
    tasks:     [{ label: 'Task A', done: false }, { label: 'Task B', done: true }],
    syncedAt:  new Date().toISOString(),
    connected: true,
    error:     null
  }
};

const GCAL_ONLY = {
  ...EMPTY_DATA,
  gcal: {
    tasks:    [{ label: 'GCal Task', done: false }],
    events:   [{ time: '09:00', label: 'Work', startMs: 1000000, endMs: 1003600000 }],
    upcoming: [{ title: 'Event', inDays: 3 }],
    syncedAt: new Date().toISOString(),
    error:    null
  }
};

const WITH_OVERDUE = {
  ...ELLIE_CONNECTED,
  ellie: {
    tasks: [
      { label: 'Overdue', done: false, dueDate: new Date(Date.now() - 86400000).toISOString() },
      { label: 'Current', done: false, dueDate: new Date(Date.now() + 86400000).toISOString() }
    ],
    syncedAt:  new Date().toISOString(),
    connected: true,
    error:     null
  }
};

/* ------------------------------------------------------------------ */
/* getTodaysTasks                                                       */
/* ------------------------------------------------------------------ */

console.log('\ngetTodaysTasks:');

assert('returns [] when no data',
  Derived.getTodaysTasks(EMPTY_DATA).length === 0);

assertEqual('uses Ellie tasks when connected',
  Derived.getTodaysTasks(ELLIE_CONNECTED),
  ELLIE_CONNECTED.ellie.tasks);

assertEqual('falls back to gcal.tasks when Ellie disconnected',
  Derived.getTodaysTasks(GCAL_ONLY),
  GCAL_ONLY.gcal.tasks);

assert('falls back to gcal when Ellie connected but empty',
  Derived.getTodaysTasks({
    ...GCAL_ONLY,
    ellie: { tasks: [], connected: true, syncedAt: null, error: null }
  }).length === 1);

/* ------------------------------------------------------------------ */
/* getOverdueTasks                                                      */
/* ------------------------------------------------------------------ */

console.log('\ngetOverdueTasks:');

assert('returns [] when no overdue', Derived.getOverdueTasks(ELLIE_CONNECTED).length === 0);

assert('returns overdue task', Derived.getOverdueTasks(WITH_OVERDUE).length === 1);

assert('done task is not overdue',
  Derived.getOverdueTasks({
    ...EMPTY_DATA,
    ellie: {
      tasks: [{ label: 'Done', done: true, dueDate: new Date(Date.now() - 1000).toISOString() }],
      connected: true, syncedAt: null, error: null
    }
  }).length === 0);

/* ------------------------------------------------------------------ */
/* calculateDayStatus                                                   */
/* ------------------------------------------------------------------ */

console.log('\ncalculateDayStatus:');

assertEqual('CLEAR when no tasks', Derived.calculateDayStatus(EMPTY_DATA).status, 'CLEAR');

assertEqual('ON TRACK when >=80% done',
  Derived.calculateDayStatus({
    ...EMPTY_DATA,
    ellie: {
      tasks: [
        { label: 'A', done: true }, { label: 'B', done: true },
        { label: 'C', done: true }, { label: 'D', done: true }, { label: 'E', done: false }
      ],
      connected: true, syncedAt: null, error: null
    }
  }).status, 'ON TRACK');

assertEqual('TIGHT when 50-79% done',
  Derived.calculateDayStatus({
    ...EMPTY_DATA,
    ellie: {
      tasks: [
        { label: 'A', done: true }, { label: 'B', done: false }
      ],
      connected: true, syncedAt: null, error: null
    }
  }).status, 'TIGHT');

assertEqual('OVERLOADED when <50% done',
  Derived.calculateDayStatus({
    ...EMPTY_DATA,
    ellie: {
      tasks: [
        { label: 'A', done: true }, { label: 'B', done: false }, { label: 'C', done: false }
      ],
      connected: true, syncedAt: null, error: null
    }
  }).status, 'OVERLOADED');

const statusResult = Derived.calculateDayStatus(ELLIE_CONNECTED);
assertEqual('pct = 50 for 1/2 done', statusResult.pct, 50);
assertEqual('total = 2',             statusResult.total, 2);
assertEqual('done = 1',              statusResult.done, 1);

/* ------------------------------------------------------------------ */
/* calculateAttentionItems                                              */
/* ------------------------------------------------------------------ */

console.log('\ncalculateAttentionItems:');

const attEmpty = Derived.calculateAttentionItems(EMPTY_DATA);
assert('has info item when Ellie not connected',
  attEmpty.some(i => i.type === 'info'));

const attEllieFail = Derived.calculateAttentionItems({
  ...ELLIE_CONNECTED,
  ellie: { ...ELLIE_CONNECTED.ellie, error: 'Network timeout', connected: false }
});
assert('has error item when Ellie fails', attEllieFail.some(i => i.type === 'error'));

const attGcalFail = Derived.calculateAttentionItems({
  ...EMPTY_DATA,
  gcal: { ...EMPTY_DATA.gcal, error: 'API quota exceeded' }
});
assert('has error item when gcal fails', attGcalFail.some(i => i.type === 'error'));

const attOverdue = Derived.calculateAttentionItems(WITH_OVERDUE);
assert('has urgent item for overdue tasks', attOverdue.some(i => i.type === 'urgent'));

/* ------------------------------------------------------------------ */
/* calculateWeeklyStats                                                 */
/* ------------------------------------------------------------------ */

console.log('\ncalculateWeeklyStats:');

const weekly = Derived.calculateWeeklyStats(ELLIE_CONNECTED);
assertEqual('tasksTotal = 2', weekly.tasksTotal, 2);
assertEqual('tasksDone = 1',  weekly.tasksDone,  1);
assertEqual('overdue = 0',    weekly.overdue,    0);
assert('focusSessions is a number', typeof weekly.focusSessions === 'number');

/* ------------------------------------------------------------------ */
/* getUpcomingItems                                                     */
/* ------------------------------------------------------------------ */

console.log('\ngetUpcomingItems:');

assertEqual('returns gcal.upcoming', Derived.getUpcomingItems(GCAL_ONLY), GCAL_ONLY.gcal.upcoming);
assertEqual('returns [] when no upcoming', Derived.getUpcomingItems(EMPTY_DATA), []);

/* ------------------------------------------------------------------ */
/* Summary                                                              */
/* ------------------------------------------------------------------ */

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
