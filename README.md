# 🖥️ Context-Aware AI Desktop Assistant

> A floating desktop overlay that watches your screen, understands what you're doing using AI vision and OCR, and gives you real-time step-by-step guidance.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Cost](https://img.shields.io/badge/cost-%240%2Fmonth%20(demo)-success)

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

| Feature | Description |
|---------|-------------|
| 📸 **Screen capture** | Captures your screen every N seconds automatically |
| 🔍 **OCR** | Runs Tesseract OCR on the backend to extract visible text |
| 👁️ **Vision AI** | Sends the screenshot to Gemini Vision to understand the UI context |
| 🧠 **LLM guidance** | Uses Gemma to generate step-by-step contextual guidance |
| 💾 **Session memory** | Remembers your session history via DynamoDB for continuity-aware advice |
| 🖼️ **Floating overlay** | Shows guidance in an always-on-top overlay |
| 🔊 **Voice output** | Optionally reads guidance aloud via Web Speech API |

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
│   │   │   ├── visionService.ts           ← Gemini vision (screenshot → JSON)
│   │   │   ├── llmService.ts              ← Gemma (context → guidance JSON)
│   │   │   ├── contextService.ts          ← DynamoDB session memory
│   │   │   ├── intentPredictionService.ts ← rule-based intent detection
│   │   │   ├── ocrService.ts              ← Tesseract singleton worker
│   │   │   ├── privacyFilter.ts           ← redact sensitive OCR text
│   │   │   └── s3Service.ts               ← optional screenshot archival
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

> **Note:** Tesseract OCR is **no longer required locally** — OCR runs server-side on the backend.

---

## Local Development Setup

### Step 1 — Clone and install

```bash
git clone https://github.com/SachinRajput02/Context-Aware-AI-Desktop-Assistant.git
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
# Prompts for: Access Key ID, Secret Key, Region (us-east-1), output format (json)
```

> If you skip this step, the backend falls back to an in-memory store. Add `SKIP_DYNAMODB=true` to `backend/.env` to silence connection warnings during local development.

### Step 4 — (Optional) Create AWS resources

```bash
cd backend
npx ts-node scripts/setup-aws.ts
```

This creates the `ai-assistant-sessions` DynamoDB table and the S3 screenshots bucket.

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
# Use localhost for dev; replace with your API Gateway URL in production
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

The floating overlay appears in the bottom-right corner. Press **Ctrl+Shift+A** to analyze your screen immediately, or click the ⟳ button in the overlay.

---

## AWS Deployment (Backend)

The backend runs as an AWS Lambda function accessed through API Gateway. Use the following commands to deploy or update the backend.

### First deployment

```bash
cd backend

# 1. Set NODE_ENV=production and SKIP_DYNAMODB=false in backend/.env

# 2. Build TypeScript
npm run build

# 3. Deploy everything (Lambda + API Gateway + DynamoDB + S3 + IAM)
serverless deploy --stage prod
```

After deployment, Serverless prints your API Gateway URL:

```
endpoints:
  POST - https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/api/orchestrate
  GET  - https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/health
```

Copy that base URL — you'll need it when building the Electron installer.

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

Electron Forge's `make` command bundles your app code with the Electron binary, then creates OS-specific distributables (DMG, deb, or MSI).

### Step 1 — Point the app at your production backend

Open `electron-app/.env` and replace `localhost` with your API Gateway URL:

```env
BACKEND_URL=https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod
CAPTURE_INTERVAL_MS=20000
ENABLE_VOICE=false
DEBUG=false
```

### Step 2 — (Optional) Add an app icon

Place the following files in `electron-app/assets/`:

```
electron-app/assets/
├── icon.ico     ← Windows (256×256)
├── icon.icns    ← macOS
└── icon.png     ← Linux (512×512)
```

> You can convert a PNG to all three formats for free at https://cloudconvert.com/png-to-ico

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
│   └── AI Desktop Assistant Setup.exe          ← Windows installer
├── zip/darwin/x64/
│   └── AI Desktop Assistant-1.0.0.zip         ← macOS (zip)
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

> ⚠️ **Windows builds** must be created on a Windows machine.

> ⚠️ **macOS builds** must be created on a Mac. Users on macOS 13+ will see a Gatekeeper warning on unsigned builds — they can bypass it with right-click → Open.

> ✅ **Linux builds** work on Ubuntu, Debian, and derivatives.

### When to rebuild the Electron installer

If you only changed backend code and redeployed to Lambda, the Electron app does **not** need to be rebuilt — it talks to the same API Gateway URL and picks up backend changes automatically.

Only rebuild the installer when you change:

- Any file in `electron-app/src/`
- `electron-app/.env` (e.g. a new `BACKEND_URL`)
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

1. **Capture** — `desktopCapturer` takes a 1280×720 screenshot and compresses it to JPEG at 75% quality (~150–400 KB).
2. **Change detection** — if the screen hash matches the previous capture, the API call is skipped entirely to preserve quota.
3. **Send** — the image is posted to `/api/orchestrate` on the backend (Lambda or local Express).
4. **OCR** — Tesseract.js runs server-side, extracting visible text from the image.
5. **Privacy filter** — credit card numbers, SSNs, and password lines are redacted from the OCR text before it reaches any AI model.
6. **Vision** — `gemini-3.1-flash-lite` receives the screenshot and OCR text, and returns a structured JSON description of the UI (screen type, visible buttons, errors detected).
7. **Context** — DynamoDB retrieves the last 20 interactions for this session, including the inferred user goal and skill level.
8. **Intent prediction** — rule-based pattern matching infers what the user is trying to do.
9. **LLM guidance** — `gemma-4-26b-a4b-it` receives the vision result, context, and intent, and returns numbered step-by-step guidance as JSON.
10. **Context update** — the session record in DynamoDB is updated with this interaction.
11. **Response** — guidance is pushed to the Electron renderer via IPC; the overlay renders numbered steps the user can check off; voice output reads the summary if enabled.

---

## Cost

Estimated for a demo project with up to 5 users/day (~125 API calls/day):

| Resource | Free Tier | Estimated Cost |
|----------|-----------|----------------|
| Gemini 3.1 Flash Lite (vision) | 500 RPD | $0 |
| Gemma 4 26B (LLM) | 1,500 RPD | $0 |
| AWS Lambda | 1M req/month | $0 |
| API Gateway | 1M req/month | ~$0.01 |
| DynamoDB | 25 GB free | $0 |
| S3 (if enabled) | 5 GB free | $0 |

**Total estimated monthly cost: ~$0.01 for a 5-user demo.**

> The main cost driver at scale will be AI API calls, not AWS infrastructure.

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

---

*Built with [Electron](https://www.electronjs.org/), [Google Gemini](https://ai.google.dev/), [Gemma](https://ai.google.dev/gemma), [Tesseract.js](https://tesseract.projectnaptha.com/), [AWS Lambda](https://aws.amazon.com/lambda/), and [DynamoDB](https://aws.amazon.com/dynamodb/).*