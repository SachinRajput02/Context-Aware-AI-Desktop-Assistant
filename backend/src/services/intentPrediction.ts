// backend/src/services/intentPredictionService.ts
// Predicts what the user is trying to do based on screen + history

import type { SessionContext } from "../shared/types";
import type { VisionResult } from "./visionService";

export interface IntentPredictionResult {
  predictedGoal: string;
  predictedAction: string;
  confidence: number;
  suggestedNextStep?: string;
}

interface PredictionInput {
  visionResult: VisionResult;
  context: SessionContext;
  userQuestion?: string;
  selectedText?: string;
}

// Rule-based intent patterns — extend this with an ML model for production
const INTENT_PATTERNS: Array<{
  match: (input: PredictionInput) => boolean;
  goal: string;
  action: string;
  nextStep?: string;
}> = [
  {
    match: (i) =>
      i.visionResult.uiType === "aws-console" &&
      i.visionResult.screenDescription.toLowerCase().includes("lambda"),
    goal: "Deploy or manage a Lambda function",
    action: "viewing Lambda console",
    nextStep: "Configure runtime and upload your deployment package",
  },
  {
    match: (i) =>
      i.visionResult.errorDetected === true,
    goal: "Resolve an error or exception",
    action: "encountered an error",
    nextStep: "Read the error message carefully and check logs",
  },
  {
    match: (i) =>
      i.visionResult.uiType === "terminal" ||
      i.visionResult.screenDescription.toLowerCase().includes("terminal"),
    goal: "Run commands in the terminal",
    action: "using terminal",
    nextStep: undefined,
  },
  {
    match: (i) =>
      i.visionResult.uiType === "vscode" ||
      i.visionResult.uiType === "ide",
    goal: "Write or edit code",
    action: "editing code",
    nextStep: undefined,
  },
  {
    match: (i) =>
      i.visionResult.screenDescription.toLowerCase().includes("git") ||
      i.visionResult.ocrText?.toLowerCase().includes("git") ||
      false,
    goal: "Manage Git repository",
    action: "working with Git",
    nextStep: undefined,
  },
];

export const intentPredictionService = {
  async predict(input: PredictionInput): Promise<IntentPredictionResult> {
    // Try rule-based patterns first (fast, free)
    for (const pattern of INTENT_PATTERNS) {
      if (pattern.match(input)) {
        return {
          predictedGoal: pattern.goal,
          predictedAction: pattern.action,
          confidence: 0.75,
          suggestedNextStep: pattern.nextStep,
        };
      }
    }

    // If session has a known goal, carry it forward
    if (input.context.currentGoal) {
      return {
        predictedGoal: input.context.currentGoal,
        predictedAction: "continuing previous task",
        confidence: 0.5,
      };
    }

    // Default fallback
    return {
      predictedGoal: "General software usage",
      predictedAction: "browsing",
      confidence: 0.3,
    };
  },
};