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
