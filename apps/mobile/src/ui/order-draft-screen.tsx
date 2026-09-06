import { Fragment } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type {
  DiningTableV1,
  MenuCatalogStateV1,
  MenuCatalogV1,
  MenuModifierGroupV1,
  MenuProductV1,
} from "@super-restaurant/shared-types";

import { renderMinorAmount } from "../money.js";
import { failureMessage, type MobileResource } from "../mobile-state.js";
import {
  DRAFT_MAX_GROUPS,
  DRAFT_MAX_QUANTITY,
  DRAFT_MIN_QUANTITY,
  activeProductGroups,
  draftLineIssues,
  findOption,
  findProduct,
  orderableCategories,
  orderableGroups,
  orderableProducts,
  orderDraftFailureMessage,
  orderDraftHasContent,
  remainingOptionCapacity,
  selectedGroupQuantity,
  selectedOptionQuantity,
  type OrderDraftConfirmation,
  type OrderDraftEvent,
  type OrderDraftLine,
  type OrderDraftState,
} from "../order-draft.js";
import {
  ActionButton,
  Banner,
  Body,
  Caption,
  Card,
  Heading,
  LoadingBlock,
  StateBlock,
  Subheading,
  useFocusRing,
} from "./components.js";
import { colors, radius, spacing, tabletBreakpoint, touchTarget, typography } from "./theme.js";

/**
 * Visual composer for one table's draft.
 *
 * Everything on this screen is local to the device. It reads the published
 * catalog, offers the products, modifiers and quantities the contract allows,
 * and hands the finished draft to `onSubmit`. It does not create an order, does
 * not read an active one, and adds up nothing: the only amounts shown are the
 * unit prices the catalog delivered, each with the currency it carries.
 */
