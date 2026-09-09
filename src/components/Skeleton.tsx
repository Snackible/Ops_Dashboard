export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`skeleton h-4 ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-line bg-paper-raised p-4">
      <SkeletonLine className="w-20" />
      <SkeletonLine className="mt-2 h-5 w-3/4" />
      <SkeletonLine className="mt-3 w-1/2" />
      <SkeletonLine className="mt-4 h-8 w-28" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="rounded-lg border border-line bg-paper-raised p-4">
      <div className="flex items-center justify-between">
        <SkeletonLine className="w-40" />
        <SkeletonLine className="w-20" />
      </div>
      <SkeletonLine className="mt-3 w-full" />
    </div>
  );
}
