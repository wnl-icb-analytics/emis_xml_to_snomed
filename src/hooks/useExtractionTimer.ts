import { useState, useEffect, useRef } from 'react';

export interface ExtractionTimerState {
  elapsedTime: number;
  remainingTime: number | null;
  totalTime: number | null;
}

export interface ExtractionTimerActions {
  start: () => void;
  stop: () => void;
  recordValueSetTime: (timeInMs: number) => void;
  updateProgress: (completed: number, total: number) => void;
}

/**
 * Custom hook for tracking extraction timer with intelligent remaining time estimation
 * Uses a rolling average of the last 50 valueset processing times to estimate completion
 */
export function useExtractionTimer(): [ExtractionTimerState, ExtractionTimerActions] {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [remainingTime, setRemainingTime] = useState<number | null>(null);
  const [totalTime, setTotalTime] = useState<number | null>(null);

  const startTimeRef = useRef<number | null>(null);
  const valuesetTimesRef = useRef<number[]>([]);
  const completedCountRef = useRef(0);
  const totalCountRef = useRef(0);
  const [isRunning, setIsRunning] = useState(false);

  // Timer interval effect
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      if (!startTimeRef.current) return;

      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedTime(elapsed);

      // Calculate remaining time based on average time per valueset
      if (valuesetTimesRef.current.length > 0 && totalCountRef.current > 0) {
        const avgTimePerValueSet =
          valuesetTimesRef.current.reduce((a, b) => a + b, 0) / valuesetTimesRef.current.length;

        const remainingValueSets = totalCountRef.current - completedCountRef.current;
        if (remainingValueSets > 0) {
          const estimatedSecondsRemaining = Math.ceil(remainingValueSets * avgTimePerValueSet);
          setRemainingTime(Math.max(0, estimatedSecondsRemaining));
        } else {
          setRemainingTime(0);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

  const start = () => {
    const now = Date.now();
    startTimeRef.current = now;
    setElapsedTime(0);
    setRemainingTime(null);
    setTotalTime(null);
    valuesetTimesRef.current = [];
    completedCountRef.current = 0;
    totalCountRef.current = 0;
    setIsRunning(true);
  };

  const stop = () => {
    if (startTimeRef.current) {
      const finalTime = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setTotalTime(finalTime);
    }
    startTimeRef.current = null;
    setIsRunning(false);
    setElapsedTime(0);
    setRemainingTime(null);
    valuesetTimesRef.current = [];
  };

  const recordValueSetTime = (timeInMs: number) => {
    const timeInSeconds = timeInMs / 1000;
    valuesetTimesRef.current.push(timeInSeconds);

    // Keep only last 50 valuesets for rolling average
    if (valuesetTimesRef.current.length > 50) {
      valuesetTimesRef.current.shift();
    }

    completedCountRef.current++;
  };

  const updateProgress = (completed: number, total: number) => {
    completedCountRef.current = completed;
    totalCountRef.current = total;
  };

  return [
    { elapsedTime, remainingTime, totalTime },
    { start, stop, recordValueSetTime, updateProgress }
  ];
}
