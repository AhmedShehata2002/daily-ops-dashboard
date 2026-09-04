const https = require('https');
const fs    = require('fs');

const TZ = 'Africa/Cairo';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`Bad JSON: ${raw.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: TZ
  });
}

function daysBetween(isoString, from) {
  const diff = new Date(isoString) - from;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function calUrl(key, calId, extra) {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?key=${key}&singleEvents=true&orderBy=startTime&${extra}`;
}

async function main() {
  const key   = process.env.GCAL_API_KEY;
  const calId = process.env.GCAL_CALENDAR_ID;

  if (!key || !calId) {
    console.error('Missing GCAL_API_KEY or GCAL_CALENDAR_ID — skipping sync.');
    process.exit(0);
  }

  const now        = new Date();
  const todayStr   = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const todayStart = new Date(`${todayStr}T00:00:00+02:00`).toISOString();
  const todayEnd   = new Date(`${todayStr}T23:59:59+02:00`).toISOString();
  const futureEnd  = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  let todayData, upcomingData;
  try {
    [todayData, upcomingData] = await Promise.all([
      get(calUrl(key, calId, `timeMin=${todayStart}&timeMax=${todayEnd}&maxResults=20`)),
      get(calUrl(key, calId, `timeMin=${now.toISOString()}&timeMax=${futureEnd}&maxResults=8`))
    ]);
  } catch (err) {
    console.error('Calendar fetch failed:', err.message);
    // Write error to data.json so dashboard can show stale indicator
    const dataPath = 'data.json';
    const current  = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    current.gcal = current.gcal || {};
    current.gcal.error = err.message;
    fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
    process.exit(1);
  }

  if (todayData.error) {
    console.error('Calendar API error:', JSON.stringify(todayData.error));
    process.exit(1);
  }

  const items = todayData.items || [];

  // All-day events (date only) → today task list
  const today = items
    .filter(ev => ev.start.date && !ev.start.dateTime)
    .map(ev => ({ label: ev.summary || 'Untitled', done: false }));

  // Timed events (dateTime) → calendar entries with optional ms for conflict detection
  const timedEvents = items
    .filter(ev => ev.start.dateTime)
    .map(ev => ({
      time:    formatTime(ev.start.dateTime),
      label:   ev.summary || 'Untitled',
      startMs: new Date(ev.start.dateTime).getTime(),
      endMs:   ev.end && ev.end.dateTime ? new Date(ev.end.dateTime).getTime() : null
    }));

  // Upcoming events (skip all-day)
  const upcoming = (upcomingData.items || [])
    .filter(ev => ev.start.dateTime)
    .slice(0, 6)
    .map(ev => ({
      title:  ev.summary || 'Untitled',
      inDays: daysBetween(ev.start.dateTime, now)
    }));

  const dataPath = 'data.json';
  const current  = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  current.gcal = {
    today:    today.length    ? today    : (current.gcal && current.gcal.today    || []),
    upcoming: upcoming.length ? upcoming : (current.gcal && current.gcal.upcoming || []),
    syncedAt: new Date().toISOString(),
    error:    null
  };

  // Also keep timed events separate for the calendar card
  if (timedEvents.length) current.gcal.today = timedEvents;

  // Recalculate: today = all-day tasks, timedEvents for calendar display
  // Store both
  current.gcal = {
    tasks:    today,         // all-day events → task list
    events:   timedEvents,   // timed events → calendar card
    upcoming: upcoming,
    syncedAt: new Date().toISOString(),
    error:    null
  };

  fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
  console.log(`Synced: ${today.length} tasks, ${timedEvents.length} events, ${upcoming.length} upcoming.`);
}

main().catch(err => { console.error(err); process.exit(1); });
