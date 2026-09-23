import type { SelectHTMLAttributes } from "react";

/**
 * A plain <select> relies on the browser's own arrow glyph, which some
 * renderers draw flush against the text with no reserved gap (looks like a
 * stray checkmark jammed into the label, worse the narrower the box gets on
 * mobile). appearance-none removes that native arrow so this one - with its
 * own reserved padding - is what actually renders, consistently everywhere.
 */
export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`relative ${className}`}>
      <select
        {...props}
        className="w-full appearance-none rounded-md border border-line bg-paper-raised py-2 pl-3 pr-8 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
      >
        <path d="M5.5 7.5L10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
