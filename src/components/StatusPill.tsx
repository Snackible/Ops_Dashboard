import type { RequestStatus } from "../lib/types";

const CONFIG: Record<RequestStatus, { label: string; classes: string }> = {
  draft: { label: "Draft", classes: "bg-paper text-ink-soft" },
  pending: { label: "Pending", classes: "bg-warning-soft text-warning" },
  approved: { label: "Approved", classes: "bg-success-soft text-success" },
  declined: { label: "Declined", classes: "bg-danger-soft text-danger" },
};

export function StatusPill({ status }: { status: RequestStatus }) {
  const { label, classes } = CONFIG[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[11px] font-medium ${classes}`}>
      {label}
    </span>
  );
}
