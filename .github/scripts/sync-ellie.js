/**
 * sync-ellie.js — Server-side Ellie MCP client.
 * Implements MCP Streamable HTTP transport (2025-03-26 spec).
 * Flow: initialize → notifications/initialized → tools/list → tools/call
 *
 * Required GitHub Secrets:
 *   ELLIE_MCP_URL  — e.g. https://mcp.ellieplanner.com/mcp
 *   ELLIE_API_KEY  — x-api-key header value
 */
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const url   = require('url');

let sessionId = null;  // Mcp-Session-Id from initialize response

function request(mcpUrl, apiKey, method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id:      method.startsWith('notifications/') ? undefined : 1,
      method,
      params:  params || {}
    });

    const parsed  = new url.URL(mcpUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;

    const headers = {
      'Content-Type':  'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-api-key':     apiKey,
      'Accept':        'application/json, text/event-stream'
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
      method:   'POST',
      headers
    };

    const req = lib.request(options, res => {
      // Capture session ID from initialize response
      if (res.headers['mcp-session-id']) {
        sessionId = res.headers['mcp-session-id'];
      }

      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode === 202) {
          resolve(null);  // notification accepted, no body
          return;
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        }
        // Handle SSE response: extract JSON from "data: {...}" lines
        if ((res.headers['content-type'] || '').includes('text/event-stream')) {
          const match = raw.match(/^data:\s*(\{.+\})/m);
          if (match) {
            try { return resolve(JSON.parse(match[1])); }
            catch (e) { return reject(new Error(`SSE parse error: ${match[1].slice(0, 200)}`)); }
          }
          // No data line — treat as empty success
          return resolve(null);
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

async function mcpInit(mcpUrl, apiKey) {
  const res = await request(mcpUrl, apiKey, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities:    {},
    clientInfo:      { name: 'daily-ops-bot', version: '1.0' }
  });
  if (res && res.error) throw new Error(`initialize error: ${res.error.message}`);
  // Send initialized notification (no response expected)
  await request(mcpUrl, apiKey, 'notifications/initialized', {}).catch(() => {});
  console.log(`MCP session: ${sessionId || '(no session id)'}`);
}

async function listTools(mcpUrl, apiKey) {
  const res = await request(mcpUrl, apiKey, 'tools/list', {});
  if (res && res.error) throw new Error(`tools/list error: ${res.error.message}`);
  return (res && res.result && res.result.tools) || [];
}

async function callTool(mcpUrl, apiKey, name, args) {
  const res = await request(mcpUrl, apiKey, 'tools/call', { name, arguments: args || {} });
  if (res && res.error) throw new Error(`tools/call(${name}) error: ${res.error.message}`);
  return res && res.result;
}

function findTaskTool(tools) {
  const priority = ['list_tasks', 'get_tasks', 'getTasks', 'listTasks', 'tasks'];
  for (const name of priority) {
    if (tools.find(t => t.name === name)) return name;
  }
  return tools.find(t =>
    t.name.toLowerCase().includes('task') ||
    (t.description && t.description.toLowerCase().includes('task'))
  )?.name || null;
}

function normaliseTask(raw) {
  return {
    label:   raw.title || raw.name || raw.label || raw.summary || 'Untitled',
    done:    !!(raw.completed || raw.done || raw.finished || raw.status === 'done'),
    dueDate: raw.due_date || raw.dueDate || raw.due || null
  };
}

function extractTasks(result) {
  if (!result) return [];
  // content is array of { type, text } blocks
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === 'text' && block.text) {
        try {
          const p = JSON.parse(block.text);
          if (Array.isArray(p)) return p;
          if (p.tasks)  return p.tasks;
          if (p.items)  return p.items;
          if (p.data)   return p.data;
        } catch (_) {}
      }
    }
  }
  if (Array.isArray(result)) return result;
  if (result.tasks)  return result.tasks;
  if (result.items)  return result.items;
  return [];
}

async function main() {
  const mcpUrl = process.env.ELLIE_MCP_URL;
  const apiKey = process.env.ELLIE_API_KEY;

  const dataPath = 'data.json';
  const current  = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  if (!mcpUrl || !apiKey) {
    console.log('ELLIE_MCP_URL or ELLIE_API_KEY not set — skipping.');
    current.ellie = { tasks: current.ellie?.tasks || [], syncedAt: current.ellie?.syncedAt || null, connected: false, error: 'Credentials not configured' };
    fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
    process.exit(0);
  }

  try {
    await mcpInit(mcpUrl, apiKey);

    const tools    = await listTools(mcpUrl, apiKey);
    console.log('Available tools:', tools.map(t => t.name).join(', '));

    const toolName = findTaskTool(tools);
    if (!toolName) throw new Error('No task tool found. Tools: ' + tools.map(t => t.name).join(', '));
    console.log(`Using tool: ${toolName}`);

    const result   = await callTool(mcpUrl, apiKey, toolName, {});
    const rawTasks = extractTasks(result);
    const tasks    = rawTasks.map(normaliseTask);

    current.ellie = { tasks, syncedAt: new Date().toISOString(), connected: true, error: null };
    fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
    console.log(`Ellie synced: ${tasks.length} tasks.`);

  } catch (err) {
    console.error('Ellie sync failed:', err.message);
    current.ellie = {
      tasks:     current.ellie?.tasks    || [],
      syncedAt:  current.ellie?.syncedAt || null,
      connected: false,
      error:     err.message
    };
    fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
