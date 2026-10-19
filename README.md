# Self Dictation

Hear it, write it on paper. A dictation practice app for English, Cantonese and
Mandarin that runs entirely on your own device — no account, no server, no API
key, no network calls.

Built for phones and tablets, and usable offline once installed.

## Why it works this way

**Nothing is shown while you answer.** Dictating with the text visible is
copying, not dictation. The Reference and the Jyutping/Pinyin overlay are both
hidden until you ask to see them.

**Typing is a trap for Chinese.** Typing 今日 through pinyin, Cangjie or any
input method produces the correct characters _without you knowing how to form
them_. The app would then be measuring your input method rather than you, and
reporting a confident, meaningless score. So for Cantonese and Mandarin the
answer is written by hand on paper, and typing has to be chosen deliberately.

English is different — there is no input method between knowing how a word is
spelled and producing it, so typing tests spelling directly. There, typing is
the default and paper is the alternative.

When you do type, a character-by-character diff catches homophone mistakes you
cannot see by re-reading your own work.

**Speech comes from your device.** See [ADR-0001](docs/adr/0001-device-tts.md)
for why, and read the platform notes below — this is the main caveat.

## Running it

Requires Node 22+.

```bash
npm install
npm run dev            # local only
npm run dev -- --host  # reachable from a phone on your network
npm run build
npm run preview
```

To use it on a phone, install it as a PWA from your browser's "Add to Home
Screen", or host `dist/` on any static host.

## How a session goes

1. **Setup** — pick a Language, a Mode, and paste your content. Saved material
   is kept in the browser so you can drill it again later.
2. **Run** — each Chunk gets its own numbered slot so you can see how much is
   left without seeing a word of it. Speak, write, reveal, mark. Navigation
   never moves past a Chunk on its own.
3. **Results** — the whole passage with your answers against the originals.

**Paragraph** mode splits on sentence boundaries (`。！？` / `.?!`), falling back
to clause punctuation (`，、；`) for long sentences, capped at 70 characters.
**Vocabulary** mode takes one item per line.

## Language support depends on your device

This is the honest part. Speech uses the browser's built-in `speechSynthesis`,
which delegates to whatever voices the operating system has installed.

|                      | English         | Mandarin                | Cantonese                    |
| -------------------- | --------------- | ----------------------- | ---------------------------- |
| iOS / iPadOS / macOS | ✅              | ✅                      | ✅ Sinji ships preinstalled  |
| Android              | ✅ if installed | ⚠️ usually preinstalled | ❌ usually **not** installed |
| Windows / Edge       | ✅              | ⚠️ if installed         | ⚠️ if installed              |
| Chrome desktop       | ⚠️ if installed | ⚠️ if installed         | ⚠️ unreliable                |

Use **Test this voice** on the setup screen before committing to a session —
it plays a short sample and tells you honestly whether the browser can speak.

Two known platform quirks are worked around in `src/tts/webSpeech.ts`:

- Chrome silently stops speaking mid-utterance at ~15 seconds and fires **no
  events at all** ([crbug.com/41294170](https://issues.chromium.org/issues/41294170)).
  Short Chunks avoid most of it; there's a watchdog and a pause/resume
  keepalive, the latter disabled on Android because it _breaks_ Android speech.
- Android Chrome reports a voice entry for every locale the platform knows
  about, not the ones installed, and often returns an empty list entirely. So
  the app distinguishes "no voice found" from "this browser can't tell us" and
  never blocks on it.

To install a Cantonese voice on Android:
Settings → System → Languages & input → Text-to-speech output → Google Speech
Services → Install voice data → Cantonese.

## Your data

Everything stays in your browser. Collections and Run history are stored in
IndexedDB; nothing is uploaded anywhere, because there is nowhere to upload it.
Clearing site data erases it.

## Project layout

```
src/
  domain/       types, chunking, grading — no React, no browser APIs
  tts/          TtsProvider seam + the Web Speech implementation
  storage/      IndexedDB
  screens/      Setup, Run, Results
  lib/          small helpers
```

The domain layer is deliberately free of UI and browser concerns, and speech
sits behind `TtsProvider` so a hosted provider can be added later without
touching the screens.

See [GLOSSARY.md](GLOSSARY.md) for the vocabulary this project uses.

## Known limitations

- Cantonese availability is entirely up to the device; see the table above.
- No spaced repetition yet — Runs are recorded, but nothing schedules them.
- Punctuation, whitespace and English case are ignored when grading. Traditional
  and Simplified Chinese are treated as different characters, so typing 简 into a
  繁 passage counts as wrong.

## License

MIT — see [LICENSE](LICENSE).
