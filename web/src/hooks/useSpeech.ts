import { useCallback, useRef, useState } from 'react';

// Ports speakKorean()/stopSpeakingKorean() (§IMP-09): always speaks in
// Korean regardless of UI language, guards against overlapping duplicate
// speech on repeated clicks, and never throws in environments without
// SpeechSynthesis — the caller gets `supported: false` and can fall back
// to the always-visible Korean text instead (§IMP-09's "text alternative").
export function useSpeech(onUnsupported: () => void) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const isSpeakingRef = useRef(false);

  const speak = useCallback(
    (text: string) => {
      if (!supported) {
        onUnsupported();
        return;
      }
      if (isSpeakingRef.current) return; // duplicate-click guard

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ko-KR';
      utterance.rate = 0.9;
      const voices = window.speechSynthesis.getVoices();
      const koVoice = voices.find((v) => v.lang.startsWith('ko'));
      if (koVoice) utterance.voice = koVoice;

      isSpeakingRef.current = true;
      setIsSpeaking(true);
      utterance.onend = () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
      };
      utterance.onerror = () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
      };
      window.speechSynthesis.speak(utterance);
    },
    [supported, onUnsupported]
  );

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    isSpeakingRef.current = false;
    setIsSpeaking(false);
  }, [supported]);

  return { speak, stop, isSpeaking, supported };
}
