/** Shared helpers for pre-visit intake display and print-to-PDF via window.print(). */

export function painDotClass(scale: number | null | undefined): string {
  const n = Number(scale);
  if (!Number.isFinite(n)) return "bg-slate-400";
  if (n >= 7) return "bg-red-500";
  if (n >= 4) return "bg-amber-500";
  return "bg-green-500";
}

export function intakeFlagPills(flags: unknown): string[] {
  if (Array.isArray(flags)) {
    return flags
      .map((v) => String(v ?? "").trim())
      .filter((v) => v.length > 0);
  }
  if (flags && typeof flags === "object") {
    const entries = Object.entries(flags as Record<string, unknown>);
    return entries
      .filter(([, v]) => Boolean(v))
      .map(([k, v]) => {
        if (typeof v === "boolean") return k.replace(/_/g, " ");
        return `${k.replace(/_/g, " ")}: ${String(v)}`;
      });
  }
  if (typeof flags === "string" && flags.trim()) return [flags.trim()];
  return [];
}

/** Drops case-insensitive "none" entries. */
export function intakeMedicalHistoryPills(flags: unknown): string[] {
  return intakeFlagPills(flags).filter(
    (p) => p.trim().toLowerCase() !== "none",
  );
}

const INTAKE_PRINT_STYLE_ID = "intake-print-dynamic-styles";

/** Injects temporary @media print rules, prints, then removes styles. `printRootId` is the DOM id of the printable root (no `#`). */
export function injectIntakePrintStylesAndPrint(printRootId: string): void {
  const existing = document.getElementById(INTAKE_PRINT_STYLE_ID);
  existing?.remove();

  const escaped = CSS.escape(printRootId);
  const sel = `#${escaped}`;

  const style = document.createElement("style");
  style.id = INTAKE_PRINT_STYLE_ID;
  style.textContent = `
@media print {
  body * {
    visibility: hidden;
  }
  ${sel},
  ${sel} * {
    visibility: visible;
  }
  ${sel} {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    background: #fff;
    max-height: none !important;
    overflow: visible !important;
  }
  .intake-print-toolbar-btn,
  .intake-print-close-btn {
    display: none !important;
  }
  .intake-print-screen-extra {
    display: none !important;
  }
  .intake-print-print-only {
    display: block !important;
  }
  ${sel} .intake-print-field-row {
    break-inside: avoid;
    margin-bottom: 14px;
  }
  ${sel} .intake-print-field-label {
    font-variant: small-caps;
    font-size: 9pt;
    letter-spacing: 0.06em;
    color: #64748b;
    margin-bottom: 4px;
    font-weight: 600;
    text-transform: none;
  }
  ${sel} .intake-print-field-value {
    font-size: 11pt;
    line-height: 1.45;
    color: #0f172a;
  }
  ${sel} .intake-print-doc-title {
    font-size: 14pt;
    margin-bottom: 8px;
    letter-spacing: 0.02em;
  }
  ${sel} .intake-print-meta-line {
    font-size: 11pt;
    margin-bottom: 4px;
  }
  ${sel} .intake-print-confidential-footer {
    margin-top: 28px;
    padding-top: 12px;
    border-top: 1px solid #cbd5e1;
    font-size: 9pt;
    color: #475569;
  }
  @page {
    margin: 0.65in;
  }
}
`;
  document.head.appendChild(style);

  let cleaned = false;
  const removeEl = () => {
    if (cleaned) return;
    cleaned = true;
    document.getElementById(INTAKE_PRINT_STYLE_ID)?.remove();
    window.removeEventListener("afterprint", onAfterPrint);
    window.clearTimeout(fallbackTimer);
  };

  function onAfterPrint() {
    removeEl();
  }

  const fallbackTimer = window.setTimeout(removeEl, 8000);

  window.addEventListener("afterprint", onAfterPrint);
  window.print();
}
