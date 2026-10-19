export interface VoiceOption {
  id: string;
  label: string;
  lang: string;
  local: boolean;
}

export interface SpeakOptions {
  /** BCP-47 tag of the voice to prefer. */
  lang: string;
  rate?: number;
  onBoundary?: (charIndex: number) => void;
  /** Fired when the platform refuses or fails to speak. */
  onError?: (reason: string) => void;
}

/**
 * The seam between the app and whatever actually makes sound.
 *
 * Only Web Speech ships today. The seam exists because Web Speech has known
 * failure modes (see webSpeech.ts) and Google has no guarantee of stability
 * across browsers, so any replacement belongs behind this interface rather than
 * threaded through the screens.
 */
export interface TtsProvider {
  readonly id: string;
  listVoices(): Promise<VoiceOption[]>;
  /**
   * Whether the browser will tell us its voice list at all. `false` means
   * "unknowable" — NOT "no voices". Chrome on Android usually returns an empty
   * list even when voices are installed, so availability cannot be inferred
   * from it there.
   */
  canEnumerateVoices(): Promise<boolean>;
  /** Resolves when speech finishes, or when the provider gives up waiting. */
  speak(text: string, options: SpeakOptions): Promise<void>;
  cancel(): void;
}
