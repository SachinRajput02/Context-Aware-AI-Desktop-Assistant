
import { useEffect } from "react";
import type { AIResponse } from "../../shared/types";

interface Options {
  onResponse: (response: AIResponse & { generation?: number }) => void;
  onStatus: (status: { status: string; message?: string; code?: string; generation?: number }) => void;
}

export function useAIEvents({ onResponse, onStatus }: Options) {
  useEffect(() => {
    const unsubResponse = window.electronAPI.onAIResponse(onResponse);
    const unsubStatus = window.electronAPI.onAnalysisStatus(onStatus);

    return () => {
      unsubResponse();
      unsubStatus();
    };
  }, [onResponse, onStatus]);
}






// // electron-app/src/renderer/hooks/useAIEvents.ts
// // Custom hook: subscribes to IPC events from the Electron main process

// import { useEffect } from "react";
// import type { AIResponse } from "../../shared/types";

// interface Options {
//   onResponse: (response: AIResponse) => void;
//   onStatus: (status: { status: string; message?: string }) => void;
// }

// export function useAIEvents({ onResponse, onStatus }: Options) {
//   useEffect(() => {
//     // Register listeners
//     const unsubResponse = window.electronAPI.onAIResponse(onResponse);
//     const unsubStatus = window.electronAPI.onAnalysisStatus(onStatus);

//     // Cleanup on unmount
//     return () => {
//       unsubResponse();
//       unsubStatus();
//     };
//   }, [onResponse, onStatus]);
// }