# Speech comes from the device, not a cloud API

The app is frontend-only with no server, no account and no billing, so speech
comes from the browser's own `speechSynthesis`. This was chosen over better
cloud voices deliberately, and it costs us quality.

Cloud TTS was surveyed and rejected. Azure and Google Cloud both speak
Cantonese well and both have free tiers, but both require a payment method on
file before the free tier can be used, and both need a server-side proxy to
call from a browser. OpenRouter, Groq, Cloudflare Workers AI, StreamElements
and Google Translate TTS were all checked: none offers Cantonese from a browser
without a key. There is no Cantonese model small enough to run in-browser
either — Piper and Kokoro have no Cantonese voice at all.

The accepted consequence is that **Cantonese depends on the device**. iOS,
iPadOS and macOS ship a Cantonese voice (Sinji) so it works there out of the
box. Android Chrome may or may not have one, and reports language codes rather
than installed voices, so availability cannot be reliably detected — the app
says "voice available" or "no voice detected" honestly and lets the user try.

Everything sits behind `TtsProvider` (`src/tts/TtsProvider.ts`) so a hosted
provider can be added later without touching the screens. Two further reasons
to keep that seam: Web Speech is documented by Google with no guarantee of
stability across browsers, and it has concrete failure modes we already work
around (Chrome silently stopping at ~15s with no events; `boundary` never
firing for network voices; iOS requiring speech to start inside a user tap).
