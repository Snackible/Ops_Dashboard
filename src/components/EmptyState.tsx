import type { ReactNode } from "react";

export function EmptyState({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="font-display text-[15px] text-ink-soft">{title}</p>
      <p className="mt-1 text-[13px] text-ink-faint">{body}</p>
    </div>
  );
}
