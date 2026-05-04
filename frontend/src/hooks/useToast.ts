// useToast.ts
// Custom hook that manages a list of short pop-up notifications ("toasts").
// Each toast appears for 3 seconds then disappears automatically.
//
// Usage:
//   const { toasts, addToast } = useToast();
//   addToast('Friend added!');   // triggers a new notification
//
// The toasts array is rendered as a fixed overlay in HomePage.tsx.
// Currently fires on: friend added, invite code copied.

import { useState, useRef, useCallback } from 'react';

export interface ToastItem {
  id: number;      // unique id used as the React key
  message: string;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // useRef keeps the counter stable across re-renders without causing extra renders itself
  const counter = useRef(0);

  const addToast = useCallback((message: string) => {
    const id = counter.current++;
    setToasts(prev => [...prev, { id, message }]);
    // remove this specific toast after 3 s (matched by id so other toasts are unaffected)
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  return { toasts, addToast };
}
