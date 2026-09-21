import type { ToastKind } from "./notificationStore";

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

function playNote(freq: number, start: number, duration: number, volume: number): void {
  const osc = audioCtx!.createOscillator();
  const gain = audioCtx!.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain).connect(audioCtx!.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** One note sequence per toast kind, so a request approval doesn't sound like a decline. */
const CHIME_NOTES: Record<ToastKind, number[]> = {
  info: [660, 880], // neutral two-note "something happened"
  success: [523.25, 659.25, 783.99], // ascending major triad - good news
  danger: [415.3, 293.66], // descending, lower register - bad news
  warning: [587.33, 587.33], // same-note double beep - needs attention
};

/** A short synthesized chime, so no audio asset needs to ship with the app. */
export function playChime(kind: ToastKind): void {
  if (isSoundMuted()) return;
  try {
    audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const volume = getSoundVolume();
    const notes = CHIME_NOTES[kind];
    notes.forEach((freq, i) => playNote(freq, audioCtx!.currentTime + i * 0.13, 0.22, volume));
  } catch {
    // Audio can fail before a user gesture unlocks the context — a missed
    // chime is fine, the visual popup still carries the notification.
  }
}
