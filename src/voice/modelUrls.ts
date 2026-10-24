/**
 * Where the bundled 18-word model lives.
 *
 * The speech-commands loader parses these with a URL parser that accepts only
 * absolute `http:`, `https:` (or Node `file:`) URLs. A root-relative path such
 * as `/models/...` therefore fails at load time even though a browser could
 * fetch it, so resolve them against the page first.
 */
export interface SpeechCommandUrls {
  model: string;
  metadata: string;
}

export function speechCommandUrls(baseUrl: string, documentBase: string): SpeechCommandUrls {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return {
    model: new URL(`${base}models/speech-commands/18w/model.json`, documentBase).href,
    metadata: new URL(`${base}models/speech-commands/18w/metadata.json`, documentBase).href,
  };
}
