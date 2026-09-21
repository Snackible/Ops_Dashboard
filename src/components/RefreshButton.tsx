import { useState } from "react";
import { Spinner } from "./Spinner";

/**
 * Pages that poll now do so on a much longer interval (see sheetsPolling.ts
 * and each page's own refresh effect) to stay under the Sheets API's
 * per-minute read quota - this gives people a way to pull the latest data
 * on demand instead of waiting out the interval.
 */
export function RefreshButton({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const [spinning, setSpinning] = useState(false);

  async function handleClick() {
    setSpinning(true);
    try {
      await onRefresh();
    } finally {
      setSpinning(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={spinning}
      title="Refresh"
      aria-label="Refresh"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-ink-soft transition-colors hover:border-ink-faint hover:text-ink hover:bg-paper-raised disabled:opacity-60"
    >
      {spinning ? (
        <Spinner className="h-3.5 w-3.5" />
      ) : (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M4 4v5h5M20 20v-5h-5M4.5 15a8 8 0 0014.9 3M19.5 9A8 8 0 004.6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
