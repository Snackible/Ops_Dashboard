const MUTE_KEY = "snackible-ops-sound-muted";
const VOLUME_KEY = "snackible-ops-sound-volume";

export function isSoundMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === "true";
}

export function setSoundMuted(muted: boolean): void {
  localStorage.setItem(MUTE_KEY, String(muted));
}

export function getSoundVolume(): number {
  const raw = localStorage.getItem(VOLUME_KEY);
  const parsed = raw ? Number(raw) : 0.25;
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.25;
}

export function setSoundVolume(volume: number): void {
  localStorage.setItem(VOLUME_KEY, String(Math.min(1, Math.max(0, volume))));
}

let audioCtx: AudioContext | null = null;

/** A short two-note chime, synthesized so no audio asset needs to ship with the app. */
export function playNewRequestChime(): void {
  if (isSoundMuted()) return;
  try {
    audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const volume = getSoundVolume();
    const notes = [660, 880];
    notes.forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = audioCtx!.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  } catch {
    // Audio can fail before a user gesture unlocks the context — a missed
    // chime is fine, the visual popup still carries the notification.
  }
}
