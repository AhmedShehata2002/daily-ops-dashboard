#!/usr/bin/env node
/**
 * One-time script to get a Google OAuth refresh token for the Tasks API.
 *
 * Usage:
 *   Step 1 — get auth URL:   node .github/scripts/get-google-token.js CLIENT_ID
 *   Step 2 — exchange code:  node .github/scripts/get-google-token.js CLIENT_ID CLIENT_SECRET AUTH_CODE
 */

const https  = require('https');
const crypto = require('crypto');

const [,, clientId, clientSecret, authCode] = process.argv;

if (!clientId) {
  console.log(`
Usage:
  1. node .github/scripts/get-google-token.js YOUR_CLIENT_ID
     → Opens an authorization URL. Paste it in your browser, sign in, and copy
       the "code" value from the URL bar after you're redirected.

  2. node .github/scripts/get-google-token.js YOUR_CLIENT_ID YOUR_CLIENT_SECRET THE_CODE
     → Exchanges the code for a refresh token and prints gh secret set commands.
`);
  process.exit(0);
}

const REDIRECT = 'http://localhost';
const SCOPE    = 'https://www.googleapis.com/auth/tasks.readonly';

if (!clientSecret) {
  const url = `https://accounts.google.com/o/oauth2/auth`
    + `?response_type=code`
    + `&client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT)}`
    + `&scope=${encodeURIComponent(SCOPE)}`
    + `&access_type=offline`
    + `&prompt=consent`;

  console.log('\nOpen this URL in your browser:\n');
  console.log(url);
  console.log('\nAfter authorising, copy the "code" from the URL bar and run:');
  console.log(`  node .github/scripts/get-google-token.js ${clientId} YOUR_CLIENT_SECRET THE_CODE\n`);
  process.exit(0);
}

// Exchange auth code for tokens
const body = new URLSearchParams({
  code:          authCode,
  client_id:     clientId,
  client_secret: clientSecret,
  redirect_uri:  REDIRECT,
  grant_type:    'authorization_code'
}).toString();

const buf = Buffer.from(body);
const req = https.request('https://oauth2.googleapis.com/token', {
  method:  'POST',
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
    console.log('\n✓ Success! Run these three commands to store the secrets:\n');
    console.log(`gh secret set GOOGLE_CLIENT_ID     --body "${clientId}"       --repo AhmedShehata2002/daily-ops-dashboard`);
    console.log(`gh secret set GOOGLE_CLIENT_SECRET --body "${clientSecret}"   --repo AhmedShehata2002/daily-ops-dashboard`);
    console.log(`gh secret set GOOGLE_REFRESH_TOKEN --body "${d.refresh_token}" --repo AhmedShehata2002/daily-ops-dashboard`);
    console.log('\nThen trigger the workflow manually to verify Tasks are syncing.');
  });
});
req.on('error', err => { console.error('Request error:', err); process.exit(1); });
req.write(body);
req.end();
