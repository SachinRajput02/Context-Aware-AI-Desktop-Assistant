
# Context-Aware AI Desktop Assistant

> A floating desktop overlay that watches your screen, understands what you are doing using AI vision and OCR, and gives you real-time step-by-step guidance.

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [Architecture](#architecture)
3. [Project Structure](#project-structure)
4. [Prerequisites](#prerequisites)
5. [Local Development Setup](#local-development-setup)
6. [Environment Variables](#environment-variables)
7. [Running Locally](#running-locally)
8. [AWS Deployment (Backend)](#aws-deployment-backend)
9. [Frontend Deployment (Electron Installer)](#frontend-deployment-electron-installer)
10. [Keyboard Shortcuts](#keyboard-shortcuts)
11. [How It Works](#how-it-works)
12. [Cost](#cost)

---

## What It Does

- Captures your screen every N seconds automatically
- Runs OCR on the backend to extract visible text
- Sends the screenshot to Gemini Vision to understand the UI context
- Uses Gemma to generate step-by-step contextual guidance
- Remembers your session history (DynamoDB) to give continuity-aware advice
- Shows guidance in a floating, always-on-top overlay
- Optionally reads guidance aloud via Web Speech API

---

## Architecture

```
[Electron Overlay]
      ↓  screenshot (base64 JPEG)
[Backend — Express / AWS Lambda]
      ↓
  ┌─────────────────────────────────────────┐
  │  OCR (Tesseract.js, server-side)        │
  │  Privacy filter (redact cards/SSNs)     │
  │  Vision AI  →  gemini-3.1-flash-lite    │
  │  Context    →  DynamoDB session memory  │
  │  LLM        →  gemma-4-26b-a4b-it       │
  └─────────────────────────────────────────┘
      ↓  JSON guidance (steps + summary)
[Electron Overlay — React UI]
```

---

## Project Structure

```
Context-Aware-AI-Desktop-Assistant/
├── shared/
│   └── types.ts                  ← TypeScript interfaces for both sides
│
├── backend/
│   ├── src/
│   │   ├── server.ts             ← Express entry point
│   │   ├── lambda.ts             ← AWS Lambda wrapper (serverless-http)
│   │   ├── routes/
│   │   │   ├── orchestrator.ts   ← POST /api/orchestrate (main pipeline)
│   │   │   ├── session.ts        ← session CRUD
│   │   │   └── health.ts         ← GET /health
│   │   ├── services/
│   │   │   ├── visionService.ts      ← Gemini vision (screenshot → JSON)
│   │   │   ├── llmService.ts         ← Gemma (context → guidance JSON)
│   │   │   ├── contextService.ts     ← DynamoDB session memory
│   │   │   ├── intentPredictionService.ts ← rule-based intent detection
│   │   │   ├── ocrService.ts         ← Tesseract singleton worker
│   │   │   ├── privacyFilter.ts      ← redact sensitive OCR text
│   │   │   └── s3Service.ts          ← optional screenshot archival
│   │   ├── middleware/
│   │   │   └── errorHandler.ts
│   │   └── utils/logger.ts
│   ├── scripts/setup-aws.ts      ← one-time DynamoDB + S3 creation
│   ├── serverless.yml            ← AWS Lambda + API Gateway + DynamoDB IaC
│   ├── .env.example
│   └── package.json
│
└── electron-app/
    ├── src/
    │   ├── main/
    │   │   ├── main.ts           ← window, tray, shortcuts, IPC
    │   │   ├── captureManager.ts ← desktopCapturer → compress → POST
    │   │   ├── ipcHandlers.ts    ← question, clipboard, auto-capture
    │   │   └── smartTrigger.ts   ← repeated-click + inactivity detection
    │   ├── preload/
    │   │   └── preload.ts        ← contextBridge secure API
    │   └── renderer/
    │       ├── index.html
    │       ├── index.tsx
    │       ├── components/
    │       │   ├── App.tsx
    │       │   ├── GuidancePanel.tsx
    │       │   ├── ChatInput.tsx
    │       │   ├── StatusIndicator.tsx
    │       │   ├── SettingsPanel.tsx
    │       │   └── HistoryPanel.tsx
    │       ├── hooks/
    │       │   └── useAIEvents.ts
    │       └── utils/
    │           └── voiceService.ts
    ├── forge.config.js
    ├── webpack.main.config.js
    ├── webpack.renderer.config.js
    ├── tsconfig.json
    ├── .env.example
    └── package.json
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18 | https://nodejs.org |
| npm | ≥ 9 | comes with Node |
| AWS CLI | v2 | https://aws.amazon.com/cli |
| Serverless Framework | v3 | `npm i -g serverless` |

> Tesseract OCR is **no longer required locally** — OCR runs server-side on the backend.

---

## Local Development Setup

### Step 1 — Clone and install

```bash
git clone <your-repo>
cd Context-Aware-AI-Desktop-Assistant

# Backend
cd backend && npm install && cd ..

# Electron app
cd electron-app && npm install && cd ..
```

### Step 2 — Configure environment variables

```bash
cp backend/.env.example backend/.env
cp electron-app/.env.example electron-app/.env
```

Fill in both `.env` files. See [Environment Variables](#environment-variables) below.

### Step 3 — (Optional) Configure AWS for DynamoDB

```bash
aws configure
# Access Key ID, Secret Key, Region: us-east-1, output: json
```

If you skip this, the backend falls back to an in-memory store. Add `SKIP_DYNAMODB=true`
to `backend/.env` to silence the connection warnings during local dev.

### Step 4 — (Optional) Create AWS resources

```bash
cd backend
npx ts-node scripts/setup-aws.ts
```

Creates `ai-assistant-sessions` DynamoDB table and the S3 screenshots bucket.

---

## Environment Variables

### `backend/.env`

```env
# ── AI models ────────────────────────────────────────────────────────
GOOGLE_AI_API_KEY=AIzaSy...          # get from https://aistudio.google.com/apikey

# Vision model: screenshot → structured JSON description
VISION_MODEL=gemini-3.1-flash-lite

# LLM model: context + vision → step-by-step guidance
LLM_MODEL=gemma-4-26b-a4b-it

# ── AWS ──────────────────────────────────────────────────────────────
AWS_REGION=us-east-1
AWS_DYNAMODB_TABLE_SESSIONS=ai-assistant-sessions
AWS_S3_BUCKET=ai-assistant-screenshots

# ── Local dev options ─────────────────────────────────────────────────
PORT=3001
NODE_ENV=development
SKIP_DYNAMODB=true           # set false when DynamoDB is configured
ENABLE_S3_STORAGE=false      # set true to archive screenshots to S3
LOG_LEVEL=info
```

### `electron-app/.env`

```env
# Use localhost for dev; use your API Gateway URL in production
BACKEND_URL=http://localhost:3001

# How often to auto-analyze the screen (milliseconds)
# Keep at 20000+ to stay within free-tier rate limits
CAPTURE_INTERVAL_MS=20000

ENABLE_VOICE=false
DEBUG=false
```

---

## Running Locally

```bash
# Terminal 1 — start the backend
cd backend && npm run dev

# Terminal 2 — start the Electron overlay
cd electron-app && npm start
```

The floating overlay appears in the bottom-right corner. Press **Ctrl+Shift+A** to analyze
your screen immediately, or click the ⟳ button in the overlay.

---

## AWS Deployment (Backend)

The backend runs as an AWS Lambda function accessed through API Gateway.
If you already have it deployed, use these commands to push updated code.

### First deployment

```bash
cd backend

# 1. Set NODE_ENV=production and SKIP_DYNAMODB=false in backend/.env

# 2. Build TypeScript
npm run build

# 3. Deploy everything (Lambda + API Gateway + DynamoDB + S3 + IAM)
serverless deploy --stage prod
```

At the end, Serverless prints your API Gateway URL:
```
endpoints:
  POST - https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/api/orchestrate
  GET  - https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/health
```

Copy that base URL — you need it in the next section.

### Redeploying after a code change

```bash
cd backend
npm run build

# Redeploy everything
serverless deploy --stage prod

# Or redeploy only the main function (faster, ~30 seconds)
serverless deploy function --function orchestrate --stage prod
```

### Verify the backend is live

```bash
curl https://<your-api-url>/health
# Expected: {"status":"ok","ts":...}
```

### View live logs

```bash
serverless logs --function orchestrate --stage prod --tail
```

### Tear down all AWS resources

```bash
serverless remove --stage prod
```

---

## Frontend Deployment (Electron Installer)

Electron Forge's make command runs electron-forge package under the hood, which bundles your app code with the Electron binary, then creates OS-specific distributables like DMG, deb, or MSI.

### Step 1 — Point the app at your production backend

Open `electron-app/.env` and replace localhost with your API Gateway URL:

```env
BACKEND_URL=https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod
CAPTURE_INTERVAL_MS=20000
ENABLE_VOICE=false
DEBUG=false
```

### Step 2 — (Optional) Add an app icon

Place these files in `electron-app/assets/`:

```
electron-app/assets/
├── icon.ico     ← Windows (256×256)
├── icon.icns    ← macOS
└── icon.png     ← Linux (512×512)
```

Convert a PNG to all three formats free at https://cloudconvert.com/png-to-ico

### Step 3 — Build the installer

```bash
cd electron-app
npm install        # make sure all deps are installed
npm run make       # webpack + package + create installer
```

This takes 1–3 minutes. Output goes to `electron-app/out/make/`:

```
out/make/
├── squirrel.windows/x64/
│   └── AI Desktop Assistant Setup.exe    ← Windows installer
├── zip/darwin/x64/
│   └── AI Desktop Assistant-1.0.0.zip   ← macOS (zip)
└── deb/x64/
    └── ai-desktop-assistant_1.0.0_amd64.deb   ← Linux
```

### Step 4 — Install and run

**Windows:** Double-click `AI Desktop Assistant Setup.exe` → installs and launches automatically.

**macOS:** Unzip and drag `AI Desktop Assistant.app` to `/Applications`.

**Linux:**
```bash
sudo dpkg -i ai-desktop-assistant_1.0.0_amd64.deb
```

### Platform notes

- **Windows builds** must be created on a Windows machine.
- **macOS builds** must be created on a Mac. Users on macOS 13+ will see a
  Gatekeeper warning on unsigned builds — they can bypass with right-click → Open.
- **Linux builds** work on Ubuntu, Debian, and derivatives.

### Rebuilding after a backend-only change

If you only changed backend code (model strings, logic, etc.) and redeployed to Lambda,
the Electron app does **not** need to be rebuilt — it talks to the same API Gateway URL
and picks up the new backend automatically.

Only rebuild the Electron installer when you change:
- Any file in `electron-app/src/`
- `electron-app/.env` (e.g. changing `BACKEND_URL`)
- `shared/types.ts`

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Analyze screen immediately |
| `Ctrl+Shift+H` | Toggle overlay visibility |
| Click tray icon | Show / hide overlay |

---

## How It Works

1. **Capture** — `desktopCapturer` takes a 1280×720 screenshot and compresses it to JPEG at 75% quality (~150–400 KB)
2. **Change detection** — if the screen hash matches the previous capture, the API call is skipped entirely to preserve quota
3. **Send** — the image is posted to `/api/orchestrate` on the backend (Lambda or local Express)
4. **OCR** — Tesseract.js runs server-side, extracting visible text from the image
5. **Privacy filter** — credit card numbers, SSNs, and password lines are redacted from the OCR text before it reaches any AI model
6. **Vision** — `gemini-3.1-flash-lite` receives the screenshot and OCR text, returns a structured JSON description of the UI (screen type, visible buttons, errors detected)
7. **Context** — DynamoDB retrieves the last 20 interactions for this session, including the inferred user goal and skill level
8. **Intent prediction** — rule-based pattern matching infers what the user is trying to do
9. **LLM guidance** — `gemma-4-26b-a4b-it` receives the vision result, context, and intent, returns numbered step-by-step guidance as JSON
10. **Context update** — the session record in DynamoDB is updated with this interaction
11. **Response** — the guidance is pushed to the Electron renderer via IPC; the overlay renders numbered steps the user can check off; voice output reads the summary if enabled

---

## Cost

For a demo project with up to 5 users per day (approximately 125 API calls/day):

| Resource | Free tier | Estimated cost |
|----------|-----------|----------------|
| Gemini 3.1 Flash Lite (vision) | 500 RPD | $0 |
| Gemma 4 26B (LLM) | 1,500 RPD | $0 |
| AWS Lambda | 1M req/month | $0 |
| API Gateway | 1M req/month | ~$0.01 |
| DynamoDB | 25 GB free | $0 |
| S3 (if enabled) | 5 GB free | $0 |

**Total estimated monthly cost: $0 for a 5-user demo.**

The main cost driver if you scale up will be the AI API calls, not AWS infrastructure.
ENDOFFILE
echo "README written"
Output

README written
Done

You are out of free messages until 11:40 PM
Upgrade
#   C o n t e x t - A w a r e - A I - D e s k t o p - A s s i s t a n t  
 