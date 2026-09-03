const https = require('https');
const fs = require('fs');

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

async function main() {
  const key = process.env.GCAL_API_KEY;
  const calId = process.env.GCAL_CALENDAR_ID;

  if (!key || !calId) {
    console.error('Missing GCAL_API_KEY or GCAL_CALENDAR_ID secrets — skipping sync.');
    process.exit(0);
  }

  const now = new Date();

  // Cairo midnight today and end of today
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const todayStart = new Date(`${todayStr}T00:00:00+02:00`).toISOString();
  const todayEnd   = new Date(`${todayStr}T23:59:59+02:00`).toISOString();
  const futureEnd  = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?key=${key}&singleEvents=true&orderBy=startTime`;
  const todayUrl    = `${base}&timeMin=${todayStart}&timeMax=${todayEnd}&maxResults=10`;
  const upcomingUrl = `${base}&timeMin=${now.toISOString()}&timeMax=${futureEnd}&maxResults=8`;

  let todayData, upcomingData;
  try {
    [todayData, upcomingData] = await Promise.all([get(todayUrl), get(upcomingUrl)]);
  } catch (err) {
    console.error('Google Calendar API error:', err.message);
    process.exit(1);
  }

  if (todayData.error) {
    console.error('Calendar API returned error:', JSON.stringify(todayData.error));
    process.exit(1);
  }

  // Build calendar card entries (today's events)
  const calendar = (todayData.items || []).map(ev => ({
    time: ev.start.dateTime ? formatTime(ev.start.dateTime) : 'All day',
    label: ev.summary || 'Untitled'
  }));

  // Build upNext entries (upcoming events in the next 14 days)
  const upNext = (upcomingData.items || []).slice(0, 6).map(ev => ({
    title: ev.summary || 'Untitled',
    inDays: daysBetween(ev.start.dateTime || ev.start.date, now)
  }));

  // Merge into existing data.json (preserves all manual fields)
  const dataPath = 'data.json';
  const current = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  current.calendar = calendar.length ? calendar : current.calendar;
  current.upNext   = upNext.length   ? upNext   : current.upNext;

  fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
  console.log(`Synced: ${calendar.length} events today, ${upNext.length} upcoming.`);
}

main().catch(err => { console.error(err); process.exit(1); });
