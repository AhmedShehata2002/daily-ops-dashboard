const https = require('https');
const fs = require('fs');

const TZ = 'Africa/Cairo';

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`Bad JSON from ${url}: ${raw.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  const buf  = Buffer.from(body);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': buf.length }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
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

async function getGoogleAccessToken() {
  const result = await postForm('https://oauth2.googleapis.com/token', {
    grant_type:    'refresh_token',
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });
  if (!result.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(result));
  return result.access_token;
}

async function fetchGoogleTasks(accessToken) {
  const url = 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks'
    + '?showCompleted=false&showHidden=false&maxResults=10';
  const data = await get(url, { Authorization: `Bearer ${accessToken}` });
  return (data.items || []).map(t => ({ label: t.title || 'Untitled', done: false }));
}

async function main() {
  const key   = process.env.GCAL_API_KEY;
  const calId = process.env.GCAL_CALENDAR_ID;

  if (!key || !calId) {
    console.error('Missing GCAL_API_KEY or GCAL_CALENDAR_ID — skipping sync.');
    process.exit(0);
  }

  const now      = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const todayStart = new Date(`${todayStr}T00:00:00+02:00`).toISOString();
  const todayEnd   = new Date(`${todayStr}T23:59:59+02:00`).toISOString();
  const futureEnd  = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const base        = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?key=${key}&singleEvents=true&orderBy=startTime`;
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

  // Google Tasks → Today card (only if OAuth secrets are configured)
  const hasTasksAuth = process.env.GOOGLE_CLIENT_ID
    && process.env.GOOGLE_CLIENT_SECRET
    && process.env.GOOGLE_REFRESH_TOKEN;

  if (hasTasksAuth) {
    try {
      const accessToken = await getGoogleAccessToken();
      const tasks = await fetchGoogleTasks(accessToken);
      if (tasks.length > 0) current.today = tasks;
      console.log(`Tasks synced: ${tasks.length} incomplete tasks.`);
    } catch (err) {
      console.warn('Google Tasks sync failed (non-fatal):', err.message);
    }
  }

  fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
  console.log(`Calendar synced: ${calendar.length} events today, ${upNext.length} upcoming.`);
}

main().catch(err => { console.error(err); process.exit(1); });
