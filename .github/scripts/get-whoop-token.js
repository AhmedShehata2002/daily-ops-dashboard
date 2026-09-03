#!/usr/bin/env node
/**
 * One-time helper to get a Whoop OAuth2 refresh token.
 *
 * Prerequisites:
 *   1. Go to https://developer.whoop.com → create a new app
 *   2. Set redirect URI to:  http://localhost
 *   3. Copy your Client ID and Client Secret
 *
 * Usage:
 *   Step 1 — get the auth URL:
 *     node .github/scripts/get-whoop-token.js YOUR_CLIENT_ID
 *
 *   Step 2 — exchange the code for tokens:
 *     node .github/scripts/get-whoop-token.js YOUR_CLIENT_ID YOUR_CLIENT_SECRET THE_CODE
 */

const https = require('https');

const [,, clientId, clientSecret, authCode] = process.argv;

if (!clientId) {
  console.log(`
Usage:
  1. node .github/scripts/get-whoop-token.js YOUR_CLIENT_ID
     Opens an authorization URL. After you sign in, copy the "code" from
     the redirect URL bar (looks like: localhost/?code=ABC123...).

  2. node .github/scripts/get-whoop-token.js YOUR_CLIENT_ID YOUR_SECRET THE_CODE
     Exchanges the code for a refresh token and prints the secret commands.
`);
  process.exit(0);
}

const REDIRECT = 'http://localhost';
const SCOPE    = 'read:recovery read:cycles';

if (!clientSecret) {
  const url = 'https://api.prod.whoop.com/oauth/oauth2/auth'
    + `?response_type=code`
    + `&client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT)}`
    + `&scope=${encodeURIComponent(SCOPE)}`;

  console.log('\nOpen this URL in your browser:\n');
  console.log(url);
  console.log('\nAfter authorising, copy the "code" from the URL bar and run:');
  console.log(`  node .github/scripts/get-whoop-token.js ${clientId} YOUR_CLIENT_SECRET THE_CODE\n`);
  process.exit(0);
}

// Exchange auth code → tokens
const body = new URLSearchParams({
  code:          authCode,
  client_id:     clientId,
  client_secret: clientSecret,
  redirect_uri:  REDIRECT,
  grant_type:    'authorization_code'
}).toString();

const buf = Buffer.from(body);
const req = https.request('https://api.prod.whoop.com/oauth/oauth2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': buf.length }
}, res => {
  let raw = '';
  res.on('data', c => raw += c);
  res.on('end', () => {
    const d = JSON.parse(raw);
    if (!d.refresh_token) {
      console.error('\nFailed to get refresh token:', JSON.stringify(d, null, 2));
      process.exit(1);
    }
    console.log('\n✓ Success! Run these commands to store the secrets:\n');
    console.log(`gh secret set WHOOP_CLIENT_ID     --body "${clientId}"        --repo AhmedShehata2002/daily-ops-dashboard`);
    console.log(`gh secret set WHOOP_CLIENT_SECRET --body "${clientSecret}"    --repo AhmedShehata2002/daily-ops-dashboard`);
    console.log(`gh secret set WHOOP_REFRESH_TOKEN --body "${d.refresh_token}" --repo AhmedShehata2002/daily-ops-dashboard`);
    console.log(`\n# Also set GITHUB_PAT (classic PAT with repo+workflow scopes) so the`);
    console.log(`# workflow can auto-rotate the refresh token:`);
    console.log(`gh secret set BOT_PAT --body "YOUR_PAT_HERE" --repo AhmedShehata2002/daily-ops-dashboard`);
    console.log('\nThen trigger the sync-whoop workflow manually to verify data is syncing.\n');
  });
});
req.on('error', err => { console.error('Request error:', err); process.exit(1); });
req.write(body);
req.end();
