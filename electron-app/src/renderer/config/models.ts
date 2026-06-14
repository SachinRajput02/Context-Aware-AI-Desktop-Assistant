// electron-app/src/renderer/config/models.ts
// Selectable model list shown in the top bar. The selected model id is sent
// to the backend as `modelOverride` on every orchestrate request — the
// backend may use it to route to a different provider/model, or ignore it.

export interface ModelOption {
  id: string;
  label: string;
  provider: "anthropic" | "openai" | "google";
}

export const MODEL_OPTIONS: ModelOption[] = [
{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic" },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai" },
  
];

export const DEFAULT_MODEL_ID = MODEL_OPTIONS[0].id;

export function getModelLabel(id: string): string {
  return MODEL_OPTIONS.find((m) => m.id === id)?.label ?? id;
}