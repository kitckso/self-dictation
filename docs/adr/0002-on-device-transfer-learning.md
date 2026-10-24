# Custom voice commands are trained on the device

The three things a Run can be told to do — next, repeat, stop — can be said
in the person's own words, in their own language and voice. The app ships with
a small English speech-command model that knows "go", "yes", "no" and "stop";
a person who dictates in Cantonese records a handful of samples of their own
words instead, and a small classifier is trained on the device from those
samples. Nothing about it is uploaded, because there is nowhere to upload it
to.

The training is transfer learning with the TensorFlow.js speech-commands
library: the bundled 18-word model's second-last dense layer (2,000 units)
feeds a new `Dense(4)` softmax head, and only that head is trained. Training
runs 20 epochs with a progress callback and is followed by a one-shot test of
the result. The head is a few thousand weights, about 32 KB, so it is what is
kept: its format version, the base model it was trained against, the classes
it scores, the kernel with its shape, and the bias — along with the names
given to the commands, the sample counts (the room's noise among them) and
whether it is in use. The base model is a few megabytes and ships with the
app, so it is used again rather than stored. The samples are never kept at
all.

Only the head is trained because the base model is what tells a word apart
from the room around it: it has heard thousands of hours of speech and cannot
be improved by six samples from one person, and it is also the part that
would cost the most to keep. The cost of this choice is a head that overfits
easily. Recording a handful of samples in one voice, in one room, on one
device is a much smaller ask than speaking English to a model that has never
heard you, but what comes out of it is narrow. That is why there are
minimums — 4 samples per command and 3 of room noise, with 6 and 4
recommended — why room noise is recorded as a class of its own, and why
improving the commands means training again from scratch rather than adding
to what is already there.

The typed names are labels only. The model's classes stay `next`, `repeat`,
`stop` and `_background_noise_`, so a name is what the app shows and asks
for, while the model only knows the sound that was recorded under it. Renaming
a command is therefore free: only the label is written, the head behind it is
untouched, and nothing is recorded again. Saying a different word means
recording it again.

Cloud speech recognition was rejected: it needs a key, a server and a
network, and it sends the audio away, which is the one thing this app is
built not to do. The browser's own Web Speech API was rejected because it
cannot be given a set of chosen words to recognise, and because it is the
same dependency ADR-0001 already distrusts. Fine-tuning the whole model was
rejected as neither practical in a browser nor worth the storage. Keeping
the recordings was rejected too: they are the most private thing a person
has, they would have to be stored, and a head trained from them can be
thrown away and trained again without them.

A stored head is checked against the base model, the format version, the
classes and their order, and the shape of the weights before it is used. If
it does not match, the app says "your custom commands need to be retrained"
and stops; it does not quietly fall back to the built-in English words,
because that would look like the person's own commands had stopped working.
A profile whose head is missing altogether is treated the same way: the
fallback is never silent. Nor is a "Try again" offered for either of them:
only training again can put them right, and a retry button would be a promise
the app cannot keep. Loading a head never trains on top of one either:
the library does not restore its second-last dense layer when it loads, so
training always starts from a fresh transfer.

The microphone is asked for before the speech model is fetched, so a refusal
is reported as a refusal rather than hidden behind a download, and the
permission prompt does not arrive with the first word already being asked
for. Training captures audio under the same constraints the Run listens with,
so a sample is recorded the way the app will hear it. A head that has just
been trained can be heard out before it is kept, which is the only way to
know whether it works before committing to it. A head that could not be
saved is not put into use: a Run listening for commands the app has not kept
would say the wrong words about them. Training new commands does not switch a
profile back on that the person had switched off, and the dialog says which
of the two has happened rather than claiming the commands are in use.
Before the dialog closes it asks about anything that would be lost — samples
that were never trained, or a name that was typed and never saved — and while
that question is up the rest of the dialog is not live, so nothing behind it
can start a recording or take the commands away. A failure is said in the
question itself, where the person is looking, rather than at the top of a
long dialog they may not be able to see.

The library keeps its word list, its head and its model private, so
`src/voice/head.ts` writes to those fields directly — the one place in the
app that reaches inside a dependency. IndexedDB goes to version 2 for this,
with a store of profiles and a store of heads; a profile and its head are
written and deleted in one transaction, so a store that fills up cannot
leave a profile behind with no head to go with it. One profile serves every
language, and it is used automatically whenever it exists, with a switch in
the dialog to turn it off and put the built-in English words back.
