# Developer Guide

Deep-dive notes for each component of the AI Desktop Assistant.

---

## How the pipeline works (step by step)

```
User presses Ctrl+Shift+A (or auto-timer fires)
        ↓
captureManager.captureNow()
        ↓
desktopCapturer.getSources()   ← Electron API: takes screenshot
        ↓
Tesseract.recognize()          ← Local OCR: extracts text (free, fast)
        ↓
privacyFilter.sanitizeOCRText()  ← Redact passwords/cards before sending
        ↓
POST /api/orchestrate  ← {imageBase64, ocrText, sessionId, ...}
        ↓
contextService.getOrCreateSession()  ← Load session from DynamoDB
        ↓
visionService.analyzeScreen()   ← GPT-4o Vision: "what UI is this?"
        ↓
intentPredictionService.predict()  ← Rule-based: "user is deploying Lambda"
        ↓
llmService.generateGuidance()   ← Claude: builds guidance + step-by-step
        ↓
contextService.updateSession()  ← Save new history to DynamoDB
        ↓
{ summary, guidance[], intentPrediction }
        ↓
IPC: main → renderer (ipcRenderer.send("ai-response", ...))
        ↓
GuidancePanel renders steps
voiceService.speak(summary)   ← Optional voice
```

---

## Adding a new AI model

All model calls go through `backend/src/services/llmService.ts`.

To add Gemini:
```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

async function callGemini(system: string, user: string): Promise<AIResponse> {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
  const result = await model.generateContent(`${system}\n\n${user}`);
  const text = result.response.text();
  return parseAIResponse(text, "gemini-1.5-pro", 0);
}
```

Then add it to the fallback chain in `generateGuidance()`.

---

## Adding a new intent pattern

Edit `backend/src/services/intentPredictionService.ts`:

```typescript
{
  match: (i) =>
    i.visionResult.screenDescription.toLowerCase().includes("figma") ||
    i.visionResult.uiType === "figma",
  goal: "Designing UI in Figma",
  action: "using design tool",
  nextStep: "Use Auto Layout for responsive components",
},
```

---

## Extending the Smart Trigger

Edit `electron-app/src/main/smartTrigger.ts`. Current triggers:
- `repeated_clicks` — same zone clicked 4× in 4s
- `long_inactivity` — no input for 30s

To add an error-screen trigger, you'd detect error keywords in the OCR text returned from a periodic lightweight capture:

```typescript
// In startInactivityWatcher() loop:
const capture = await captureManager.captureScreen();
if (capture && /\berror\b|\bexception\b|\bfailed\b/i.test(capture.ocrText)) {
  this.trigger({ type: "error_screen", details: "Error detected in OCR", timestamp: Date.now() });
}
```

---

## Running with a local LLM (Ollama)

1. Install Ollama: https://ollama.ai
2. Pull a model: `ollama pull llama3`
3. In `backend/.env`:
   ```
   USE_LOCAL_LLM=true
   LOCAL_LLM_URL=http://localhost:11434
   LOCAL_LLM_MODEL=llama3
   ```
4. In `llmService.ts`, add:
   ```typescript
   if (process.env.USE_LOCAL_LLM === "true") {
     return await callOllama(systemPrompt, userPrompt);
   }
   ```

This gives you zero-cost inference for simple questions, only calling Claude for complex tasks.

---

## Cost Optimization Strategy

| Task | Model | Approx cost |
|------|-------|-------------|
| OCR | Tesseract (local) | Free |
| Screen description | GPT-4o-mini Vision | ~$0.0003/call |
| Simple guidance | Claude Haiku | ~$0.0002/call |
| Complex reasoning | Claude Sonnet | ~$0.003/call |
| Context storage | DynamoDB | ~$0.00001/session |

With 5-second auto-capture, running all day = ~17,000 calls/day.
Using Haiku for most calls: ~$3.40/day. Using Sonnet: ~$51/day.

**Recommendation:** Use GPT-4o-mini for vision + Claude Haiku for guidance for most calls. Only escalate to Sonnet when error detected or user explicitly asks.

---

## Privacy Architecture

Data flow with privacy mode on:

```
Screenshot → Tesseract OCR → privacyFilter.sanitizeOCRText()
                                    ↓ (redacts cards, passwords)
                            Sanitized text → Backend
                            
Screenshot → privacyFilter.blurSensitiveRegions()
                    ↓ (blacks out detected regions)
            Blurred image → Backend → S3 (if enabled, 7-day TTL)
```

Screenshots are **never stored** by default (`ENABLE_S3_STORAGE=false`).
When enabled, S3 lifecycle rule auto-deletes after 7 days.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Shift+A | Analyze screen now |
| Ctrl+Shift+H | Show/hide overlay |
| Enter (in chat) | Send question |
| Shift+Enter | New line in chat |

---

## Folder structure quick reference

```
ai-desktop-assistant/
├── Makefile                  ← make dev, make test, make deploy
├── shared/types.ts           ← TypeScript types for both sides
│
├── backend/
│   ├── src/
│   │   ├── server.ts         ← Express app entry
│   │   ├── lambda.ts         ← AWS Lambda wrapper
│   │   ├── routes/
│   │   │   ├── orchestrator.ts  ← POST /api/orchestrate (main pipeline)
│   │   │   ├── session.ts       ← CRUD for sessions
│   │   │   └── health.ts        ← GET /health
│   │   ├── services/
│   │   │   ├── visionService.ts    ← GPT-4o Vision
│   │   │   ├── llmService.ts       ← Claude / GPT guidance
│   │   │   ├── contextService.ts   ← DynamoDB session memory
│   │   │   ├── intentPrediction.ts ← Rule-based intent detection
│   │   │   ├── ocrService.ts       ← Server-side OCR fallback
│   │   │   └── s3Service.ts        ← Screenshot storage
│   │   ├── middleware/
│   │   │   └── errorHandler.ts
│   │   ├── utils/logger.ts
│   │   └── tests/
│   │       ├── services.test.ts    ← Unit tests
│   │       ├── api.test.ts         ← Integration tests
│   │       └── privacy.test.ts     ← Privacy filter tests
│   ├── scripts/setup-aws.ts  ← One-time AWS resource creation
│   ├── serverless.yml        ← AWS Lambda deployment config
│   └── jest.config.js
│
└── electron-app/
    ├── src/
    │   ├── main/
    │   │   ├── main.ts            ← Electron entry, window creation
    │   │   ├── captureManager.ts  ← Screen capture + OCR + send to API
    │   │   ├── ipcHandlers.ts     ← IPC event bridge
    │   │   ├── smartTrigger.ts    ← Auto-trigger on user confusion signals
    │   │   └── privacyFilter.ts   ← Redact sensitive data before sending
    │   ├── preload/
    │   │   └── preload.ts         ← Secure contextBridge API
    │   └── renderer/
    │       ├── index.html
    │       ├── index.tsx
    │       ├── components/
    │       │   ├── App.tsx            ← Main overlay shell
    │       │   ├── GuidancePanel.tsx  ← Step-by-step guidance display
    │       │   ├── ChatInput.tsx      ← Direct question input
    │       │   ├── SettingsPanel.tsx  ← User preferences UI
    │       │   └── HistoryPanel.tsx   ← Session history viewer
    │       ├── hooks/
    │       │   └── useAIEvents.ts     ← IPC event subscription hook
    │       └── utils/
    │           └── voiceService.ts    ← Web Speech API TTS
    ├── forge.config.js        ← Electron Forge build config
    └── tsconfig.json
```
