const fs = require('fs');

async function main() {
  const payload = JSON.parse(process.env.CLIENT_PAYLOAD || '{}');
  const steps  = Number(payload.steps)  || 0;
  const weight = Number(payload.weight) || 0;
  const tasksRaw = (payload.tasks || '').trim();

  const d = JSON.parse(fs.readFileSync('data.json', 'utf8'));

  // Steps — update current count and shift the bar history
  if (steps > 0) {
    d.steps.current = steps;
    const barVal = Math.min(10, Math.round((steps / d.steps.goal) * 10));
    d.steps.bars = [...d.steps.bars.slice(1), barVal];
  }

  // Weight — update value and append to trend (keep last 9)
  if (weight > 0) {
    const prev = d.health.weight;
    d.health.weight = weight;
    d.health.deltaKg  = parseFloat((weight - prev).toFixed(1));
    d.health.deltaLabel = 'VS LAST';
    d.health.trend = [...d.health.trend.slice(-8), weight];
    d.health.endLabel = new Date()
      .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Africa/Cairo' })
      .toUpperCase();
  }

  // Tasks — split pipe-separated titles from Shortcuts
  if (tasksRaw) {
    d.today = tasksRaw
      .split('|')
      .map(t => t.trim())
      .filter(Boolean)
      .slice(0, 8)
      .map(label => ({ label, done: false }));
  }

  fs.writeFileSync('data.json', JSON.stringify(d, null, 2) + '\n');
  console.log(`Synced — steps: ${steps}, weight: ${weight}, tasks: ${d.today.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
