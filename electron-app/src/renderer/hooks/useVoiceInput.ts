// electron-app/src/renderer/hooks/useVoiceInput.ts
// Voice input using the Web Speech API (available in Electron's Chromium).
// When recognition finalises, sends transcript to captureManager via IPC.

import { useState, useRef, useCallback, useEffect } from "react";

interface UseVoiceInputOptions {
  /**
   * Called with the final transcript when recognition ends.
   * The parent decides whether to send it as a question.
   */
  onTranscript: (transcript: string) => void;
  /** BCP-47 language tag, e.g. "en-US". Defaults to "en-US". */
  language?: string;
}

interface UseVoiceInputReturn {
  isListening: boolean;
  interimTranscript: string;
  startListening: () => void;
  stopListening: () => void;
  error: string | null;
}

// Extend Window with webkit prefix (Electron/Chrome)
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export function useVoiceInput({
  onTranscript,
  language = "en-US",
}: UseVoiceInputOptions): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef<string>("");
  const manualStopRef = useRef(false);

  const getRecognition = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this environment.");
      return null;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = language;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setIsListening(true);
      setError(null);
      finalTranscriptRef.current = "";
    };

    rec.onresult = (event: any) => {
      let interim = "";
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
      if (event.error === "aborted" || event.error === "no-speech") {
        // Non-fatal — user stopped or there was silence
        setError(null);
      } else {
        setError(`Voice error: ${event.error}`);
      }
      setIsListening(false);
      setInterimTranscript("");
    };

    rec.onend = () => {
      setIsListening(false);
      setInterimTranscript("");

      const transcript = finalTranscriptRef.current.trim();
      if (transcript && !manualStopRef.current) {
        onTranscript(transcript);
      } else if (transcript && manualStopRef.current) {
        // User manually stopped — still deliver the transcript
        onTranscript(transcript);
      }

      manualStopRef.current = false;
      finalTranscriptRef.current = "";
    };

    return rec;
  }, [language, onTranscript]);

  const startListening = useCallback(() => {
    if (isListening) return;

    // Cleanup any previous instance
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
    }

    const rec = getRecognition();
    if (!rec) return;

    recognitionRef.current = rec;
    manualStopRef.current = false;

    try {
      rec.start();
    } catch (err: any) {
      setError("Could not start voice recognition: " + err.message);
    }
  }, [isListening, getRecognition]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    manualStopRef.current = true;
    try {
      recognitionRef.current.stop();
    } catch {}
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  return {
    isListening,
    interimTranscript,
    startListening,
    stopListening,
    error,
  };
}