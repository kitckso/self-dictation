import { grade } from "../domain/grading";

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

/**
 * The Reference with the Transcript's characters marked up: hits plain, misses
 * and extras highlighted. A blank Transcript leaves the Reference untouched.
 */
export function diffHtml(reference: string, transcript: string): string {
  if (!transcript.trim()) return escapeHtml(reference);
  return grade(reference, transcript)
    .parts.map((p) => `<span class="tok ${p.kind}">${escapeHtml(p.char)}</span>`)
    .join("");
}
