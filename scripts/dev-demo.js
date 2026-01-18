#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
process.chdir(ROOT_DIR);

// Load environment variables from .env file
const fs = require('fs');
const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) {
  console.log('[demo] Loading environment variables from .env file...');
  const envContent = fs.readFileSync(envFile, 'utf8');
  envContent.split('\n').forEach(line => {
    line = line.trim();
    // Skip comments and empty lines
    if (line && !line.startsWith('#')) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  });
  console.log('[demo] ✓ Environment variables loaded');
}

const NODE_CMD = ['node', '--experimental-strip-types'];
const processes = [];
let isCleaningUp = false;

function start(name, cmd) {
  console.log(`[demo] starting ${name}`);
  const [command, ...args] = cmd;
  const proc = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    cwd: ROOT_DIR,
    env: process.env // Pass all environment variables (including from .env)
  });
  
  proc.on('error', (err) => {
    console.error(`[demo] error starting ${name}:`, err);
  });
  
  processes.push({ name, process: proc });
}

function cleanup() {
  // Prevent multiple cleanup calls
  if (isCleaningUp) {
    return;
  }
  isCleaningUp = true;
  
  console.log('\n[demo] cleaning up...');
  processes.forEach(({ name, process: proc }) => {
    try {
      if (proc && !proc.killed && proc.pid) {
        console.log(`[demo] stopping ${name}`);
        if (process.platform === 'win32') {
          // On Windows, we need to kill the process tree
          const killProc = spawn('taskkill', ['/F', '/T', '/PID', proc.pid.toString()], {
            stdio: 'ignore',
            shell: true
          });
          killProc.on('error', () => {
            // Ignore errors
          });
        } else {
          proc.kill('SIGTERM');
        }
      }
    } catch (err) {
      // Ignore errors during cleanup
    }
  });
  
  // Give processes a moment to clean up, then force kill if needed
  setTimeout(() => {
    processes.forEach(({ name, process: proc }) => {
      if (proc && !proc.killed && proc.pid) {
        try {
          if (process.platform === 'win32') {
            const killProc = spawn('taskkill', ['/F', '/T', '/PID', proc.pid.toString()], {
              stdio: 'ignore',
              shell: true
            });
            killProc.on('error', () => {
              // Ignore
            });
          } else {
            proc.kill('SIGKILL');
          }
        } catch (err) {
          // Ignore
        }
      }
    });
    process.exit(0);
  }, 2000);
}

// Handle cleanup on exit
// Node.js handles SIGINT on Windows in modern versions, but we'll also handle SIGBREAK
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('SIGBREAK', cleanup); // Windows alternative to SIGINT
process.on('exit', () => {
  // Final cleanup on exit (synchronous, no setTimeout)
  if (!isCleaningUp) {
    processes.forEach(({ process: proc }) => {
      if (proc && !proc.killed && proc.pid) {
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/F', '/T', '/PID', proc.pid.toString()], {
              stdio: 'ignore',
              shell: true
            });
          } else {
            proc.kill('SIGKILL');
          }
        } catch (err) {
          // Ignore
        }
      }
    });
  }
});

// Start all services
start('ws-hub', [...NODE_CMD, 'services/ws-hub/src/index.ts']);
// Small delay to let ws-hub start before clients connect
setTimeout(() => {
  start('livekit-agent', [...NODE_CMD, 'services/livekit-agent/src/index.ts']);
  start('gemini-worker', [...NODE_CMD, 'services/gemini-worker/src/index.ts']);
  start('market-matcher', [...NODE_CMD, 'services/market-matcher/src/index.ts']);
}, 500);

console.log('[demo] all services started. Press Ctrl+C to stop.');

// Keep the process alive
process.stdin.resume();
