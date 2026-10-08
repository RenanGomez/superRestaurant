"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckField } from "../../components/field-hint";
import type { PrintDocument } from "../../lib/print-documents";

export function PrintPreview({ documents, onClose }: { readonly documents: readonly PrintDocument[]; readonly onClose: () => void }) {
  const [narrow, setNarrow] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const controls = [...document.querySelectorAll<HTMLElement>(".print-controls button, .print-controls input")];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    document.getElementById("print-preview-print")?.focus();
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);
  return createPortal(<div className="print-preview-overlay fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="Vista previa de impresión">
    <div className="mx-auto max-w-lg rounded-xl bg-surface p-4">
      <div className="print-controls mb-4 flex flex-wrap gap-2">
        <button id="print-preview-print" type="button" className="min-h-11 rounded-lg bg-accent px-4 text-white focus-visible:outline-2" onClick={() => window.print()}>Imprimir</button>
        <button type="button" className="min-h-11 rounded-lg border px-4 focus-visible:outline-2" onClick={onClose}>Cerrar</button>
        <CheckField className="flex min-h-11 items-center gap-2" hint="Reduce el ancho del ticket en la vista previa para papel angosto de 58 mm." label="Papel 58 mm">{(id) => <input id={id} type="checkbox" checked={narrow} onChange={(event) => setNarrow(event.target.checked)} />}</CheckField>
      </div>
      <div className={`print-documents ${narrow ? "print-documents-58" : ""}`}>
        {documents.map((document, index) => <article key={`${document.title}-${index}`} className="print-document mx-auto mb-4 bg-white p-3 font-mono text-xs leading-relaxed text-black shadow" aria-label={document.title}>
          <h2 className="mb-2 text-center font-bold">{document.title}</h2>
          {document.lines.map((line, lineIndex) => <div key={lineIndex} className="whitespace-pre-wrap break-words">{line || "\u00a0"}</div>)}
        </article>)}
      </div>
    </div>
  </div>, document.body);
}
