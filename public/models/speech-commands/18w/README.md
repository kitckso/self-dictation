# Speech commands model

The 18-word Browser FFT model from
[TensorFlow.js speech-commands](https://github.com/tensorflow/tfjs-models/tree/master/speech-commands),
downloaded from:

```
https://storage.googleapis.com/tfjs-models/tfjs/speech-commands/v0.5/browser_fft/18w/
```

Files: `model.json`, `metadata.json`, and the two weight shards.

It is bundled here rather than fetched at run time so voice commands work
offline and no request leaves the device. The model and the speech-commands
code are licensed under the Apache License 2.0.
