# Self Dictation

A practice tool for dictating: a passage or vocabulary item is spoken aloud, the
person using it writes down what they hear, and the result is compared against
the authoritative text.

## Language

**Language**:
One of English, Mandarin, or Cantonese. A Passage, Chunk, or Vocabulary Item
belongs to exactly one Language.
_Avoid_: Locale, dialect

**Voice**:
The device's rendering of a Language as speech. A Voice belongs to a Language,
and a Voice is a property of the user's device rather than of this app.
_Avoid_: Speaker, TTS engine, narrator

**Voice Availability**:
Whether the device can speak a Language at all. Cantonese is not guaranteed:
a device may have no Cantonese Voice, in which case Cantonese cannot be
dictated on it.
_Avoid_: Support, compatibility

## Material

**Collection**:
A named, saved group of material that a person can return to and drill again
later. It is the unit of organisation and the unit of persistence.
_Avoid_: Deck, library, book, project

**Passage**:
A block of text in a single Language that can be dictated from start to finish.
A Passage is subdivided into Chunks.
_Avoid_: Paragraph, text, document, article

**Vocabulary Item**:
A short word or phrase in a single Language, drilled on its own rather than in
prose.
_Avoid_: Word, term, flashcard

**Mode**:
One of Paragraph or Vocabulary — which kind of material a Run is made of.
_Avoid_: Drill type, exercise type, category

**Shared Link**:
A URL that carries a Setup — Language, Mode, title and material — so that
whoever opens it arrives at Setup with that dictation ready. The material is
deflated and encoded into the fragment (after the `#`) rather than the query
string, because a query string is sent to the host and would land in its access
logs. Nothing about a Shared Link is uploaded, and anyone holding one holds the
text.
_Avoid_: Invite, permalink, deep link

## A Run

**Run**:
One complete attempt at dictating a Collection's Passage or Vocabulary Items,
from start to finish. A Run belongs to a person, a Mode, and a point in time.
_Avoid_: Session, attempt, exercise, drill, quiz

**Chunk**:
The smallest unit that is spoken in one go. Paragraph Mode dictates a Passage
one Chunk at a time.
_Avoid_: Segment, fragment, line, step, block

**Speed**:
A share of a Voice's natural pace at which a Run is spoken, chosen for the Run
and forgotten when it ends. A play already under way finishes at the Speed it
began with; the next play — a repeat, or the next Chunk — uses the new one. The
device may clamp or ignore it, so a Speed is a request to the Voice rather than
a promise about what will be heard.
_Avoid_: Rate, tempo, playback speed

**Reference**:
The authoritative text for a Chunk or Vocabulary Item. It is never shown
while dictating — a person who can see it does not need to listen.
_Avoid_: Prompt, source, correct answer, ground truth

**Transcript**:
What the person typed in response to a spoken Chunk or Vocabulary Item.

A Transcript is only a valid answer in a Latin Writing System. Typing English
tests spelling directly, because there is nothing between knowing how a word
is spelled and producing it. Typing Chinese does not: an input method turns a
sound into characters without the writer knowing how those characters are
formed, so a Transcript of Chinese measures the input method rather than the
person, and grading it produces a confident and meaningless number. For Cantonese
and Mandarin the answer is written by hand.
_Avoid_: Input, response, answer, submission

**Paper Answer**:
The ordinary way to answer a Cantonese or Mandarin Chunk: write it on paper,
then mark yourself when the Reference is revealed. Never produces a Transcript.
_Avoid_: Handwriting, offline answer, written answer

**Overlay**:
A phonetic support layer — Jyutping for Cantonese, Pinyin for Mandarin — that
would be shown once the Reference is revealed, to help a person read what they
misheard. Not built yet, so the term is held open for it. An Overlay would
never be shown while dictating, because it reveals the answer as effectively as
the Reference does.
_Avoid_: Hint, annotation, furigana, transliteration

**Reveal**:
The moment a Transcript is compared against its Reference and the Reference
becomes visible. Every Reveal in a Run happens at the end of it, on Results,
once the whole Passage has been dictated — a Reveal part-way through would hand
over the rest of the Passage still to come.
_Avoid_: Answering, checking, grading

**Grading**:
The comparison of a Transcript against its Reference, yielding an accuracy
figure and a display of where they differ.
_Avoid_: Scoring, marking, evaluation

**Outcome**:
How one Chunk was answered in a Run. A Transcript is Graded for an accuracy; a
Paper Answer is marked by the person as correct, partial, or wrong. Both end up
as the same kind of answer, which is what lets a Weakness be worked out across
Runs made in either mode.
_Avoid_: Score, grade, result, verdict

**Progress**:
What is known about how a person has done on each piece of material, across
every Run so far. Progress is a property of the material rather than of a Run,
so it outlives the Run that established it.
_Avoid_: Stats, history, record, analytics

**Weakness**:
Material whose most recent answer was not right, and which is therefore worth
practising again. Only a correct answer clears it. A partial answer and
skipping it both leave it standing: neither says the material can be done,
and "not yet right" is what a Weakness is.
_Avoid_: Mistake, error, wrong answer, gap

**Drill**:
A Run made of material that was chosen because it is a Weakness. A Drill begins
at Setup like any other Run, so the material and the Voice are checked before
anything is spoken.
_Avoid_: Review, revision, re-run

**Setup**:
The step before a Run in which a Language, a Mode, and the material are chosen.
Every Run begins at Setup; nothing is chosen mid-Run. A Setup may also arrive
already filled in, from a Shared Link.
_Avoid_: Onboarding, start screen, new run

## Writing Systems

**Writing System**:
The orthography a person is asked to reproduce — Latin orthography for English,
Chinese characters for Cantonese and Mandarin.
_Avoid_: Script, alphabet
