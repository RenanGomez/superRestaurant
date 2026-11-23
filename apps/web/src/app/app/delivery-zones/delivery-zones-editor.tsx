"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import type { BranchScope, DeliveryZoneV1, SettlementSummaryV1, UpsertDeliveryZoneCommandV1 } from "@super-restaurant/shared-types";
import { CheckField, Field } from "../../../components/field-hint";
import { captureDeviceId } from "../../../lib/capture-workspace";
import { canonicalizeLocalities, canonicalizePostalCodes, mergeSettlementChoices, parseDeliveryFeeMinor,
  removeSettlementChoice, settlementClaimConflicts, settlementIdsOf, type SettlementChoiceV1 } from "../../../lib/delivery-zones";
import type { DeliveryActionResult } from "./actions";
import { searchSettlements } from "../settlement-search-action";
import { uiButton } from "../../../lib/ui-classes";

const panel = "rounded-xl border border-border bg-surface p-4 sm:p-5";
const button = uiButton();
const input = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const errors = { invalid: "Revisa los datos de la zona.", denied: "Tu sesión o rol ya no permite administrar zonas.",
  missing: "La zona ya no existe.", conflict: "La zona o una colonia cambió en otro dispositivo. Actualiza la lista antes de guardar.",
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
  const [chosen, setChosen] = useState<readonly SettlementChoiceV1[]>([]);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<readonly SettlementSummaryV1[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string>();
  const [postalBatch, setPostalBatch] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string>();
  const [fee, setFee] = useState("");
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState("");
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const optionsId = useId();
  const deliveryScope = useMemo(() => ({ restaurantId: scope.restaurantId, branchId: scope.branchId }),
    [scope.restaurantId, scope.branchId]);

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

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) { setOptions([]); setSearching(false); setSearchMessage(undefined); return; }
    let cancelled = false;
    setSearching(true); setSearchMessage(undefined);
    const timeout = window.setTimeout(() => {
      void searchSettlements({ schemaVersion: 1, scope: deliveryScope, query: text, postalCode: null, limit: 20 })
        .then((reply) => {
          if (cancelled) return;
          if (!reply.ok) {
            setOptions([]);
            setSearchMessage(reply.error === "denied" ? "Tu sesión ya no permite buscar colonias." : "No se pudo buscar colonias. Reintenta.");
            return;
          }
          setOptions(reply.value.settlements);
        })
        .catch(() => { if (!cancelled) { setOptions([]); setSearchMessage("No se pudo buscar colonias. Reintenta."); } })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [deliveryScope, query]);

  function select(zone?: DeliveryZoneV1) {
    setEditing(zone); setName(zone?.name ?? ""); setPostalCodes(zone?.postalCodes.join(", ") ?? "");
    setLocalities(zone?.localities.join(", ") ?? ""); setFee(zone === undefined ? "" : (zone.feeMinor / 100).toFixed(2));
    setChosen((zone?.settlementIds ?? []).map((settlementId) => ({ settlementId, name: `Colonia ${settlementId.slice(0, 8)}`, postalCode: "" })));
    setQuery(""); setOptions([]); setSearching(false); setSearchMessage(undefined);
    setPostalBatch(""); setBatchBusy(false); setBatchMessage(undefined);
    setActive(zone?.active ?? true); setReason(""); setConfirmDeactivate(false); setError(undefined);
  }

  function toggleSettlement(settlement: SettlementSummaryV1): void {
    setChosen((current) => current.some((choice) => choice.settlementId === settlement.settlementId)
      ? removeSettlementChoice(current, settlement.settlementId)
      : mergeSettlementChoices(current, [settlement]));
  }

  async function addPostalCodeSettlements(): Promise<void> {
    const postal = postalBatch.trim();
    if (!/^[0-9]{5}$/u.test(postal)) { setBatchMessage("Escribe un código postal de 5 dígitos."); return; }
    setBatchBusy(true); setBatchMessage(undefined);
    try {
      const reply = await searchSettlements({ schemaVersion: 1, scope: deliveryScope, query: null, postalCode: postal, limit: 50 });
      if (!reply.ok) {
        setBatchMessage(reply.error === "denied" ? "Tu sesión ya no permite buscar colonias." : "No se pudo leer el código postal. Reintenta.");
        return;
      }
      if (reply.value.settlements.length === 0) { setBatchMessage(`No hay colonias registradas para el CP ${postal}.`); return; }
      setChosen((current) => mergeSettlementChoices(current, reply.value.settlements));
      setBatchMessage(reply.value.settlements.length >= 50
        ? `Se agregaron 50 colonias del CP ${postal}; puede haber más, búscalas por nombre.`
        : `Se agregaron ${reply.value.settlements.length} colonias del CP ${postal}.`);
    } catch { setBatchMessage("No se pudo leer el código postal. Reintenta."); }
    finally { setBatchBusy(false); }
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
    const settlementIds = settlementIdsOf(chosen);
    // Choosing colonias converts a legacy postal-code zone; an already-settled zone keeps its legacy fields.
    const converting = settlementIds.length > 0 && (editing === undefined || editing.settlementIds.length === 0);
    const postal = converting ? [] : canonicalizePostalCodes(postalCodes);
    const places = converting ? [] : canonicalizeLocalities(localities);
    const feeMinor = parseDeliveryFeeMinor(fee);
    if (name.trim().length === 0 || name.trim().length > 80 || (postal.length === 0 && settlementIds.length === 0)
      || (!converting && postalCodes.trim() !== "" && postal.length === 0)
      || (!converting && localities.trim() !== "" && places.length === 0)
      || conflicts.length > 0 || feeMinor === undefined || (!active && (reason.trim().length === 0 || !confirmDeactivate))) {
      setError("invalid"); return;
    }
    void save({ schemaVersion: 1, scope, zoneId: editing?.zoneId ?? crypto.randomUUID(), expectedVersion: editing?.version ?? 0,
      name: name.trim(), postalCodes: postal, localities: places, settlementIds, feeMinor, currency, active,
      eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), deviceId, occurredAt: new Date().toISOString(),
      reason: active ? null : reason.trim() });
  }

  const chosenIds = settlementIdsOf(chosen);
  const conflicts = settlementClaimConflicts(chosenIds, zones, editing?.zoneId);
  const legacyPostalCoverage = editing !== undefined && editing.settlementIds.length === 0
    && editing.postalCodes.length > 0 && chosen.length === 0;

  return <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,1fr)]">
    <section className={panel}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-heading text-lg font-semibold">Zonas</h2>
      <button type="button" className={button} disabled={busy} onClick={() => void refresh()}>Actualizar</button></div>
      {!loaded ? <p className="mt-3 text-sm text-text-muted">Cargando zonas…</p> : zones.length === 0
        ? <p className="mt-3 text-sm text-text-muted">Todavía no hay zonas en esta sucursal.</p>
        : <ul className="mt-3 grid gap-2">{zones.map((zone) => <li key={zone.zoneId}>
          <button type="button" className={`${button} w-full text-left`} onClick={() => select(zone)} disabled={busy}>
            <strong className="block">{zone.name} · {zone.active ? "Activa" : "Inactiva"}</strong>
            <span className="block text-sm">{new Intl.NumberFormat("es-MX", { style: "currency", currency: zone.currency }).format(zone.feeMinor / 100)} · versión {zone.version}</span>
            <span className="block text-xs text-text-muted">{zone.settlementIds.length > 0
              ? `${zone.settlementIds.length} colonia${zone.settlementIds.length === 1 ? "" : "s"}${zone.postalCodes.length > 0 ? ` · CP heredado: ${zone.postalCodes.join(", ")}` : ""}`
              : `CP: ${zone.postalCodes.join(", ") || "—"} · Localidades: ${zone.localities.join(", ") || "—"}`}</span>
          </button></li>)}</ul>}</section>
    <section className={panel}><h2 className="font-heading text-lg font-semibold">{editing ? "Editar zona" : "Nueva zona"}</h2>
      {error && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">{errors[error]}</p>}
      {pending && <button type="button" className={`${button} mt-3`} disabled={busy} onClick={() => void save(pending)}>Reintentar mismo comando</button>}
      <form onSubmit={submit} className="mt-4 grid gap-3">
        <Field className="grid gap-1 text-sm" hint="Nombre de la zona de entrega, por ejemplo Centro o Zona norte." label="Nombre">{(id) => <><input id={id} className={input} value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} /></>}</Field>
        <div className="grid gap-2">
          <label htmlFor={`${optionsId}-query`} className="text-sm font-semibold">Colonias cubiertas</label>
          <p className="text-xs text-text-muted">Busca por nombre y agrega colonias. Los chips son exactamente las colonias que se guardan.</p>
          <input id={`${optionsId}-query`} className={input} type="search"
            autoComplete="off" placeholder="Escribe el nombre de la colonia" value={query}
            onChange={(event) => setQuery(event.target.value)} />
          {searching && <p role="status" className="text-sm text-text-muted">Buscando colonias…</p>}
          {searchMessage !== undefined && <p role="alert" className="rounded-lg bg-error-bg p-2 text-sm">{searchMessage}</p>}
          {!searching && searchMessage === undefined && query.trim().length >= 2 && options.length === 0
            && <p role="status" className="text-sm text-text-muted">No hay colonias con ese prefijo.</p>}
          {options.length > 0 && <ul id={optionsId} className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-border p-1">
            {options.map((settlement) => { const picked = chosenIds.includes(settlement.settlementId);
              return <li key={settlement.settlementId}><button type="button" aria-pressed={picked}
                className={`${button} w-full text-left`} onClick={() => toggleSettlement(settlement)}>
                <span className="block text-sm font-semibold">{settlement.name} · {settlement.postalCode}</span>
                <span className="block text-xs text-text-muted">{settlement.settlementType} · {settlement.municipality}, {settlement.state} · {picked ? "Quitar" : "Agregar"}</span>
              </button></li>; })}
          </ul>}
          {chosen.length > 0 && <ul aria-label="Colonias seleccionadas" className="flex flex-wrap gap-2">
            {chosen.map((choice) => <li key={choice.settlementId}>
              <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-bg px-3 text-sm"
                aria-label={`Quitar colonia ${choice.name}`} title={choice.settlementId} onClick={() => setChosen((current) => removeSettlementChoice(current, choice.settlementId))}>
                {choice.name}{choice.postalCode === "" ? "" : ` · ${choice.postalCode}`}<span aria-hidden="true">×</span>
              </button></li>)}
          </ul>}
          {chosen.some((choice) => choice.postalCode === "") && <p className="text-xs text-text-muted">Las colonias ya guardadas se muestran por identificador; quítalas o búscalas por nombre para reemplazarlas.</p>}
          <div className="flex flex-wrap items-end gap-2">
            <Field className="grid flex-1 basis-40 gap-1 text-sm" hint="Agrega todas las colonias registradas en un código postal." label="Todas las de un CP">{(id) => <><input id={id} className={input} inputMode="numeric" maxLength={5} pattern="[0-9]{5}" placeholder="85800" value={postalBatch} onChange={(event) => setPostalBatch(event.target.value)} /></>}</Field>
            <button type="button" className={button} disabled={batchBusy || busy} onClick={() => void addPostalCodeSettlements()}>{batchBusy ? "Buscando…" : "Agregar todas del CP"}</button>
          </div>
          {batchMessage !== undefined && <p role="status" className="text-sm text-text-muted">{batchMessage}</p>}
          {conflicts.length > 0 && <div role="alert" className="rounded-lg border border-error bg-error-bg p-3 text-sm">
            <p className="font-semibold">Una colonia ya pertenece a otra zona activa.</p>
            <ul className="mt-1 list-disc pl-5">{conflicts.map((conflict) => <li key={`${conflict.zoneId}/${conflict.settlementId}`}>
              {chosen.find((choice) => choice.settlementId === conflict.settlementId)?.name ?? conflict.settlementId} ya está en «{conflict.zoneName}». Quítala o edita esa zona.
            </li>)}</ul></div>}
        </div>
        {legacyPostalCoverage && <p role="status" className="rounded-lg border border-border bg-bg p-3 text-sm">
          Esta zona sólo cubre por código postal heredado. Elige colonias para convertirla; sin colonias se conserva el CP.
        </p>}
        <details className="rounded-lg border border-border p-3 text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Cobertura heredada por CP (opcional)</summary>
          <div className="mt-2 grid gap-3">
            <p className="text-xs text-text-muted">Si esta zona aún no tiene colonias, al agregar la primera se reemplaza la cobertura por CP.</p>
            <Field className="grid gap-1 text-sm" hint="Códigos postales que cubre esta zona. Una dirección con alguno de ellos recibe la tarifa de la zona." label="Códigos postales, separados por coma o línea">{(id) => <><textarea id={id} className={`${input} min-h-24`} value={postalCodes} onChange={(event) => setPostalCodes(event.target.value)} /></>}</Field>
            <Field className="grid gap-1 text-sm" hint="Ciudades, municipios o colonias que cubre la zona, para direcciones sin código postal conocido." label="Localidades, separadas por coma o línea">{(id) => <><textarea id={id} className={`${input} min-h-24`} value={localities} onChange={(event) => setLocalities(event.target.value)} /></>}</Field>
          </div>
        </details>
        <Field className="grid gap-1 text-sm" hint="Costo de envío que se cobra por entregar en esta zona, en la moneda del restaurante. 0 si el envío es gratis." label={`Tarifa (${currency})`}>{(id) => <><input id={id} className={input} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={fee} required onChange={(event) => setFee(event.target.value)} /></>}</Field>
        <CheckField className="flex min-h-11 items-center gap-2 text-sm" labelClassName="flex min-h-11 items-center" hint="Una zona inactiva deja de ofrecerse al capturar entregas, pero conserva su historial." label="Zona activa">{(id) => <input id={id} type="checkbox" className="h-5 w-5" checked={active} onChange={(event) => { setActive(event.target.checked); setConfirmDeactivate(false); }} />}</CheckField>
        {!active && <><Field className="grid gap-1 text-sm" hint="Por qué se desactiva la zona; queda registrado en la auditoría." label="Motivo de desactivación">{(id) => <><textarea id={id} className={`${input} min-h-24`} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} /></>}</Field>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={confirmDeactivate} onChange={(event) => setConfirmDeactivate(event.target.checked)} />Confirmo la desactivación de esta zona</label></>}
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || conflicts.length > 0}>Guardar zona</button>
          {editing && <button type="button" className={button} onClick={() => select()} disabled={busy}>Nueva zona</button>}</div>
      </form></section>
  </div>;
}
