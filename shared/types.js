"use strict";
// electron-app/src/shared/types.ts
Object.defineProperty(exports, "__esModule", { value: true });
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
//# sourceMappingURL=types.js.map