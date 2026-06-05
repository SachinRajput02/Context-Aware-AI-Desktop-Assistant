// electron-app/src/shared/types.ts

export interface ScreenCapturePayload {
  imageBase64: string;
  ocrText?: string;
  activeApp: string;
  windowTitle: string;
  timestamp: number;
  sessionId: string;
  userId: string;
  mousePosition?: { x: number; y: number };
  selectedText?: string;
  userQuestion?: string;
  uploadedDocuments?: UploadedDocument[];
}

export interface UploadedDocument {
  id: string;
  name: string;
  type: string;               // MIME type
  content: string;            // base64 for binary, plain text for text files
  isText: boolean;
  uploadedAt: number;
  sessionId: string;
}

export interface SessionContext {
  sessionId: string;
  userId: string;
  history: ContextHistoryEntry[];
  currentGoal?: string;
  userLevel?: "beginner" | "intermediate" | "expert";
  uploadedDocuments: UploadedDocument[];   // persisted per session
  createdAt: number;
  updatedAt: number;
  isActive: boolean;                       // false = session stopped
}

export interface ContextHistoryEntry {
  timestamp: number;
  screenSummary: string;
  action?: string;
  appName: string;
  userQuestion?: string;
  aiSummary?: string;         // one-line summary of what AI said
}

export interface AIResponse {
  summary: string;
  guidance: GuidanceStep[];
  intentPrediction?: string;
  fullAnswer?: string;        // complete answer/fix for user query
  confidence: number;
  modelUsed: string;
  tokensUsed: number;
}

export interface GuidanceStep {
  step: number;
  title: string;
  description: string;
  type: "info" | "action" | "warning" | "tip" | "code";
  codeSnippet?: string;
}

export interface OrchestratorRequest {
  capture: ScreenCapturePayload;
  context: SessionContext;
}

export interface OrchestratorResponse {
  success: boolean;
  response?: AIResponse;
  error?: string;
  updatedContext: SessionContext;
}

export interface SmartTriggerEvent {
  type: "repeated_clicks" | "long_inactivity" | "error_screen" | "manual";
  details?: string;
  timestamp: number;
}

export interface VoiceInputResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
}

export interface SessionCreateRequest {
  userId: string;
}

export interface SessionControlRequest {
  sessionId: string;
  userId: string;
  action: "stop" | "new";
}

export interface DocumentUploadRequest {
  sessionId: string;
  userId: string;
  document: UploadedDocument;
}






// // shared/types.ts

// export interface ScreenCapturePayload {
//   imageBase64: string;
//   ocrText?: string;          // ← OPTIONAL now: absent when OCR runs server-side
//   activeApp: string;
//   windowTitle: string;
//   timestamp: number;
//   sessionId: string;
//   userId: string;
//   mousePosition?: { x: number; y: number };
//   selectedText?: string;
//   userQuestion?: string;
// }


// export interface SessionContext {
//   sessionId: string;
//   userId: string;
//   history: ContextHistoryEntry[];
//   currentGoal?: string;
//   userLevel?: "beginner" | "intermediate" | "expert";
//   createdAt: number;
//   updatedAt: number;
// }

// export interface ContextHistoryEntry {
//   timestamp: number;
//   screenSummary: string;
//   action?: string;
//   appName: string;
// }

// export interface AIResponse {
//   summary: string;
//   guidance: GuidanceStep[];
//   intentPrediction?: string;
//   confidence: number;
//   modelUsed: string;
//   tokensUsed: number;
// }

// export interface GuidanceStep {
//   step: number;
//   title: string;
//   description: string;
//   type: "info" | "action" | "warning" | "tip";
// }

// export interface OrchestratorRequest {
//   capture: ScreenCapturePayload;
//   context: SessionContext;
// }

// export interface OrchestratorResponse {
//   success: boolean;
//   response?: AIResponse;
//   error?: string;
//   updatedContext: SessionContext;
// }

// export interface SmartTriggerEvent {
//   type: "repeated_clicks" | "long_inactivity" | "error_screen" | "manual";
//   details?: string;
//   timestamp: number;
// }