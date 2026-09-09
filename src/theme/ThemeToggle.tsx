import { useTheme } from "./ThemeContext";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Toggle color theme"
      className="rounded-full border border-line bg-paper-raised px-3 py-1.5 font-mono text-[11px] text-ink-soft transition-all hover:text-ink hover:border-ink-faint active:scale-[0.97]"
    >
      {theme === "dark" ? "☀ light" : "☾ dark"}
    </button>
  );
}
