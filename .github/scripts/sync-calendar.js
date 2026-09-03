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

  const [todayData, upcomingData] = await Promise.all([
    get(calUrl(key, calId, `timeMin=${todayStart}&timeMax=${todayEnd}&maxResults=20`)),
    get(calUrl(key, calId, `timeMin=${now.toISOString()}&timeMax=${futureEnd}&maxResults=8`))
  ]).catch(err => { console.error('Calendar fetch failed:', err.message); process.exit(1); });

  if (todayData.error) {
    console.error('Calendar API error:', JSON.stringify(todayData.error));
    process.exit(1);
  }

  const items = todayData.items || [];

  // All-day events (date only, no dateTime) → TODAY tasks
  const today = items
    .filter(ev => ev.start.date && !ev.start.dateTime)
    .map(ev => ({ label: ev.summary || 'Untitled', done: false }));

  // Timed events (dateTime) → CALENDAR
  const calendar = items
    .filter(ev => ev.start.dateTime)
    .map(ev => ({ time: formatTime(ev.start.dateTime), label: ev.summary || 'Untitled' }));

  // Upcoming events (skip all-day) → UP NEXT
  const upNext = (upcomingData.items || [])
    .filter(ev => ev.start.dateTime)
    .slice(0, 6)
    .map(ev => ({
      title:  ev.summary || 'Untitled',
      inDays: daysBetween(ev.start.dateTime, now)
    }));

  const dataPath = 'data.json';
  const current  = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  if (today.length)    current.today    = today;
  if (calendar.length) current.calendar = calendar;
  if (upNext.length)   current.upNext   = upNext;

  fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
  console.log(`Synced: ${today.length} tasks, ${calendar.length} events, ${upNext.length} upcoming.`);
}

main().catch(err => { console.error(err); process.exit(1); });
