# Save Your Environment Variables

## Quick Setup (One Time)

### Step 1: Create `.env` File

Create a file named `.env` in your project root (`/Users/tanvisheth/Documents/NexHacks/nexhacks/.env`):

```bash
cd /Users/tanvisheth/Documents/NexHacks/nexhacks
nano .env
```

Or use any text editor. Add your variables:

```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_TOKEN=your-generated-token-here
WS_HUB_URL=ws://localhost:8787
```

**Replace with your actual values!**

### Step 2: Save and Run

Now you can just run:

```bash
npm run demo
```

The script will automatically load your variables from `.env`!

## Alternative: Use a Shell Script

If you prefer, you can also create a `start.sh` file:

```bash
#!/bin/bash
export LIVEKIT_URL="wss://your-project.livekit.cloud"
export LIVEKIT_TOKEN="your-generated-token-here"
export WS_HUB_URL="ws://localhost:8787"
./scripts/dev-demo.sh
```

Then make it executable:
```bash
chmod +x start.sh
```

And run:
```bash
./start.sh
```

## Important: Don't Commit Secrets!

Make sure `.env` is in `.gitignore`:

```bash
echo ".env" >> .gitignore
```

## Verify It's Working

After creating `.env`, when you run `npm run demo`, you should see:

```
[demo] Loading environment variables from .env file...
[demo] ✓ Environment variables loaded
[demo] starting ws-hub
...
```

If you see that message, your variables are being loaded automatically! 🎉

