// The audio unlock (PROTOTYPE-PLAN "Audio", K3). It runs inside the tap handler and ships in the entry chunk, so it
// imports nothing. WebKit starts a context only from a user gesture: the resume() and a start() have to happen in
// the handler itself, before any await. One context serves the app: each holds an output stream and a render thread.

let cached: AudioContext | null = null;

/**
 * The app's one `AudioContext`, created on the first call (a closed one is replaced). Every call resumes it and plays
 * a 1-sample silent buffer, so each gesture is an unlock attempt: a context that stays suspended starts on the next
 * tap (F1 step 6). Call it synchronously inside the tap handler; `createAudioManager` takes the context it returns.
 */
export function unlockAudio(): AudioContext {
  if (cached === null || cached.state === 'closed') {
    cached = new AudioContext();
  }
  const ctx = cached;
  // A refusal is no error here: the manager's resume() and its needs-gesture state report a context that stays off.
  void ctx.resume().catch(() => undefined);
  const primer = ctx.createBufferSource();
  primer.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  primer.connect(ctx.destination);
  primer.onended = () => primer.disconnect();
  primer.start(0);
  return ctx;
}
