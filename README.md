# Self Dictation

Hear it, write it on paper. A dictation practice app for English, Cantonese and
Mandarin that runs entirely on your own device — no account, no server, no API
key, no network calls.

Built for phones and tablets, and usable offline once installed.

## Why it works this way

**Nothing is shown while you answer.** Dictating with the text visible is
copying, not dictation. No Reference appears until the Run is over — the whole
Passage is revealed at once, so nothing you are still working on can leak.

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
npm test               # unit and component tests
```

To use it on a phone, install it as a PWA from your browser's "Add to Home
Screen", or host `dist/` on any static host.

## How a session goes

1. **Setup** — pick a Language, a Mode, and paste your content. Saved material
   is kept in the browser so you can drill it again later. Starting with a
   title that is already saved overwrites that Collection rather than adding a
   duplicate, so re-drilling a sample refreshes it in place. **Share** turns what
   you have set up into a link — and a QR code — to hand to somebody else.
2. **Run** — each Chunk gets its own numbered slot so you can see how much is
   left without seeing a word of it. Listen and write; the app shows nothing to
   check yourself against. Navigation never moves past a Chunk on its own. A Run
   opens by playing the first Chunk once, then waiting. **Auto-play** is a
   separate choice: turn it on and it walks the Run for you. The bottom bar sets
   how many times each Chunk is spoken, how long to pause before the next play
   or repeat, and how fast the Voice speaks — 2 times, 5 seconds, and its
   natural pace to begin with. Speed applies to every play, not just auto-play.
   Changing a setting never interrupts the play under way — it finishes as it
   began — and the change lands on the next play for Speed, on the next Chunk
   for repeats and pause. Auto-play stops when you touch a speech control, move
   the cursor, or reach the end. **Voice commands** listen on every Run: say
   “go” or “yes” to move to the next Chunk and play it, “no” to hear the current
   Chunk again, and “stop” to silence auto-play. A second “stop” within a few
   seconds ends the Run, so a single misheard word cannot end it by itself. The
   microphone is released while the Voice speaks, so the app cannot hear its own
   dictation. The words are English, and the recognition runs on the device.
3. **Results** — every Reference appears at once, beside what you typed and a
   diff of the two, or the ✓ all / ~ some / ✗ wrong buttons for what you wrote
   on paper. The score is the mean of both and settles as you mark.
4. **Progress** — every Run is kept, so **Your progress** can show what you
   have done and, more usefully, which material caught you out. Anything whose
   most recent answer was not right is listed as a Weakness, grouped by
   Language, with how often it went right, half-right and wrong. A Weakness is
   cleared only by getting it right — a partial answer or a skip leaves it
   standing, because neither says the material can be done. Drill them all, or
   draw a random five.

**Paragraph** mode splits on sentence boundaries (`。！？` / `.?!`), falling back
to clause punctuation (`，、；`) for long sentences, capped at 70 characters.
**Vocabulary** mode takes one item per line. The **format** button tidies pasted
text — it trims each line, drops blank lines, and collapses runs of spaces.

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

Everything stays in your browser. Collections, Run history and your Progress
are stored in IndexedDB; nothing is uploaded anywhere, because there is nowhere
to upload it. Clearing site data erases it.

Voice commands are heard by a speech-command model running on the device. The
microphone audio is not recorded and is never sent anywhere.

A shared link carries the dictation itself, deflated and encoded into the part
of the URL after the `#`. That part is never sent to the host — which is why
sharing needs no server, and why the link opens offline. It also means anyone
holding the link holds the text, so send it the way you would send the text.

## Project layout

```
src/
  domain/       types, chunking, grading, progress, share encoding — no React, no browser APIs
  tts/          TtsProvider seam + the Web Speech implementation
  voice/        on-device voice commands + the bundled speech-command model
  storage/      IndexedDB
  screens/      Setup, Run, Results, History, Share
  lib/          small helpers
```

The domain layer is deliberately free of UI and browser concerns, and speech
sits behind `TtsProvider` so a hosted provider can be added later without
touching the screens. The share codec is the one exception: it uses the
platform's own DEFLATE rather than bundling one. QR generation and TensorFlow.js
(for voice commands) are the other runtime dependencies; both are bundled into
the app rather than fetched at run time.

See [GLOSSARY.md](GLOSSARY.md) for the vocabulary this project uses.

## Known limitations

- Cantonese availability is entirely up to the device; see the table above.
- Speed is a request to the device voice, not a promise: some voices clamp it,
  and some ignore it outright, so 75% can sound the same as 100%.
- No spaced repetition yet — your Progress records what went wrong and offers
  it back, but nothing schedules a review or spaces the intervals out.
- Progress is per material, not per Collection: the same sentence in two
  different Passages counts as one item.
- Punctuation, whitespace and English case are ignored when grading. Traditional
  and Simplified Chinese are treated as different characters, so typing 简 into a
  繁 passage counts as wrong.
- Voice commands are English words, need microphone permission and a quiet
  room, and need HTTPS or localhost. Recognition is good, not perfect: a word in
  the room can be heard as a command. The model ships with the app (a few
  megabytes), so it still works offline and no audio is uploaded.

## License

MIT — see [LICENSE](LICENSE).
