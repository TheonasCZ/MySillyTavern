import { useEffect, useId, useRef, useState } from "react";

interface Props {
  text: string;
}

/** Small "i" info icon shown next to a form field label. Opens an
 * explanatory bubble on hover or click/tap (toggle, for touch devices)
 * and closes on Escape or an outside click. Purely presentational — no
 * form state — so it can be dropped into any label without wiring. */
export function FieldHelp({ text }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <span ref={containerRef} className="relative inline-flex" style={{ verticalAlign: "middle" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        aria-label={text}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold leading-none"
        style={{
          backgroundColor: "var(--color-surface-2)",
          color: "var(--color-text-muted)",
          border: "1px solid var(--color-border-strong)",
        }}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          id={tooltipId}
          className="absolute left-1/2 top-full z-50 mt-1.5 w-max max-w-[18rem] -translate-x-1/2 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal"
          style={{
            backgroundColor: "var(--color-surface-2)",
            color: "var(--color-text)",
            borderColor: "var(--color-border-strong)",
            boxShadow: "var(--shadow-panel)",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
