import { UnavailableCommandError } from "./errors";

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

/**
 * Android ties media playback to the microphone's audio route. Opening the
 * microphone with the browser's default speech-processing constraints can put
 * the device into a communication audio mode, so the Voice gets quieter or
 * louder as capture starts and stops. Asking for the raw microphone avoids
 * that route on Android; the model normalizes its own input, so it does not
 * need the browser's gain control.
 */
const ANDROID = /android/i;
const ON_ANDROID = ANDROID.test(typeof navigator === "undefined" ? "" : navigator.userAgent);

/** The constraints every capture in this app asks for. */
export const RAW_MICROPHONE: MediaTrackConstraints = ON_ANDROID
  ? {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    }
  : {};

/**
 * Android needs a moment after `stopListening` before the audio route is back
 * on the speaker. The Voice should not start inside that window.
 */
export const MIC_RELEASE_MS = ON_ANDROID ? 200 : 0;

/** True once the browser has granted the microphone at least once this page. */
let microphoneReady = false;

/**
 * Ask for the microphone before doing anything expensive.
 *
 * `getUserMedia` is what makes the browser prompt. Asking first means a
 * refusal is reported as a refusal instead of being hidden behind a model
 * download, and the model is not fetched for someone who will not allow the
 * microphone. The stream is closed again immediately; listening opens it for
 * real once the model is ready.
 */
export async function ensureMicrophone(): Promise<void> {
  if (microphoneReady) return;
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    throw new UnavailableCommandError("microphones need HTTPS or localhost");
  }
  if (!microphoneAvailable()) {
    throw new UnavailableCommandError("this browser cannot use a microphone");
  }
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_MICROPHONE });
    microphoneReady = true;
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop();
  }
}
