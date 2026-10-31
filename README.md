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

**Your own commands are learned on the device.** You can teach the app two
words of your own instead of the built-in English ones. They are trained
here, in your own voice, and nothing is uploaded. See
[ADR-0002](docs/adr/0002-on-device-transfer-learning.md) for how, and for
what that costs.

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
   the cursor, or reach the end. **Voice commands** listen on every Run: by
   default say “go” or “yes” to move to the next Chunk and play it, and “no” to
   hear the current Chunk again. Saying the next word on the last Chunk ends the
   Run. The microphone is released while the Voice speaks, so the app cannot
   hear its own dictation. Those words — “go”, “yes” and “no” — are English, and
   the recognition runs on the device. You can train your own words instead —
   see [Your own voice commands](#your-own-voice-commands) — and the hint then
   names the words you chose rather than “go”.
3. **Results** — every Reference appears at once, beside what you typed and a
   diff of the two, or the ✓ all / ~ some / ✗ wrong buttons for what you wrote
   on paper. The score is the mean of both and settles as you mark.
4. **Progress** — a Run is kept once something in it has been answered — typed
   or marked — so **Your progress** can show what you have done and, more
   usefully, which material caught you out. A Run you finish without answering
   anything is not kept: nothing in it says how you did. Anything whose most
   recent answer was not right is listed as a Weakness, grouped by Language,
   with how often it went right, half-right and wrong. A Weakness is cleared
   only by getting it right — a partial answer or a skip leaves it standing,
   because neither says the material can be done. Drill them all, draw a
   random five, or copy them to the clipboard — one item per line.

**Paragraph** mode splits on sentence boundaries (`。！？` / `.?!`), falling back
to clause punctuation (`，、；`) for long sentences, capped at 70 characters.
**Vocabulary** mode takes one item per line. The **format** button tidies pasted
text — it trims each line, drops blank lines, and collapses runs of spaces.

## Your own voice commands

The built-in words are English, and a Run listens for them until you teach it
otherwise. You can train two commands of your own instead — next and repeat —
in whatever words you actually say.

**Voice commands**, on the Setup screen, opens a dialog that asks for a name for
each of the two commands, for samples of them, and for the microphone. It
records 6 samples of each command and 4 of the room’s noise — 4 and 3 are the
minimum it will train on — and each sample is one short recording you can take
back and redo if it came out badly. The recording carries on by itself, so one
tap is enough: it takes the commands in turn until each has its samples, and
then the room. Then it trains, for 20 epochs, with a progress bar, and runs one
test on what it heard, so you can see whether it picked up your words. **Try it
out** says a word and tells you what the app heard — with the head you have
just trained, before you keep it, so you can hear whether it works before you
commit to it. Training needs the microphone, so the app has to be on HTTPS or
localhost.

Once a profile exists it is used straight away; the dialog has a switch that
turns it off, and turning it off puts the built-in English words back. The
names you give the commands are labels only — the app still hears “next” and
“repeat” — so you can change what you call a command on its own,
with **Save the names**, and nothing is recorded again. A name you have typed
but not saved is asked about before the dialog closes, so it cannot vanish
without you being told; if keeping the names then fails, the question says so
where you are looking, rather than leaving you to find out why nothing
happened. While that question is up the rest of the dialog waits: nothing
behind it can be used, so a recording cannot start behind your back. Changing the words you actually say means recording them again:
**Record new ones** does that, and the commands you have now keep working
until the new ones are trained and saved. **Delete these commands** throws
them away and puts the built-in words back. Training new commands does not
switch a profile back on if you had turned it off.

Two honest caveats. The head is trained from your voice in the room you were
in, so it is at its best there and worse elsewhere. And it stays in the
browser it was trained in, so it does not travel to another device.

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

Training your own commands adds one more thing to the store: the trained
head — a few tens of kilobytes of weights — and the names you gave the
commands. The samples used to train it are not kept, so the audio never
leaves the device and never sits in the browser either.

A shared link carries the dictation itself, deflated and encoded into the part
of the URL after the `#`. That part is never sent to the host — which is why
sharing needs no server, and why the link opens offline. It also means anyone
holding the link holds the text, so send it the way you would send the text.

## Project layout

```
src/
  domain/       types, chunking, grading, progress, share encoding — no React, no browser APIs
  tts/          TtsProvider seam + the Web Speech implementation
  voice/        on-device voice commands, the bundled model, the trained head
  storage/      IndexedDB
  screens/      Setup, Run, Results, History, Share, VoiceCommands
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
- Voice commands need microphone permission and a quiet room, and need HTTPS
  or localhost. The built-in words are English, so they are a poor fit for
  dictating in Cantonese or Mandarin; recognition is good, not perfect, and a
  word in the room can be heard as a command. The model ships with the app (a
  few megabytes), so it still works offline and no audio is uploaded.
- A custom head is trained from one voice, in one room, on one device, so it
  hears you and little else. It needs at least 4 samples per command and 3
  of room noise before it can be trained — 6 and 4 are recommended — and it
  is not carried to another device.
- Improving custom commands means training them again from scratch: samples
  cannot be added to a head that already exists, and renaming a command does
  not need a retrain but saying a different word does. A head that no longer
  matches the app's model has to be retrained too, and the app says so
  rather than quietly going back to the built-in words — and it does not offer
  you a “Try again”, because trying again would not help.

## License

MIT — see [LICENSE](LICENSE).
