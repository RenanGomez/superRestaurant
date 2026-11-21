"use client";

import { MENU_IMAGE_MAX_DECODED_BYTES } from "@super-restaurant/shared-types";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { shrinkMenuImage } from "../../../lib/menu-image-resize";
import { fitMenuImageWithin, MENU_IMAGE_MAX_SIDE_PX } from "../../../lib/menu-images";
import {
  clampMenuPhotoPan, clampMenuPhotoZoom, MENU_PHOTO_CARD_ASPECT, MENU_PHOTO_MAX_ZOOM, MENU_PHOTO_MIN_ZOOM, MENU_PHOTO_PAN_STEP,
  MENU_PHOTO_ZOOM_STEP, menuPhotoCropRect,
} from "../../../lib/menu-photo-crop";

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = Math.round(PREVIEW_WIDTH / MENU_PHOTO_CARD_ASPECT);
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";

export interface CroppedMenuPhoto {
  readonly blob: Blob;
  readonly contentType: "image/jpeg";
}

/**
 * Modal framing step shown before a menu photo is uploaded. The frame matches the card aspect;
 * zoom and pan are clamped so the crop never shows an empty edge. Confirming returns the JPEG.
 */
export function PhotoCropDialog({ file, label, onCancel, onConfirm }: {
  readonly file: File;
  readonly label: string;
  readonly onCancel: () => void;
  readonly onConfirm: (photo: CroppedMenuPhoto) => void;
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ readonly panX: number; readonly panY: number; readonly pointerId: number; readonly x: number; readonly y: number } | null>(null);
  const active = useRef(true);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(MENU_PHOTO_MIN_ZOOM);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const instructionsId = "photo-crop-instructions";

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    let loaded: ImageBitmap | null = null;
    void createImageBitmap(file).then((decoded) => {
      if (!mounted) { decoded.close(); return; }
      loaded = decoded;
      setBitmap(decoded);
    }).catch(() => { if (mounted) setMessage("No se pudo leer la foto. Elige otra imagen."); });
    return () => {
      mounted = false;
      loaded?.close();
    };
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1 + MENU_PHOTO_ZOOM_STEP : 1 - MENU_PHOTO_ZOOM_STEP;
      setZoom((current) => clampMenuPhotoZoom(current * factor));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || bitmap === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const rect = menuPhotoCropRect({ panX, panY, sourceHeight: bitmap.height, sourceWidth: bitmap.width, zoom });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  }, [bitmap, panX, panY, zoom]);

  const startDrag = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (saving) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { panX, panY, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    // Dragging moves the image, so the visible window travels the other way.
    setPanX(clampMenuPhotoPan(current.panX - ((event.clientX - current.x) / width) * 2));
    setPanY(clampMenuPhotoPan(current.panY - ((event.clientY - current.y) / height) * 2));
  };

  const endDrag = (): void => { drag.current = null; };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    let handled = true;
    switch (event.key) {
      case "+":
      case "=":
        setZoom((current) => clampMenuPhotoZoom(current + MENU_PHOTO_ZOOM_STEP));
        break;
      case "-":
      case "_":
        setZoom((current) => clampMenuPhotoZoom(current - MENU_PHOTO_ZOOM_STEP));
        break;
      case "ArrowLeft":
        setPanX((current) => clampMenuPhotoPan(current - MENU_PHOTO_PAN_STEP));
        break;
      case "ArrowRight":
        setPanX((current) => clampMenuPhotoPan(current + MENU_PHOTO_PAN_STEP));
        break;
      case "ArrowUp":
        setPanY((current) => clampMenuPhotoPan(current - MENU_PHOTO_PAN_STEP));
        break;
      case "ArrowDown":
        setPanY((current) => clampMenuPhotoPan(current + MENU_PHOTO_PAN_STEP));
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };

  const cancel = (): void => {
    active.current = false;
    onCancel();
  };

  const confirm = async (): Promise<void> => {
    if (bitmap === null || saving || !active.current) return;
    setSaving(true);
    setMessage("Preparando la foto…");
    try {
      const rect = menuPhotoCropRect({ panX, panY, sourceHeight: bitmap.height, sourceWidth: bitmap.width, zoom });
      const output = fitMenuImageWithin(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)), MENU_IMAGE_MAX_SIDE_PX);
      const canvas = document.createElement("canvas");
      canvas.width = output.width;
      canvas.height = output.height;
      const context = canvas.getContext("2d");
      if (context === null) { setMessage("Este navegador no pudo recortar la foto."); return; }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, output.width, output.height);
      context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, output.width, output.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!active.current) return;
      if (blob === null || blob.size === 0) { setMessage("Este navegador no pudo recortar la foto."); return; }
      if (blob.size <= MENU_IMAGE_MAX_DECODED_BYTES) {
        onConfirm({ blob, contentType: "image/jpeg" });
        return;
      }
      const shrunk = await shrinkMenuImage(new File([blob], file.name, { lastModified: file.lastModified, type: "image/jpeg" }));
      if (!active.current) return;
      if (shrunk === null) { setMessage("La foto sigue pesando más de 2 MB; elige una imagen más ligera."); return; }
      onConfirm(shrunk);
    } finally {
      setSaving(false);
    }
  };

  const zoomPercent = `${Math.round(zoom * 100)}%`;
  const ready = bitmap !== null;

  return <dialog aria-label={label} onClose={cancel}
    ref={(element) => { if (element !== null && !element.open) element.showModal(); }}
    className="m-auto w-[min(36rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-md">
    <div className="flex max-h-[calc(100vh-2rem)] flex-col gap-3 overflow-y-auto p-4">
      <h2 className="break-words font-heading text-[14px] font-semibold">{label}</h2>
      <canvas ref={canvasRef} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} tabIndex={0}
        role="img" aria-label="Vista previa del encuadre" aria-describedby={instructionsId}
        onKeyDown={onKeyDown} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
        className={`w-full cursor-move touch-none rounded-xl border border-border bg-bg ${FOCUS}`} />
      <p id={instructionsId} className="text-[12px] text-text-muted">
        Arrastra la foto o usa las flechas para moverla; con + y − o con la rueda ajustas el acercamiento.
      </p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={!ready || saving} aria-label="Alejar" onClick={() => setZoom((current) => clampMenuPhotoZoom(current - MENU_PHOTO_ZOOM_STEP))}
          className={`inline-flex size-11 min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface text-[18px] font-bold ${FOCUS}`}>−</button>
        <input type="range" aria-label="Zoom" min={MENU_PHOTO_MIN_ZOOM} max={MENU_PHOTO_MAX_ZOOM} step={0.05} value={zoom}
          disabled={!ready || saving} onChange={(event) => setZoom(clampMenuPhotoZoom(Number(event.target.value)))} className="min-h-11 w-full" />
        <button type="button" disabled={!ready || saving} aria-label="Acercar" onClick={() => setZoom((current) => clampMenuPhotoZoom(current + MENU_PHOTO_ZOOM_STEP))}
          className={`inline-flex size-11 min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface text-[18px] font-bold ${FOCUS}`}>+</button>
        <span aria-live="polite" className="w-12 shrink-0 text-right text-[12px] font-semibold text-text-muted">{zoomPercent}</span>
      </div>
      {message !== null && <p role="status" className="text-[12px] text-text-muted">{message}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={cancel} className={`min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-semibold ${FOCUS}`}>Cancelar</button>
        <button type="button" autoFocus disabled={!ready || saving} onClick={() => { void confirm(); }}
          className={`min-h-11 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover ${FOCUS}`}>
          {saving ? "Preparando…" : "Usar esta foto"}
        </button>
      </div>
    </div>
  </dialog>;
}
