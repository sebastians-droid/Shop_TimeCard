import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

type SpeechTokenResponse = {
  token: string;
  region: string;
  customEndpointId?: string;
  maxSeconds: number;
};

type VoiceNoteButtonProps = {
  value: string;
  onChange: (next: string) => void;
  phrases?: string[];
  disabled?: boolean;
};

function appendTranscript(current: string, chunk: string) {
  const next = chunk.trim();
  if (!next) return current;
  if (!current.trim()) return next;
  const needsSpace = !/\s$/.test(current);
  return `${current}${needsSpace ? ' ' : ''}${next}`;
}

export function VoiceNoteButton({ value, onChange, phrases = [], disabled }: VoiceNoteButtonProps) {
  const [listening, setListening] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const recognizerRef = useRef<{ stopContinuousRecognitionAsync: (cb?: () => void) => void; close: () => void } | null>(null);
  const stopTimerRef = useRef<number | undefined>(undefined);
  const tickTimerRef = useRef<number | undefined>(undefined);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current !== undefined) window.clearTimeout(stopTimerRef.current);
      if (tickTimerRef.current !== undefined) window.clearInterval(tickTimerRef.current);
      try {
        recognizerRef.current?.stopContinuousRecognitionAsync(() => recognizerRef.current?.close());
      } catch {
        // ignore cleanup errors
      }
    };
  }, []);

  const stopListening = () => {
    if (stopTimerRef.current !== undefined) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = undefined;
    }
    if (tickTimerRef.current !== undefined) {
      window.clearInterval(tickTimerRef.current);
      tickTimerRef.current = undefined;
    }
    setSecondsLeft(null);
    const recognizer = recognizerRef.current;
    recognizerRef.current = null;
    setListening(false);
    if (!recognizer) return;
    try {
      recognizer.stopContinuousRecognitionAsync(() => {
        try {
          recognizer.close();
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  };

  const startListening = async () => {
    if (listening || disabled) return;
    try {
      const auth = await apiFetch<SpeechTokenResponse>('/api/speech-token');
      const maxSeconds = Math.min(Math.max(1, auth.maxSeconds || 30), 30);
      const sdk = await import('microsoft-cognitiveservices-speech-sdk');
      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(auth.token, auth.region);
      speechConfig.speechRecognitionLanguage = 'en-US';
      if (auth.customEndpointId) {
        speechConfig.endpointId = auth.customEndpointId;
      }

      const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

      if (phrases.length > 0) {
        const phraseList = sdk.PhraseListGrammar.fromRecognizer(recognizer);
        phrases
          .map((phrase) => phrase.trim())
          .filter(Boolean)
          .slice(0, 100)
          .forEach((phrase) => phraseList.addPhrase(phrase));
      }

      recognizer.recognized = (_sender, event) => {
        if (event.result.reason === sdk.ResultReason.RecognizedSpeech && event.result.text) {
          const next = appendTranscript(valueRef.current, event.result.text);
          valueRef.current = next;
          onChange(next);
        }
      };
      recognizer.canceled = (_sender, event) => {
        if (event.errorDetails) {
          toast.error(event.errorDetails);
        }
        stopListening();
      };

      recognizerRef.current = recognizer;
      setListening(true);
      setSecondsLeft(maxSeconds);
      tickTimerRef.current = window.setInterval(() => {
        setSecondsLeft((current) => (current === null ? null : Math.max(0, current - 1)));
      }, 1000);
      stopTimerRef.current = window.setTimeout(() => {
        stopListening();
        toast.info(`Voice note stopped at ${maxSeconds} seconds.`);
      }, maxSeconds * 1000);

      recognizer.startContinuousRecognitionAsync(
        () => undefined,
        (error) => {
          toast.error(error || 'Unable to start microphone recognition.');
          stopListening();
        },
      );
    } catch (error: unknown) {
      stopListening();
      toast.error(error instanceof Error ? error.message : 'Unable to start voice notes.');
    }
  };

  return (
    <Button
      type="button"
      variant={listening ? 'default' : 'outline'}
      size="sm"
      disabled={disabled}
      onClick={() => {
        if (listening) stopListening();
        else void startListening();
      }}
      aria-pressed={listening}
      title={listening ? 'Stop voice note' : 'Dictate note (max 30 seconds)'}
    >
      {listening ? <Square className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
      {listening ? `Stop${secondsLeft !== null ? ` (${secondsLeft}s)` : ''}` : 'Voice note'}
    </Button>
  );
}
