"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { BranchScope, DeliveryZoneV1, UpsertDeliveryZoneCommandV1 } from "@super-restaurant/shared-types";
import { CheckField, Field } from "../../../components/field-hint";
import { captureDeviceId } from "../../../lib/capture-workspace";
import { canonicalizeLocalities, canonicalizePostalCodes, parseDeliveryFeeMinor } from "../../../lib/delivery-zones";
import type { DeliveryActionResult } from "./actions";
import { uiButton } from "../../../lib/ui-classes";

const panel = "rounded-xl border border-border bg-surface p-4 sm:p-5";
const button = uiButton();
const input = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const errors = { invalid: "Revisa los datos de la zona.", denied: "Tu sesión o rol ya no permite administrar zonas.",
  missing: "La zona ya no existe.", conflict: "La zona cambió en otro dispositivo. Actualiza la lista antes de guardar.",
  unavailable: "No se pudo confirmar el resultado. Se reintentará el mismo comando." } as const;

interface Props { readonly scope: BranchScope; readonly currency: string;
  readonly action: (operation: "list" | "upsert" | "quote", input: unknown) => Promise<DeliveryActionResult>; }

export function DeliveryZonesEditor({ scope, currency, action }: Props) {
  const [deviceId] = useState(() => captureDeviceId(typeof window === "undefined" ? undefined : window.localStorage,
    () => crypto.randomUUID()));
  const [zones, setZones] = useState<readonly DeliveryZoneV1[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<keyof typeof errors>();
  const [pending, setPending] = useState<UpsertDeliveryZoneCommandV1>();
  const [editing, setEditing] = useState<DeliveryZoneV1>();
  const [name, setName] = useState("");
  const [postalCodes, setPostalCodes] = useState("");
  const [localities, setLocalities] = useState("");
  const [fee, setFee] = useState("");
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState("");
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  async function refresh() {
    setBusy(true); setError(undefined);
    try {
      const result = await action("list", { schemaVersion: 1, scope: { kind: "branch", ...scope } });
      if (!result.ok) setError(result.error);
      else if ("zones" in result.value) { setZones(result.value.zones); setLoaded(true); }
      else setError("unavailable");
    } catch { setError("unavailable"); }
    setBusy(false);
  }

  useEffect(() => { void refresh(); }, []);

  function select(zone?: DeliveryZoneV1) {
    setEditing(zone); setName(zone?.name ?? ""); setPostalCodes(zone?.postalCodes.join(", ") ?? "");
    setLocalities(zone?.localities.join(", ") ?? ""); setFee(zone === undefined ? "" : (zone.feeMinor / 100).toFixed(2));
    setActive(zone?.active ?? true); setReason(""); setConfirmDeactivate(false); setError(undefined);
  }

  async function save(command: UpsertDeliveryZoneCommandV1) {
    setBusy(true); setError(undefined);
    try {
      let result: DeliveryActionResult;
      try { result = await action("upsert", command); }
      catch { result = { ok: false, error: "unavailable", command }; }
      if (!result.ok) {
        setError(result.error);
        if (result.error === "unavailable") {
          const retry = result.command ?? command;
          setPending(retry);
          // An uncertain transport result is replayed exactly once with the same idempotency key.
          let replay: DeliveryActionResult;
          try { replay = await action("upsert", retry); }
          catch { replay = { ok: false, error: "unavailable", command: retry }; }
          if (!replay.ok) { setError(replay.error); setPending(replay.error === "unavailable" ? replay.command ?? retry : undefined); }
          else if ("zone" in replay.value) { const saved = replay.value.zone; setZones((current) => [...current.filter((zone) => zone.zoneId !== saved.zoneId), saved]
            .sort((a, b) => a.zoneId < b.zoneId ? -1 : 1)); setPending(undefined); select(); }
        } else setPending(undefined);
      } else if ("zone" in result.value) {
        const saved = result.value.zone; setZones((current) => [...current.filter((zone) => zone.zoneId !== saved.zoneId), saved]
          .sort((a, b) => a.zoneId < b.zoneId ? -1 : 1));
        setPending(undefined); select();
      }
    } catch { setError("unavailable"); setPending(command); }
    setBusy(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const postal = canonicalizePostalCodes(postalCodes);
    const places = canonicalizeLocalities(localities);
    const feeMinor = parseDeliveryFeeMinor(fee);
    if (name.trim().length === 0 || name.trim().length > 80 || (postal.length === 0 && places.length === 0)
      || (postalCodes.trim() !== "" && postal.length === 0) || (localities.trim() !== "" && places.length === 0)
      || feeMinor === undefined || (!active && (reason.trim().length === 0 || !confirmDeactivate))) {
      setError("invalid"); return;
    }
    void save({ schemaVersion: 1, scope, zoneId: editing?.zoneId ?? crypto.randomUUID(), expectedVersion: editing?.version ?? 0,
      name: name.trim(), postalCodes: postal, localities: places, feeMinor, currency, active,
      eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), deviceId, occurredAt: new Date().toISOString(),
      reason: active ? null : reason.trim() });
  }

  return <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,1fr)]">
    <section className={panel}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-heading text-lg font-semibold">Zonas</h2>
      <button type="button" className={button} disabled={busy} onClick={() => void refresh()}>Actualizar</button></div>
      {!loaded ? <p className="mt-3 text-sm text-text-muted">Cargando zonas…</p> : zones.length === 0
        ? <p className="mt-3 text-sm text-text-muted">Todavía no hay zonas en esta sucursal.</p>
        : <ul className="mt-3 grid gap-2">{zones.map((zone) => <li key={zone.zoneId}>
          <button type="button" className={`${button} w-full text-left`} onClick={() => select(zone)} disabled={busy}>
            <strong className="block">{zone.name} · {zone.active ? "Activa" : "Inactiva"}</strong>
            <span className="block text-sm">{new Intl.NumberFormat("es-MX", { style: "currency", currency: zone.currency }).format(zone.feeMinor / 100)} · versión {zone.version}</span>
            <span className="block text-xs text-text-muted">CP: {zone.postalCodes.join(", ") || "—"} · Localidades: {zone.localities.join(", ") || "—"}</span>
          </button></li>)}</ul>}</section>
    <section className={panel}><h2 className="font-heading text-lg font-semibold">{editing ? "Editar zona" : "Nueva zona"}</h2>
      {error && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">{errors[error]}</p>}
      {pending && <button type="button" className={`${button} mt-3`} disabled={busy} onClick={() => void save(pending)}>Reintentar mismo comando</button>}
      <form onSubmit={submit} className="mt-4 grid gap-3">
        <Field className="grid gap-1 text-sm" hint="Nombre de la zona de entrega, por ejemplo Centro o Zona norte." label="Nombre">{(id) => <><input id={id} className={input} value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} /></>}</Field>
        <Field className="grid gap-1 text-sm" hint="Códigos postales que cubre esta zona. Una dirección con alguno de ellos recibe la tarifa de la zona." label="Códigos postales, separados por coma o línea">{(id) => <><textarea id={id} className={`${input} min-h-24`} value={postalCodes} onChange={(event) => setPostalCodes(event.target.value)} /></>}</Field>
        <Field className="grid gap-1 text-sm" hint="Ciudades, municipios o colonias que cubre la zona, para direcciones sin código postal conocido." label="Localidades, separadas por coma o línea">{(id) => <><textarea id={id} className={`${input} min-h-24`} value={localities} onChange={(event) => setLocalities(event.target.value)} /></>}</Field>
        <Field className="grid gap-1 text-sm" hint="Costo de envío que se cobra por entregar en esta zona, en la moneda del restaurante. 0 si el envío es gratis." label={`Tarifa (${currency})`}>{(id) => <><input id={id} className={input} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={fee} required onChange={(event) => setFee(event.target.value)} /></>}</Field>
        <CheckField className="flex min-h-11 items-center gap-2 text-sm" labelClassName="flex min-h-11 items-center" hint="Una zona inactiva deja de ofrecerse al capturar entregas, pero conserva su historial." label="Zona activa">{(id) => <input id={id} type="checkbox" className="h-5 w-5" checked={active} onChange={(event) => { setActive(event.target.checked); setConfirmDeactivate(false); }} />}</CheckField>
        {!active && <><Field className="grid gap-1 text-sm" hint="Por qué se desactiva la zona; queda registrado en la auditoría." label="Motivo de desactivación">{(id) => <><textarea id={id} className={`${input} min-h-24`} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} /></>}</Field>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={confirmDeactivate} onChange={(event) => setConfirmDeactivate(event.target.checked)} />Confirmo la desactivación de esta zona</label></>}
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy}>Guardar zona</button>
          {editing && <button type="button" className={button} onClick={() => select()} disabled={busy}>Nueva zona</button>}</div>
      </form></section>
  </div>;
}
