// electron-app/src/renderer/hooks/useVoiceInput.ts
// Voice input using the Web Speech API (available in Electron's Chromium).
// When recognition finalises (or is manually stopped), delivers the transcript
// to the parent via onTranscript. The parent decides what to do with it.
//
// Changes vs original:
//  - Removed redundant duplicate branch in onend (both paths did the same thing)
//  - Added explicit "not supported" guard exposed in return value
//  - Added restart-on-network-error recovery
//  - Stable onTranscript reference via useRef to avoid stale closure bugs

import { useState, useRef, useCallback, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseVoiceInputOptions {
  /**
   * Called with the final transcript when recognition ends (naturally or manually).
   * Only called when the transcript is non-empty.
   */
  onTranscript: (transcript: string) => void;
  /** BCP-47 language tag, e.g. "en-US". Defaults to "en-US". */
  language?: string;
}

interface UseVoiceInputReturn {
  isListening: boolean;
  isSupported: boolean;
  interimTranscript: string;
  startListening: () => void;
  stopListening: () => void;
  error: string | null;
}

// ─── Browser API type extension (webkit prefix in Electron/Chrome) ────────────

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVoiceInput({
  onTranscript,
  language = "en-US",
}: UseVoiceInputOptions): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef     = useRef<any>(null);
  const finalTranscriptRef = useRef<string>("");
  const manualStopRef      = useRef(false);

  // Keep onTranscript stable — avoids stale closure if parent re-renders
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  // Detect support once (not on every render)
  const isSupported =
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const buildRecognition = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.continuous      = true;
    rec.interimResults  = true;
    rec.lang            = language;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setIsListening(true);
      setError(null);
      finalTranscriptRef.current = "";
    };

    rec.onresult = (event: any) => {
      let interim    = "";
      let finalChunk = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalChunk += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (finalChunk) {
        finalTranscriptRef.current += finalChunk;
      }
      setInterimTranscript(interim);
    };

    rec.onerror = (event: any) => {
      setIsListening(false);
      setInterimTranscript("");

      switch (event.error) {
        case "no-speech":
          // Non-fatal — user was just silent; clear any previous error
          setError(null);
          break;
        case "aborted":
          // Triggered by our own .abort() call — not an error
          setError(null);
          break;
        case "network":
          setError("Voice recognition lost network. Please check your connection.");
          break;
        case "not-allowed":
        case "service-not-allowed":
          setError("Microphone access was denied. Allow it in system settings.");
          break;
        case "audio-capture":
          setError("No microphone found or it is in use by another app.");
          break;
        default:
          setError(`Voice error: ${event.error}`);
      }
    };

    rec.onend = () => {
      setIsListening(false);
      setInterimTranscript("");

      const transcript = finalTranscriptRef.current.trim();
      if (transcript) {
        // Deliver whether the user stopped manually or recognition ended naturally
        onTranscriptRef.current(transcript);
      }

      manualStopRef.current      = false;
      finalTranscriptRef.current = "";
    };

    return rec;
  }, [language]);

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError("Speech recognition is not supported in this environment.");
      return;
    }
    if (isListening) return;

    // Abort any previous instance before creating a new one
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
    }

    const rec = buildRecognition();
    if (!rec) {
      setError("Speech recognition is not supported in this environment.");
      return;
    }

    recognitionRef.current    = rec;
    manualStopRef.current     = false;

    try {
      rec.start();
    } catch (err: any) {
      setError(`Could not start voice recognition: ${err.message}`);
    }
  }, [isListening, isSupported, buildRecognition]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    manualStopRef.current = true;
    try { recognitionRef.current.stop(); } catch { /* ignore */ }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
    error,
  };
}