#!/usr/bin/env node
/**
 * Helper script to generate LiveKit access tokens
 * 
 * Usage:
 *   node generate-token.js --url wss://your-project.livekit.cloud --api-key APIxxxxx --api-secret secret_xxxxx --room my-room --identity agent
 */

// Check if we're using ES modules or CommonJS
let process = require('process');
let AccessToken;

try {
  // Try CommonJS first
  AccessToken = require('@livekit/server-sdk').AccessToken;
} catch (e1) {
  try {
    // Try ES modules
    const livekit = await import('@livekit/server-sdk');
    AccessToken = livekit.AccessToken;
  } catch (e2) {
    // Neither works
  }
}

function generateToken(options) {
  const { url, apiKey, apiSecret, room, identity } = options;
  
  if (!AccessToken) {
    console.error('Error: @livekit/server-sdk not installed.');
    console.error('\nTo install it, run:');
    console.error('  cd services/livekit-agent');
    console.error('  npm install @livekit/server-sdk');
    console.error('\nOr use LiveKit Cloud dashboard to generate tokens.');
    console.error('Go to: https://cloud.livekit.io/ → Your Project → Generate Token');
    process.exit(1);
  }
  
  try {
    const at = new AccessToken(apiKey, apiSecret, {
      identity: identity || 'agent',
    });
    
    at.addGrant({
      room: room || 'default-room',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    
    const token = at.toJwt();
    return token;
  } catch (err) {
    console.error('Error generating token:', err.message);
    throw err;
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace('--', '');
  const value = args[i + 1];
  if (key && value) {
    options[key.replace(/-/g, '')] = value;
  }
}

if (!options.url || !options.apikey || !options.apisecret) {
  console.log('Usage: node generate-token.js --url <wss-url> --api-key <api-key> --api-secret <secret> [--room <room-name>] [--identity <identity>]');
  console.log('\nExample:');
  console.log('  node generate-token.js --url wss://my-project.livekit.cloud --api-key APIxxxxx --api-secret secret_xxxxx --room my-room --identity agent');
  process.exit(1);
}

try {
  const token = generateToken({
    url: options.url,
    apiKey: options.apikey,
    apiSecret: options.apisecret,
    room: options.room || 'default-room',
    identity: options.identity || 'agent',
  });
  
  console.log('\n✓ Token generated successfully!\n');
  console.log('LIVEKIT_URL=' + options.url);
  console.log('LIVEKIT_TOKEN=' + token);
  console.log('\nCopy these and export them as environment variables, or add to .env file\n');
} catch (err) {
  console.error('Error generating token:', err.message);
  process.exit(1);
}

