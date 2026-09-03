const https = require('https');
const fs    = require('fs');

const TZ = 'Africa/Cairo';

function post(url, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': buf.length }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`Bad JSON from ${url}: ${raw.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function get(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch (e) { reject(new Error(`Bad JSON (${res.statusCode}): ${raw.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

// Fetch all pages up to `limit` records
async function getAll(baseUrl, headers, limit) {
  let results = [];
  let nextToken = null;
  do {
    const url = nextToken ? `${baseUrl}&nextToken=${encodeURIComponent(nextToken)}` : baseUrl;
    const { status, data } = await get(url, headers);
    if (status !== 200) throw new Error(`Whoop API ${status}: ${JSON.stringify(data)}`);
    results = results.concat(data.records || []);
    nextToken = data.next_token || null;
  } while (nextToken && results.length < limit);
  return results.slice(0, limit);
}

// Group daily records into ISO weeks (Mon–Sun), return weekly averages (oldest first)
function toWeeklyAvg(records, getValue) {
  const sorted = [...records].sort((a, b) =>
    new Date(a.created_at || a.start) - new Date(b.created_at || b.start));

  const weekMap = {};
  for (const r of sorted) {
    const date = new Date(r.created_at || r.start);
    const day  = date.getUTCDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day;
    const mon  = new Date(date);
    mon.setUTCDate(date.getUTCDate() + diff);
    mon.setUTCHours(0, 0, 0, 0);
    const key = mon.toISOString().slice(0, 10);
    const val = getValue(r);
    if (val != null) {
      if (!weekMap[key]) weekMap[key] = [];
      weekMap[key].push(val);
    }
  }

  return Object.keys(weekMap)
    .sort()
    .slice(-26)
    .map(k => {
      const arr = weekMap[k];
      return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10;
    });
}

// Return Mon–Sun values for the current week (0 if no data for that day)
function currentWeek(records, getValue) {
  const now     = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const dayOfWk = now.getDay(); // 0=Sun
  const monday  = new Date(now);
  monday.setDate(now.getDate() - (dayOfWk === 0 ? 6 : dayOfWk - 1));
  monday.setHours(0, 0, 0, 0);

  const dateMap = {};
  for (const r of records) {
    const d    = new Date(r.created_at || r.start);
    const dStr = d.toLocaleDateString('en-CA', { timeZone: TZ });
    const val  = getValue(r);
    if (val != null && !dateMap[dStr]) dateMap[dStr] = val;
  }

  return Array.from({ length: 7 }, (_, i) => {
    const d    = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dStr = d.toLocaleDateString('en-CA', { timeZone: TZ });
    return dateMap[dStr] ?? 0;
  });
}

async function main() {
  const clientId     = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  const refreshToken = process.env.WHOOP_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.error('Missing WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, or WHOOP_REFRESH_TOKEN — skipping.');
    process.exit(0);
  }

  // 1. Refresh OAuth token
  const tokenRes = await post(
    'https://api.prod.whoop.com/oauth/oauth2/token',
    new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         'read:recovery read:cycles'
    }).toString()
  );

  if (!tokenRes.access_token) {
    console.error('Token refresh failed:', JSON.stringify(tokenRes));
    process.exit(1);
  }

  // If token rotated, write new one for the workflow to save
  if (tokenRes.refresh_token && tokenRes.refresh_token !== refreshToken) {
    fs.writeFileSync('/tmp/new_whoop_refresh_token', tokenRes.refresh_token);
  }

  const auth = { Authorization: `Bearer ${tokenRes.access_token}` };

  // 2. Fetch last ~26 weeks of recovery + cycle data
  const [recoveryRecords, cycleRecords] = await Promise.all([
    getAll('https://api.prod.whoop.com/developer/v1/recovery?limit=25&order=descending', auth, 182),
    getAll('https://api.prod.whoop.com/developer/v1/cycle?limit=25&order=descending',    auth, 182)
  ]);

  const scoredRecovery = recoveryRecords.filter(r => r.score_state === 'SCORED' && r.score);
  const scoredCycles   = cycleRecords.filter(c => c.score_state === 'SCORED' && c.score);

  // Today's metrics — most recent scored record
  const latest = scoredRecovery[0];
  const latestCycle = scoredCycles[0];

  const recovery  = latest      ? Math.round(latest.score.recovery_score)     : null;
  const hrv       = latest      ? Math.round(latest.score.hrv_rmssd_milli)    : null;
  const restingHR = latest      ? Math.round(latest.score.resting_heart_rate) : null;
  const strain    = latestCycle ? Math.round(latestCycle.score.strain * 10) / 10 : null;

  // 26-week sparkline data
  const hrvTrend = toWeeklyAvg(scoredRecovery, r => r.score.hrv_rmssd_milli);
  const hrTrend  = toWeeklyAvg(scoredRecovery, r => r.score.resting_heart_rate);

  // This week's daily bars
  const weeklyRecovery  = currentWeek(scoredRecovery, r => Math.round(r.score.recovery_score));
  const weeklyStrain    = currentWeek(scoredCycles,   c => Math.round(c.score.strain * 10) / 10);
  const weeklyRestingHR = currentWeek(scoredRecovery, r => Math.round(r.score.resting_heart_rate));

  // Update data.json
  const dataPath = 'data.json';
  const current  = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  current.health = {
    recovery:  recovery  ?? current.health?.recovery  ?? 0,
    hrv:       hrv       ?? current.health?.hrv       ?? 0,
    restingHR: restingHR ?? current.health?.restingHR ?? 0,
    strain:    strain    ?? current.health?.strain    ?? 0,
    hrvTrend:  hrvTrend.length ? hrvTrend : (current.health?.hrvTrend || []),
    hrTrend:   hrTrend.length  ? hrTrend  : (current.health?.hrTrend  || [])
  };

  current.weekly = {
    days:      ['M','T','W','T','F','S','S'],
    recovery:  weeklyRecovery,
    strain:    weeklyStrain,
    restingHR: weeklyRestingHR
  };

  fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
  console.log(`Whoop synced: Recovery=${recovery}%, HRV=${hrv}ms, RHR=${restingHR}bpm, Strain=${strain}`);
}

main().catch(err => { console.error(err); process.exit(1); });
