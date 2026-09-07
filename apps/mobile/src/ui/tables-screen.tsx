import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { DiningLayoutV1, DiningLayoutZoneV1, DiningTableV1 } from "@super-restaurant/shared-types";

import { failureMessage, type MobileResource } from "../mobile-state.js";
import { Banner, Body, Caption, LoadingBlock, StateBlock, Subheading, useFocusRing } from "./components.js";
import { colors, radius, spacing, tabletBreakpoint, touchTarget, typography } from "./theme.js";

const SHAPES: Readonly<Record<DiningTableV1["shape"], string>> = Object.freeze({
  rectangle: "Rectangular",
  round: "Redonda",
  square: "Cuadrada",
});

/**
 * Zones and tables of the authorized branch, as a touch selection.
 *
 * Only what the layout contract carries is shown — zone, name, capacity and
 * shape. Occupancy, availability, an open order or a bill are **not** shown,
 * and are not inferred: no consolidated POS read exists for them yet, so the
 * screen says so instead of guessing. Picking a table opens a local draft; it
 * does not open, hold or claim the table anywhere.
 */
export function TablesScreen({ layout, onRetry, onSelectTable, selectedTableId }: {
  readonly layout: MobileResource<DiningLayoutV1>;
  readonly onRetry: () => void;
  readonly onSelectTable: (table: DiningTableV1) => void;
  readonly selectedTableId: string | undefined;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const columns = width >= tabletBreakpoint ? 2 : 1;

  if (layout.status === "idle" || layout.status === "loading") {
    return <LoadingBlock label="Cargando mesas de la sucursal…" />;
  }
  if (layout.status === "failed" || layout.value === undefined) {
    return <StateBlock
      action={{ label: "Reintentar", onPress: onRetry }}
      description={failureMessage(layout.failure ?? "unavailable")}
      title="No se pudieron cargar las mesas"
    />;
  }
  if (layout.value.zones.length === 0) {
    return <StateBlock
      action={{ label: "Actualizar", onPress: onRetry }}
      description="Esta sucursal todavía no tiene zonas ni mesas configuradas. El plano se administra desde la web."
      title="Sin zonas configuradas"
    />;
  }

  return <FlatList
    accessibilityLabel="Zonas y mesas de la sucursal"
    contentContainerStyle={styles.list}
    data={layout.value.zones}
    keyExtractor={(zone) => zone.zoneId}
    ListHeaderComponent={<Banner
      message={"Elige una mesa para preparar su comanda. Este plano no infiere ocupación ni cuenta; "
        + "al abrir una mesa se consultan sus órdenes activas."}
      tone="info"
    />}
    renderItem={({ item }) => <ZoneSection
      columns={columns}
      onSelectTable={onSelectTable}
      selectedTableId={selectedTableId}
      zone={item}
    />}
  />;
}

function ZoneSection({ columns, onSelectTable, selectedTableId, zone }: {
  readonly columns: number;
  readonly onSelectTable: (table: DiningTableV1) => void;
  readonly selectedTableId: string | undefined;
  readonly zone: DiningLayoutZoneV1;
}): React.JSX.Element {
  return <View style={styles.zone}>
    <Subheading>{zone.name}</Subheading>
    <Caption>{zone.tables.length === 1 ? "1 mesa" : `${zone.tables.length} mesas`}</Caption>
    {zone.tables.length === 0
      ? <Body>Esta zona no tiene mesas.</Body>
      : <View style={styles.tables}>
        {zone.tables.map((table) => <View key={table.tableId} style={[styles.tableSlot, { width: `${100 / columns}%` }]}>
          <TableButton
            onSelect={onSelectTable}
            selected={selectedTableId === table.tableId}
            table={table}
            zoneName={zone.name}
          />
        </View>)}
      </View>}
  </View>;
}

function TableButton({ onSelect, selected, table, zoneName }: {
  readonly onSelect: (table: DiningTableV1) => void;
  readonly selected: boolean;
  readonly table: DiningTableV1;
  readonly zoneName: string;
}): React.JSX.Element {
  const focus = useFocusRing();
  const capacity = table.capacity === 1 ? "1 persona" : `${table.capacity} personas`;
  return <Pressable
    accessibilityHint="Abre el borrador de comanda de esta mesa en este dispositivo"
    accessibilityLabel={`${zoneName}, ${table.name}, ${capacity}`}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    onPress={() => { onSelect(table); }}
    {...focus.handlers}
    style={(state) => [
      styles.table,
      selected && styles.tableSelected,
      (state.pressed || focus.focused) && styles.tablePressed,
    ]}
  >
    <View style={styles.tableText}>
      <Subheading>{table.name}</Subheading>
      <Body>{capacity}</Body>
      <Caption>{SHAPES[table.shape]}</Caption>
    </View>
    <Text style={styles.tableAction}>{selected ? "Abierta" : "Comanda"}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  list: { gap: spacing.lg, paddingBottom: spacing.xl },
  table: {
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
  tableAction: { color: colors.accent, fontWeight: "600", ...typography.body },
  tablePressed: { borderColor: colors.focus, borderWidth: 3 },
  tableSelected: { borderColor: colors.accent, borderWidth: 3 },
  tableSlot: { padding: spacing.xs },
  tableText: { flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  tables: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -spacing.xs },
  zone: { gap: spacing.xs },
});
