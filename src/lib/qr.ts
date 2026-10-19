import qrcode from "qrcode-generator";

/**
 * A QR code as data, with no DOM in sight, so it can be tested without a
 * browser and rendered by whatever the screen feels like.
 */
export interface QrCode {
  /** Modules per side. */
  count: number;
  isDark(row: number, col: number): boolean;
}

export interface QrPath {
  /** A path one module square at a time, in module units. */
  d: string;
  /** Modules per side including the quiet zone. Set the viewBox to this. */
  size: number;
}

/**
 * Past this, the code is too dense for a phone camera at a comfortable distance,
 * so it is drawn with a warning rather than silently.
 */
export const DENSE_CONTENT_CHARS = 700;

/**
 * Past this, the content will not fit a QR code at all (version 40, correction
 * M, byte mode gives 2331 bytes). No code is drawn, because there is none to
 * draw.
 */
export const MAX_CONTENT_CHARS = 2000;

/**
 * Encode a link.
 *
 * Error correction M: the conventional level for something a camera reads off
 * a screen, which may be dimmed or at an angle. Type number 0 picks the
 * smallest version the payload fits in.
 *
 * The library's byte mode is Latin-1, which would mangle a Passage — so only
 * ever hand this a URL here, never the text being dictated. Links are base64url
 * by construction, so they are safe.
 */
export function qrCode(text: string): QrCode {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return {
    count: qr.getModuleCount(),
    isDark: (row, col) => qr.isDark(row, col),
  };
}

/**
 * The code as an SVG path, with the quiet zone folded in.
 *
 * The quiet zone is not decoration: without a margin of light modules around
 * the code, a camera has nothing to find the edges against.
 */
export function qrPath(code: QrCode, quiet = 4): QrPath {
  let d = "";
  for (let row = 0; row < code.count; row++) {
    for (let col = 0; col < code.count; col++) {
      if (code.isDark(row, col)) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  return { d, size: code.count + quiet * 2 };
}
