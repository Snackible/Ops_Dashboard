import { useEffect, useState } from "react";
import { notificationStore, type Toast } from "../lib/integrations/notificationStore";

const KIND_STYLES: Record<Toast["kind"], string> = {
  info: "border-line bg-paper-raised text-ink",
  success: "border-success bg-success-soft text-success",
  danger: "border-danger bg-danger-soft text-danger",
};

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => notificationStore.subscribe(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`rounded-lg border px-4 py-3 shadow-card ${KIND_STYLES[t.kind]}`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold">{t.title}</p>
            <button
              onClick={() => notificationStore.dismiss(t.id)}
              className="text-ink-faint hover:text-ink"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
          <p className="mt-1 text-[13px] text-ink-soft">{t.body}</p>
        </div>
      ))}
    </div>
  );
}
