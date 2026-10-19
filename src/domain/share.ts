import { LANGUAGES, type LanguageId, type Mode } from "./types";

/**
 * A shared dictation, and the link that carries it.
 *
 * The payload rides in the URL fragment, never the query string: a fragment is
 * not sent to the server, so the passage being drilled stays out of the host's
 * access logs. It is deflated and base64url-encoded, which keeps the link short
 * enough to survive a QR code, and means no character in it needs escaping.
 *
 * Everything here treats the payload as untrusted input. It arrives from a URL
 * that anybody can write.
 */

export interface SharedSetup {
  language: LanguageId;
  mode: Mode;
  title: string;
  text: string;
}

/**
 * Where a shared link points. Fixed rather than `location.origin`, so a link
 * made while running locally still opens for whoever receives it.
 */
export const SHARE_BASE = "https://self-dictation.netlify.app/";

/** The fragment key, as in `#d=<payload>`. */
export const SHARE_KEY = "d";

/** Longer than any honest Setup — and far past the point a QR code scans. */
export const MAX_PAYLOAD_CHARS = 8000;

/** Cap on what a payload may inflate to, so a crafted link cannot exhaust memory. */
export const MAX_JSON_BYTES = 100_000;

/** 1 = this format. Version and codec are the first two characters. */
const VERSION = "1";
const DEFLATED = "z";
const RAW = "r";

export function shareUrl(payload: string): string {
  return `${SHARE_BASE}#${SHARE_KEY}=${payload}`;
}

/** The payload out of a `location.hash`, or null when there isn't one. */
export function payloadFromHash(hash: string): string | null {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  const prefix = `${SHARE_KEY}=`;
  if (!body.startsWith(prefix)) return null;
  const payload = body.slice(prefix.length);
  return payload.length > 0 ? payload : null;
}

export async function encodeSetup(setup: SharedSetup): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(setup));
  const deflated = await deflate(bytes);
  if (deflated) return `${VERSION}${DEFLATED}${toBase64Url(deflated)}`;
  return `${VERSION}${RAW}${toBase64Url(bytes)}`;
}

/** The Setup a payload describes, or null if it is not one. */
export async function decodeSetup(payload: string): Promise<SharedSetup | null> {
  if (!payload || payload.length > MAX_PAYLOAD_CHARS) return null;
  if (payload[0] !== VERSION) return null;
  const codec = payload[1];
  if (codec !== DEFLATED && codec !== RAW) return null;

  const bytes = fromBase64Url(payload.slice(2));
  if (!bytes) return null;
  const json = codec === DEFLATED ? await inflate(bytes) : bytes;
  return json ? parseSetup(json) : null;
}

function parseSetup(bytes: Uint8Array): SharedSetup | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  const { language, mode, title, text: body } = value as Record<string, unknown>;
  const languageOk = LANGUAGES.some((l) => l.id === language);
  if (!languageOk || (mode !== "paragraph" && mode !== "vocab")) return null;
  if (typeof title !== "string" || typeof body !== "string") return null;
  return { language: language as LanguageId, mode, title, text: body };
}

/**
 * Bytes that definitely sit in an ArrayBuffer, which is what the streams take:
 * their writable sides accept `BufferSource`, and a plain `Uint8Array` may in
 * principle be backed by a `SharedArrayBuffer`.
 */
type Bytes = Uint8Array<ArrayBuffer>;

function source(bytes: Bytes): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Read a stream to its end, refusing to grow past the cap. */
async function collect(readable: ReadableStream<Uint8Array>): Promise<Bytes | null> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.length;
    if (size > MAX_JSON_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Null when this browser has no DEFLATE, or the bytes will not squeeze. */
async function deflate(bytes: Bytes): Promise<Bytes | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    return await collect(source(bytes).pipeThrough(new CompressionStream("deflate-raw")));
  } catch {
    return null;
  }
}

async function inflate(bytes: Bytes): Promise<Bytes | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    return await collect(source(bytes).pipeThrough(new DecompressionStream("deflate-raw")));
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Bytes | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
