import { useState, type ReactNode } from "react";

function wasDismissed(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

/**
 * A slim inline note rather than a toast: it sits in the page flow (no sound,
 * no overlap, no stacking), stays until its × is clicked, and then stays gone
 * across visits so it doesn't turn into something to dismiss every time.
 */
export function DismissibleTip({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(() => wasDismissed(storageKey));
  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      // Storage can be blocked - it just means the tip comes back next visit.
    }
  }

  return (
    <div role="note" className="mb-4 flex items-start gap-2 rounded-md border border-line bg-paper-raised px-3 py-2 text-[12.5px] leading-snug text-ink-soft">
      <span aria-hidden="true" className="mt-px font-mono text-[11px] font-semibold text-accent-ink">
        i
      </span>
      <p className="min-w-0 flex-1">{children}</p>
      <button
        onClick={dismiss}
        className="-my-0.5 shrink-0 rounded px-1.5 text-base leading-none text-ink-faint transition-colors hover:text-ink"
        aria-label="Dismiss tip"
      >
        ×
      </button>
    </div>
  );
}
