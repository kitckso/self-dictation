/**
 * A failure that trying the same page again cannot fix.
 *
 * The page is not a secure context, or the browser has no microphone API at
 * all; both stay true until the page is reopened somewhere else.
 */
export class UnavailableCommandError extends Error {
  // A name rather than `instanceof`, so this survives the lazy chunk getting
  // its own copy of this module.
  name = "UnavailableCommandError";
}

/**
 * A trained head that cannot be used with the model this app now has.
 *
 * The message says what to do about it, because there is no way round it: a
 * head trained against a different base model has no meaning here, and
 * quietly falling back to the built-in English words would look like the
 * person's own commands had stopped working.
 *
 * It lives here rather than beside the head because the app has to be able to
 * raise it without pulling in TensorFlow.js.
 */
export class HeadMismatchError extends Error {
  // A name rather than `instanceof`, so this survives the lazy chunk getting
  // its own copy of this module.
  name = "HeadMismatchError";
  constructor(
    message = "your custom commands need to be retrained — train them again in Voice commands",
  ) {
    super(message);
  }
}

/** What to show, and whether "Try again" can possibly help. */
export type CommandFailure = {
  message: string;
  retryable: boolean;
};

/**
 * Turn whatever the browser refused with into something a person can act on.
 *
 * `getUserMedia` reports the useful part in `DOMException.name`, not in the
 * message, and a blocked microphone is a different situation from one that is
 * missing or in use.
 */
export function describeCommandError(error: unknown): CommandFailure {
  const name = nameOf(error);
  if (name === "UnavailableCommandError") {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "voice commands cannot start here";
    return { message, retryable: false };
  }
  if (name === "HeadMismatchError") {
    // Only training again can put this right, so there is nothing to offer
    // but the way to do it: a "Try again" button here would be a promise the
    // app cannot keep.
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "your custom commands need to be retrained";
    return { message, retryable: false };
  }

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        message: "microphone permission is blocked — allow it for this site, then try again",
        retryable: true,
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { message: "no microphone was found", retryable: true };
    case "NotReadableError":
    case "TrackStartError":
      return { message: "the microphone is already in use by another app", retryable: true };
    case "SecurityError":
      return { message: "microphones need HTTPS or localhost", retryable: false };
    case "OverconstrainedError":
      return {
        message: "the microphone does not meet the browser's requirements",
        retryable: false,
      };
  }
  if (error instanceof Error && error.message.trim()) {
    return { message: error.message, retryable: true };
  }
  return { message: "the microphone could not be opened", retryable: true };
}

function nameOf(error: unknown): string {
  if (typeof error !== "object" || error === null || !("name" in error)) return "";
  const name = (error as { name: unknown }).name;
  return typeof name === "string" ? name : "";
}
