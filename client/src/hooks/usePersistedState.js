import { useState, useEffect } from "react";

/**
 * A drop-in replacement for useState that persists to localStorage.
 * Handles parsing/stringifying and deals gracefully with missing keys.
 */
export function usePersistedState(key, defaultValue) {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        return JSON.parse(saved);
      }
    } catch (err) {
      console.warn(`Error reading localStorage key "${key}":`, err);
    }
    return defaultValue;
  });

  useEffect(() => {
    try {
      if (state === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(state));
      }
    } catch (err) {
      console.warn(`Error writing localStorage key "${key}":`, err);
    }
  }, [key, state]);

  return [state, setState];
}
