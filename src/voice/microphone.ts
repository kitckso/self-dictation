/**
 * Whether this browser has the pieces speech commands need.
 *
 * Permission is a separate question and can only be answered by trying, which
 * is why starting the listener can still fail after this says yes.
 */
export function microphoneAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof window !== "undefined" &&
    "AudioContext" in window
  );
}

/**
 * Whether to hand the Run a listener at all.
 *
 * A plain-HTTP page hides `navigator.mediaDevices`, so `microphoneAvailable()`
 * says no. Passing the listener anyway lets the Run say why voice commands are
 * unavailable instead of dropping the feature silently. `isSecureContext` is
 * `undefined` outside a real browser (and in jsdom), which is not the same as
 * a page known to be insecure.
 */
export function canTryVoiceCommands(): boolean {
  if (microphoneAvailable()) return true;
  return typeof window !== "undefined" && window.isSecureContext === false;
}