export function OrderDraftScreen({
  category,
  draft,
  menu,
  onBackToTables,
  onCategorySelected,
  onEvent,
  onRetryMenu,
  onSubmit,
  table,
  zoneName,
}: {
  readonly category: string | undefined;
  readonly draft: OrderDraftState;
  readonly menu: MobileResource<MenuCatalogStateV1>;
  readonly onBackToTables: () => void;
  readonly onCategorySelected: (categoryId: string) => void;
  readonly onEvent: (event: OrderDraftEvent) => void;
  readonly onRetryMenu: () => void;
  readonly onSubmit: () => void;
  readonly table: DiningTableV1;
  readonly zoneName: string;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const wide = width >= tabletBreakpoint;
  const catalog = menu.value?.catalog ?? null;
  const busy = draft.submission.status === "sending";
  const hasContent = orderDraftHasContent(draft);

  return <View style={styles.screen}>
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Caption>{zoneName}</Caption>
        <Heading>{table.name}</Heading>
        <Caption>
          {table.capacity === 1 ? "1 persona" : `${table.capacity} personas`}
          {" · Borrador local, sin orden creada"}
        </Caption>
      </View>
      <View style={styles.headerActions}>
        <ActionButton
          accessibilityHint={hasContent
            ? "Pide confirmación dentro de la pantalla: volver al plano descarta este borrador"
            : "Vuelve al plano de mesas; no hay nada compuesto que perder"}
          disabled={busy}
          label="Volver a mesas"
          onPress={onBackToTables}
          tone="secondary"
        />
        <ActionButton
          accessibilityHint="Pide confirmación dentro de la pantalla antes de vaciar el borrador y seguir en esta mesa"
          disabled={busy || !hasContent}
          label="Descartar borrador"
          onPress={() => { onEvent({ intent: "discardDraft", type: "confirmationRequested" }); }}
          tone="secondary"
        />
      </View>
    </View>

    <Banner
      message={"Los importes provienen del catálogo publicado y son unitarios. Este dispositivo no calcula subtotales, "
        + "impuestos, descuentos, propinas ni total, y no consulta la orden activa de la mesa."}
      tone="info"
    />

    {draft.pendingConfirmation === undefined
      ? null
      : <DraftLossConfirmation
        composing={draft.composer !== undefined}
        intent={draft.pendingConfirmation}
        lineCount={draft.lines.length}
        onCancel={() => { onEvent({ type: "confirmationCancelled" }); }}
        onConfirm={() => { onEvent({ type: "confirmationConfirmed" }); }}
      />}

    <View style={wide ? styles.columnsWide : styles.columns}>
      <View style={styles.column}>
        <CatalogPane
          busy={busy}
          category={category}
          catalog={catalog}
          draft={draft}
          menu={menu}
          onCategorySelected={onCategorySelected}
          onEvent={onEvent}
          onRetryMenu={onRetryMenu}
        />
      </View>
      <View style={styles.column}>
        <DraftPane catalog={catalog} draft={draft} onEvent={onEvent} onSubmit={onSubmit} />
      </View>
    </View>
  </View>;
}

/** Catalog side: categories, products, and the configurator of one product. */
function CatalogPane({ busy, category, catalog, draft, menu, onCategorySelected, onEvent, onRetryMenu }: {
  readonly busy: boolean;
  readonly category: string | undefined;
  readonly catalog: MenuCatalogV1 | null;
  readonly draft: OrderDraftState;
  readonly menu: MobileResource<MenuCatalogStateV1>;
  readonly onCategorySelected: (categoryId: string) => void;
  readonly onEvent: (event: OrderDraftEvent) => void;
  readonly onRetryMenu: () => void;
}): React.JSX.Element {
  if (menu.status === "idle" || menu.status === "loading") {
    return <LoadingBlock label="Cargando el menú publicado…" />;
  }
  if (menu.status === "failed" || menu.value === undefined) {
    return <StateBlock
      action={{ label: "Reintentar", onPress: onRetryMenu }}
      description={failureMessage(menu.failure ?? "unavailable")}
      title="No se pudo cargar el menú"
    />;
  }
  if (catalog === null) {
    return <StateBlock
      action={{ label: "Actualizar", onPress: onRetryMenu }}
      description="Esta sucursal todavía no tiene un catálogo publicado, así que no hay productos que comandar."
      title="Sin menú publicado"
    />;
  }

  const categories = orderableCategories(catalog);
  if (categories.length === 0) {
    return <StateBlock
      action={{ label: "Actualizar", onPress: onRetryMenu }}
      description="El catálogo publicado no tiene productos activos en ninguna categoría."
      title="Sin productos disponibles"
    />;
  }

  const composer = draft.composer;
  if (composer !== undefined) {
    const product = findProduct(catalog, composer.productId);
    if (product === undefined) {
      return <StateBlock
        action={{ label: "Volver al catálogo", onPress: () => { onEvent({ type: "composerClosed" }); } }}
        description="El catálogo publicado ya no incluye este producto. Elige otro."
        title="Producto no disponible"
      />;
    }
    return <ProductComposer catalog={catalog} draft={draft} onEvent={onEvent} product={product} />;
  }

  const selected = categories.find((entry) => entry.categoryId === category) ?? categories[0];
  const products = selected === undefined ? [] : orderableProducts(catalog, selected.categoryId);

  return <View style={styles.pane}>
    <Subheading>Catálogo</Subheading>
    <View accessibilityRole="tablist" style={styles.chips}>
      {categories.map((entry) => <Chip
        key={entry.categoryId}
        label={entry.name}
        onPress={() => { onCategorySelected(entry.categoryId); }}
        selected={entry.categoryId === selected?.categoryId}
      />)}
    </View>
    <ScrollView contentContainerStyle={styles.paneContent}>
      {products.map((product) => <ProductRow
        busy={busy}
        currency={catalog.currency}
        key={product.productId}
        onPress={() => { onEvent({ productId: product.productId, type: "productOpened" }); }}
        product={product}
      />)}
    </ScrollView>
  </View>;
}

function ProductRow({ busy, currency, onPress, product }: {
  readonly busy: boolean;
  readonly currency: string;
  readonly onPress: () => void;
  readonly product: MenuProductV1;
}): React.JSX.Element {
  const focus = useFocusRing();
  return <Pressable
    accessibilityHint="Abre la configuración de cantidad y modificadores"
    accessibilityLabel={`${product.name}, ${renderMinorAmount(product.unitPriceMinor, currency)}`}
    accessibilityRole="button"
    accessibilityState={{ disabled: busy }}
    disabled={busy}
    onPress={onPress}
    {...focus.handlers}
    style={(state) => [styles.row, (state.pressed || focus.focused) && styles.rowPressed, busy && styles.inactive]}
  >
    <View style={styles.rowText}>
      <Subheading>{product.name}</Subheading>
      <Caption>{`Unitario: ${renderMinorAmount(product.unitPriceMinor, currency)}`}</Caption>
      <Caption>{`Unidad: ${product.unit}`}</Caption>
    </View>
    <Text style={styles.rowAction}>Agregar</Text>
  </Pressable>;
}

/** Quantity and modifiers of one product, bounded by what the contract allows. */
function ProductComposer({ catalog, draft, onEvent, product }: {
  readonly catalog: MenuCatalogV1;
  readonly draft: OrderDraftState;
  readonly onEvent: (event: OrderDraftEvent) => void;
  readonly product: MenuProductV1;
}): React.JSX.Element {
  const composer = draft.composer;
  if (composer === undefined) return <View />;
  // Rendered from the bounded list, judged by the same fail-closed check the
  // hand-over uses. If the catalog requires something this screen cannot show,
  // the operator is told here rather than after a rejected send.
  const groups = orderableGroups(catalog, product.productId);
  const hidden = activeProductGroups(catalog, product.productId).length - groups.length;
  const issues = draftLineIssues(catalog, composer);
  const editing = composer.replacingLineId !== undefined;

  return <ScrollView contentContainerStyle={styles.paneContent} style={styles.pane}>
    <Subheading>{editing ? `Editar ${product.name}` : product.name}</Subheading>
    <Caption>{`Unitario: ${renderMinorAmount(product.unitPriceMinor, catalog.currency)}`}</Caption>

    <Stepper
      decreaseHint="Resta una unidad al producto"
      increaseHint="Suma una unidad al producto"
      label="Cantidad"
      max={DRAFT_MAX_QUANTITY}
      min={DRAFT_MIN_QUANTITY}
      onStep={(delta) => { onEvent({ delta, type: "composerQuantityStepped" }); }}
      value={composer.quantity}
    />

    {groups.length === 0
      ? <Caption>Este producto no publica modificadores.</Caption>
      : groups.map((group) => <ModifierGroup
        currency={catalog.currency}
        group={group}
        key={group.groupId}
        onEvent={onEvent}
        selections={composer.modifierGroups}
      />)}

    {hidden > 0
      ? <Caption>
        {`El catálogo publica ${hidden === 1 ? "1 grupo más" : `${hidden} grupos más`} de los que una comanda `
          + `admite; esta pantalla muestra los primeros ${DRAFT_MAX_GROUPS}.`}
      </Caption>
      : null}

    {issues.length === 0
      ? null
      : <View accessibilityLiveRegion="polite" style={styles.issues}>
        {issues.map((issue) => <Caption key={issue}>{issue}</Caption>)}
      </View>}

    <View style={styles.composerActions}>
      <ActionButton
        disabled={issues.length > 0}
        label={editing ? "Guardar línea" : "Agregar al borrador"}
        onPress={() => { onEvent({ type: "composerCommitted" }); }}
      />
      <ActionButton label="Cancelar" onPress={() => { onEvent({ type: "composerClosed" }); }} tone="secondary" />
    </View>
  </ScrollView>;
}

function ModifierGroup({ currency, group, onEvent, selections }: {
  readonly currency: string;
  readonly group: MenuModifierGroupV1;
  readonly onEvent: (event: OrderDraftEvent) => void;
  readonly selections: readonly import("@super-restaurant/shared-types").ModifierGroupSelectionV1[];
}): React.JSX.Element {
  const chosen = selectedGroupQuantity(selections, group.groupId);
  return <View style={styles.group}>
    <Subheading>{group.name}</Subheading>
    <Caption>
      {`Elige de ${group.minimumQuantity} a ${group.maximumQuantity} · elegidas ${chosen}`}
    </Caption>
    {group.options.length === 0
      ? <Caption>Este grupo no tiene opciones activas.</Caption>
      : group.options.map((option) => {
        const quantity = selectedOptionQuantity(selections, group.groupId, option.optionId);
        const capacity = remainingOptionCapacity(group, option, selections);
        return <View key={option.optionId} style={styles.option}>
          <View style={styles.rowText}>
            <Body>{option.name}</Body>
            <Caption>{`Unitario: ${renderMinorAmount(option.unitPriceMinor, currency)}`}</Caption>
          </View>
          <Stepper
            decreaseHint={`Quita una unidad de ${option.name}`}
            disableIncrease={capacity === 0}
            increaseHint={`Agrega una unidad de ${option.name}`}
            label={option.name}
            max={quantity + capacity}
            min={0}
            onStep={(delta) => {
              onEvent({
                delta,
                groupId: group.groupId,
                maximum: quantity + capacity,
                optionId: option.optionId,
                type: "composerOptionStepped",
              });
            }}
            value={quantity}
          />
        </View>;
      })}
  </View>;
}

/** Draft side: the composed lines and the single primary action. */
function DraftPane({ catalog, draft, onEvent, onSubmit }: {
  readonly catalog: MenuCatalogV1 | null;
  readonly draft: OrderDraftState;
  readonly onEvent: (event: OrderDraftEvent) => void;
  readonly onSubmit: () => void;
}): React.JSX.Element {
  const busy = draft.submission.status === "sending";
  return <View style={styles.pane}>
    <Subheading>{`Borrador · ${draft.lines.length === 1 ? "1 línea" : `${draft.lines.length} líneas`}`}</Subheading>

    {draft.submission.status === "sending" ? <LoadingBlock label="Enviando la comanda…" /> : null}
    {draft.submission.status === "sent"
      ? <Banner
        message={"La comanda se entregó y sus líneas salieron del borrador, así que no pueden reenviarse. "
          + "Lo que agregues ahora será una comanda nueva para esta mesa."}
        tone="info"
      />
      : null}
    {draft.submission.status === "failed" && draft.submission.failure !== undefined
      ? <Banner message={orderDraftFailureMessage(draft.submission.failure)} tone="error" />
      : null}

    {draft.lines.length === 0
      ? <StateBlock
        description="Elige un producto del catálogo para empezar la comanda de esta mesa."
        title={draft.submission.status === "sent" ? "Sin líneas pendientes" : "Borrador vacío"}
      />
      : <ScrollView contentContainerStyle={styles.paneContent}>
        {draft.lines.map((line) => <DraftLineCard
          busy={busy}
          catalog={catalog}
          key={line.draftLineId}
          line={line}
          onEvent={onEvent}
        />)}
      </ScrollView>}

    <ActionButton
      accessibilityHint="Entrega el borrador a la integración de comandas; todavía no escribe en el servidor"
      busy={busy}
      disabled={draft.lines.length === 0 || draft.composer !== undefined}
      label="Enviar comanda"
      onPress={onSubmit}
    />
  </View>;
}

function DraftLineCard({ busy, catalog, line, onEvent }: {
  readonly busy: boolean;
  readonly catalog: MenuCatalogV1 | null;
  readonly line: OrderDraftLine;
  readonly onEvent: (event: OrderDraftEvent) => void;
}): React.JSX.Element {
  const product = catalog === null ? undefined : findProduct(catalog, line.productId);
  // Name lookup, not a render list: resolve against every active group so a
  // selection past the presentation cap still shows its real name.
  const groups = catalog === null ? [] : activeProductGroups(catalog, line.productId);
  return <Card>
    <Subheading>{`${line.quantity} × ${product?.name ?? "Producto no disponible"}`}</Subheading>
    {product === undefined || catalog === null
      ? <Caption>El catálogo publicado ya no incluye este producto; edítalo o elimínalo.</Caption>
      : <Caption>{`Unitario: ${renderMinorAmount(product.unitPriceMinor, catalog.currency)}`}</Caption>}
    {line.modifierGroups.map((selection) => {
      const group = groups.find((candidate) => candidate.groupId === selection.groupId);
      return <Fragment key={selection.groupId}>
        {selection.selections.map((option) => {
          const catalogOption = group === undefined ? undefined : findOption(group, option.optionId);
          return <Caption key={option.optionId}>
            {`• ${option.quantity} × ${catalogOption?.name ?? "Opción no disponible"}`}
            {catalogOption === undefined || catalog === null
              ? ""
              : ` — ${renderMinorAmount(catalogOption.unitPriceMinor, catalog.currency)}`}
          </Caption>;
        })}
      </Fragment>;
    })}
    <View style={styles.lineActions}>
      <ActionButton
        disabled={busy}
        label="Editar"
        onPress={() => { onEvent({ draftLineId: line.draftLineId, type: "lineEditRequested" }); }}
        tone="secondary"
      />
      <ActionButton
        disabled={busy}
        label="Eliminar"
        onPress={() => { onEvent({ draftLineId: line.draftLineId, type: "lineRemoved" }); }}
        tone="secondary"
      />
    </View>
  </Card>;
}

/** In-screen confirmation. The product never uses `alert`/`confirm`/`prompt`. */
/**
 * The single in-screen confirmation for both ways of losing the draft. The two
 * destinations never share wording: the question, the body and the confirming
 * label each name where the operator will end up, so answering "sí" can only
 * do the thing that was asked about.
 */
function DraftLossConfirmation({ composing, intent, lineCount, onCancel, onConfirm }: {
  readonly composing: boolean;
  readonly intent: OrderDraftConfirmation;
  readonly lineCount: number;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  const leaving = intent === "leaveTable";
  const lines = lineCount === 1 ? "1 línea" : `${lineCount} líneas`;
  const lost = lineCount === 0
    ? "el producto que estás configurando"
    : `${lines}${composing ? " y el producto que estás configurando" : ""}`;
  return <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.confirm}>
    <Subheading>{leaving ? "¿Volver a mesas y descartar el borrador?" : "¿Descartar el borrador?"}</Subheading>
    <Body>
      {`Se perderá ${lost} de esta mesa en este dispositivo. `
        + (leaving
          ? "Volverás al plano de mesas y la mesa quedará sin borrador. "
          : "Seguirás en esta mesa, con el borrador vacío. ")
        + "No afecta ninguna orden del servidor."}
    </Body>
    <View style={styles.confirmActions}>
      <ActionButton
        label={leaving ? "Sí, descartar y volver a mesas" : "Sí, descartar y seguir aquí"}
        onPress={onConfirm}
      />
      <ActionButton label="Conservar borrador" onPress={onCancel} tone="secondary" />
    </View>
  </View>;
}

function Chip({ label, onPress, selected }: {
  readonly label: string;
  readonly onPress: () => void;
  readonly selected: boolean;
}): React.JSX.Element {
  const focus = useFocusRing();
  return <Pressable
    accessibilityLabel={label}
    accessibilityRole="tab"
    accessibilityState={{ selected }}
    onPress={onPress}
    {...focus.handlers}
    style={(state) => [
      styles.chip,
      selected && styles.chipSelected,
      (state.pressed || focus.focused) && styles.chipPressed,
    ]}
  >
    <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
  </Pressable>;
}

/**
 * Integer stepper. Typing is not offered, so a non-integer cannot be entered.
 * It reports a **step**, not a new value: two rapid taps both read the same
 * rendered `value`, so an absolute result would lose one of them.
 */
function Stepper({ decreaseHint, disableIncrease = false, increaseHint, label, max, min, onStep, value }: {
  readonly decreaseHint: string;
  readonly disableIncrease?: boolean;
  readonly increaseHint: string;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onStep: (delta: number) => void;
  readonly value: number;
}): React.JSX.Element {
  const canDecrease = value > min;
  const canIncrease = !disableIncrease && value < max;
  // The value carries the accessible name; the row itself must not repeat it.
  return <View style={styles.stepper}>
    <StepperButton
      disabled={!canDecrease}
      hint={decreaseHint}
      label={`Disminuir ${label}`}
      onPress={() => { onStep(-1); }}
      symbol="−"
    />
    <Text accessibilityLabel={`${label}: ${value}`} style={styles.stepperValue}>{value}</Text>
    <StepperButton
      disabled={!canIncrease}
      hint={increaseHint}
      label={`Aumentar ${label}`}
      onPress={() => { onStep(1); }}
      symbol="+"
    />
  </View>;
}

function StepperButton({ disabled, hint, label, onPress, symbol }: {
  readonly disabled: boolean;
  readonly hint: string;
  readonly label: string;
  readonly onPress: () => void;
  readonly symbol: string;
}): React.JSX.Element {
  const focus = useFocusRing();
  return <Pressable
    accessibilityHint={hint}
    accessibilityLabel={label}
    accessibilityRole="button"
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    {...focus.handlers}
    style={(state) => [
      styles.stepperButton,
      disabled && styles.inactive,
      (state.pressed || focus.focused) && styles.stepperButtonFocused,
    ]}
  >
    <Text style={styles.stepperSymbol}>{symbol}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.control,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.primary,
    paddingHorizontal: spacing.md,
  },
  chipLabel: { color: colors.text, fontWeight: "600", ...typography.body },
  chipLabelSelected: { color: colors.accentText },
  chipPressed: { borderColor: colors.focus, borderWidth: 3 },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  column: { flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: 0 },
  columns: { flex: 1, gap: spacing.lg },
  columnsWide: { flex: 1, flexDirection: "row", gap: spacing.lg },
  composerActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  confirm: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.danger,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  confirmActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  group: { gap: spacing.xs, marginTop: spacing.md },
  headerActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, width: "100%" },
  headerText: { flexGrow: 1, flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  inactive: { opacity: 0.6 },
  issues: { gap: spacing.xs, marginTop: spacing.sm },
  lineActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  option: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  pane: { flex: 1, gap: spacing.sm, minWidth: 0 },
  paneContent: { gap: spacing.sm, paddingBottom: spacing.lg },
  row: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: touchTarget.primary,
    padding: spacing.md,
  },
  rowAction: { color: colors.accent, fontWeight: "600", ...typography.body },
  rowPressed: { borderColor: colors.focus, borderWidth: 3 },
  rowText: { flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  screen: { flex: 1 },
  stepper: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  stepperButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.accent,
    borderRadius: radius.control,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.primary,
    minWidth: touchTarget.primary,
  },
  stepperButtonFocused: { borderColor: colors.focus, borderWidth: 3 },
  stepperSymbol: { color: colors.accent, fontWeight: "700", ...typography.subheading },
  stepperValue: { color: colors.text, fontWeight: "600", minWidth: 32, textAlign: "center", ...typography.body },
});
