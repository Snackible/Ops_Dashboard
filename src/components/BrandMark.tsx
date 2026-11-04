/**
 * The "S" mark as one vector shape, so it stays sharp at any size and sits
 * dead-centre - the old one was a font glyph in a box, which blurred small and
 * shifted with whichever font had loaded. Same path as public/favicon.svg.
 */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" className={`shrink-0 ${className}`}>
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      <path
        d="M41 23.5C41 19.5 37 16 32 16C26.5 16 22.5 19 22.5 23.5C22.5 28 26.5 29.6 32 31C37.5 32.4 41.5 34 41.5 39C41.5 44 37.5 48 32 48C27 48 23.5 45 23 40.5"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
