/**
 * Capture ElevenLabs ConvAI audio element MediaStream without double-playing.
 * Patches window.Audio before Conversation.startSession, then mutes the EL
 * element so TalkingAvatar (or our portrait analyser) owns playback.
 */
export function createAudioTap() {
  const Orig = window.Audio;
  let captured: HTMLAudioElement | null = null;
  let restored = false;

  (window as unknown as { Audio: typeof Audio }).Audio = function (
    ...args: ConstructorParameters<typeof Audio>
  ) {
    const el = new Orig(...args);
    captured = el;
    return el;
  } as unknown as typeof Audio;

  return {
    waitForStream(timeoutMs = 15000): Promise<MediaStream> {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const iv = setInterval(() => {
          const el = captured;
          if (el?.srcObject instanceof MediaStream) {
            clearInterval(iv);
            restore();
            // Mute EL element; avatar/portrait will play the tapped stream.
            el.muted = true;
            el.volume = 0;
            resolve(el.srcObject);
          } else if (Date.now() - start > timeoutMs) {
            clearInterval(iv);
            restore();
            reject(new Error("Timed out waiting for ElevenLabs audio stream"));
          }
        }, 50);
      });
    },
    restore,
  };

  function restore() {
    if (restored) return;
    restored = true;
    (window as unknown as { Audio: typeof Audio }).Audio = Orig;
  }
}
