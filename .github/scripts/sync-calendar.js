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

function calUrl(key, calId, extra) {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?key=${key}&singleEvents=true&orderBy=startTime&${extra}`;
}

async function main() {
  const key        = process.env.GCAL_API_KEY;
  const calId      = process.env.GCAL_CALENDAR_ID;
  const tasksCalId = process.env.GCAL_TASKS_ID;   // optional Tasks calendar

  if (!key || !calId) {
    console.error('Missing GCAL_API_KEY or GCAL_CALENDAR_ID — skipping sync.');
    process.exit(0);
  }

  const now        = new Date();
  const todayStr   = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const todayStart = new Date(`${todayStr}T00:00:00+02:00`).toISOString();
  const todayEnd   = new Date(`${todayStr}T23:59:59+02:00`).toISOString();
  const futureEnd  = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch main calendar (events today + upcoming)
  const [todayData, upcomingData] = await Promise.all([
    get(calUrl(key, calId, `timeMin=${todayStart}&timeMax=${todayEnd}&maxResults=10`)),
    get(calUrl(key, calId, `timeMin=${now.toISOString()}&timeMax=${futureEnd}&maxResults=8`))
  ]).catch(err => { console.error('Calendar fetch failed:', err.message); process.exit(1); });

  if (todayData.error) {
    console.error('Calendar API error:', JSON.stringify(todayData.error));
    process.exit(1);
  }

  const calendar = (todayData.items || []).map(ev => ({
    time:  ev.start.dateTime ? formatTime(ev.start.dateTime) : 'All day',
    label: ev.summary || 'Untitled'
  }));

  const upNext = (upcomingData.items || []).slice(0, 6).map(ev => ({
    title:  ev.summary || 'Untitled',
    inDays: daysBetween(ev.start.dateTime || ev.start.date, now)
  }));

  const dataPath = 'data.json';
  const current  = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  current.calendar = calendar.length ? calendar : current.calendar;
  current.upNext   = upNext.length   ? upNext   : current.upNext;

  // Fetch Tasks calendar → Today card (optional, uses same API key)
  if (tasksCalId) {
    try {
      const tasksData = await get(
        calUrl(key, tasksCalId, `timeMin=${todayStart}&timeMax=${todayEnd}&maxResults=10`)
      );
      const tasks = (tasksData.items || []).map(ev => ({
        label: ev.summary || 'Untitled',
        done:  false
      }));
      if (tasks.length > 0) {
        current.today = tasks;
        console.log(`Tasks synced: ${tasks.length} items from Tasks calendar.`);
      }
    } catch (err) {
      console.warn('Tasks calendar fetch failed (non-fatal):', err.message);
    }
  }

  fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
  console.log(`Calendar synced: ${calendar.length} events today, ${upNext.length} upcoming.`);
}

main().catch(err => { console.error(err); process.exit(1); });
