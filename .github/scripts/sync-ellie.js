/**
 * sync-ellie.js — Server-side Ellie MCP client.
 * Calls Ellie's MCP endpoint (JSON-RPC 2.0) to fetch today's tasks.
 * Writes to data.json under the `ellie` key.
 *
 * Required secrets:
 *   ELLIE_MCP_URL  — your personal MCP URL from Ellie Settings → Power Features
 *   ELLIE_API_KEY  — your Ellie API key (x-api-key header)
 */
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const url   = require('url');

function jsonRpc(mcpUrl, apiKey, method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id:      1,
      method,
      params:  params || {}
    });

    const parsed   = new url.URL(mcpUrl);
    const isHttps  = parsed.protocol === 'https:';
    const lib      = isHttps ? https : http;
    const port     = parsed.port || (isHttps ? 443 : 80);

    const options = {
      hostname: parsed.hostname,
      port,
      path:     parsed.pathname + (parsed.search || ''),
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key':     apiKey
      }
    };

    const req = lib.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`Bad JSON: ${raw.slice(0, 200)}`)); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Discover available tools and find the right one for listing tasks.
 */
async function discoverTaskTool(mcpUrl, apiKey) {
  const res   = await jsonRpc(mcpUrl, apiKey, 'tools/list', {});
  const tools = (res.result && res.result.tools) || [];
  // Look for any tool whose name suggests task listing
  const candidates = ['list_tasks', 'get_tasks', 'getTasks', 'listTasks', 'tasks'];
  for (const name of candidates) {
    if (tools.find(t => t.name === name)) return name;
  }
  // Fallback: use the first tool that mentions "task" in its name or description
  const taskTool = tools.find(t =>
    t.name.toLowerCase().includes('task') ||
    (t.description && t.description.toLowerCase().includes('task'))
  );
  return taskTool ? taskTool.name : null;
}

/**
 * Normalise Ellie task response into { label, done, dueDate? }
 */
function normaliseTask(raw) {
  return {
    label:   raw.title || raw.name || raw.label || raw.summary || 'Untitled',
    done:    !!(raw.completed || raw.done || raw.finished || raw.status === 'done'),
    dueDate: raw.due_date || raw.dueDate || raw.due || null
  };
}

async function main() {
  const mcpUrl = process.env.ELLIE_MCP_URL;
  const apiKey = process.env.ELLIE_API_KEY;

  const dataPath = 'data.json';
  const current  = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  if (!mcpUrl || !apiKey) {
    console.log('ELLIE_MCP_URL or ELLIE_API_KEY not set — skipping.');
    current.ellie = {
      tasks:     current.ellie && current.ellie.tasks || [],
      syncedAt:  current.ellie && current.ellie.syncedAt || null,
      connected: false,
      error:     'Credentials not configured'
    };
    fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
    process.exit(0);
  }

  try {
    // Step 1: discover which tool to call
    const toolName = await discoverTaskTool(mcpUrl, apiKey);
    if (!toolName) {
      throw new Error('No task-related tool found in tools/list response');
    }
    console.log(`Using tool: ${toolName}`);

    // Step 2: call the tool
    const res   = await jsonRpc(mcpUrl, apiKey, 'tools/call', {
      name:      toolName,
      arguments: {}
    });

    if (res.error) {
      throw new Error(`MCP error ${res.error.code}: ${res.error.message}`);
    }

    // Step 3: extract tasks from response
    const content = res.result && res.result.content;
    let rawTasks  = [];

    if (Array.isArray(content)) {
      // MCP returns content as array of { type, text } blocks
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          try {
            const parsed = JSON.parse(block.text);
            rawTasks = Array.isArray(parsed) ? parsed : (parsed.tasks || parsed.items || []);
          } catch (_) { /* not JSON, ignore */ }
        }
      }
    } else if (Array.isArray(res.result)) {
      rawTasks = res.result;
    }

    const tasks = rawTasks.map(normaliseTask);

    current.ellie = {
      tasks,
      syncedAt:  new Date().toISOString(),
      connected: true,
      error:     null
    };

    fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
    console.log(`Ellie synced: ${tasks.length} tasks.`);

  } catch (err) {
    console.error('Ellie sync failed:', err.message);
    current.ellie = {
      tasks:     current.ellie && current.ellie.tasks || [],
      syncedAt:  current.ellie && current.ellie.syncedAt || null,
      connected: false,
      error:     err.message
    };
    fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
