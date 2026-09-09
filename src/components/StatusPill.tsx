import type { RequestStatus } from "../lib/types";

const CONFIG: Record<RequestStatus, { label: string; classes: string }> = {
  pending: { label: "Pending", classes: "bg-warning-soft text-warning" },
  approved_full: { label: "Approved", classes: "bg-success-soft text-success" },
  approved_partial: { label: "Approved — partial", classes: "bg-success-soft text-success" },
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
