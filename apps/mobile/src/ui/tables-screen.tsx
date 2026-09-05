import { FlatList, StyleSheet, View, useWindowDimensions } from "react-native";
import type { DiningLayoutV1, DiningLayoutZoneV1, DiningTableV1 } from "@super-restaurant/shared-types";

import { failureMessage, type MobileResource } from "../mobile-state.js";
import { Body, Caption, Card, LoadingBlock, StateBlock, Subheading } from "./components.js";
import { spacing, tabletBreakpoint } from "./theme.js";

const SHAPES: Readonly<Record<DiningTableV1["shape"], string>> = Object.freeze({
  rectangle: "Rectangular",
  round: "Redonda",
  square: "Cuadrada",
});

export function TablesScreen({ layout, onRetry }: {
  readonly layout: MobileResource<DiningLayoutV1>;
  readonly onRetry: () => void;
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
    renderItem={({ item }) => <ZoneSection columns={columns} zone={item} />}
  />;
}

function ZoneSection({ columns, zone }: {
  readonly columns: number;
  readonly zone: DiningLayoutZoneV1;
}): React.JSX.Element {
  return <View style={styles.zone}>
    <Subheading>{zone.name}</Subheading>
    <Caption>{zone.tables.length === 1 ? "1 mesa" : `${zone.tables.length} mesas`}</Caption>
    {zone.tables.length === 0
      ? <Body>Esta zona no tiene mesas.</Body>
      : <View style={styles.tables}>
        {zone.tables.map((table) => <View key={table.tableId} style={[styles.tableSlot, { width: `${100 / columns}%` }]}>
          <Card>
            <Subheading>{table.name}</Subheading>
            <Body>{table.capacity === 1 ? "1 persona" : `${table.capacity} personas`}</Body>
            <Caption>{SHAPES[table.shape]}</Caption>
          </Card>
        </View>)}
      </View>}
  </View>;
}

const styles = StyleSheet.create({
  list: { gap: spacing.lg, paddingBottom: spacing.xl },
  tableSlot: { padding: spacing.xs },
  tables: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -spacing.xs },
  zone: { gap: spacing.xs },
});
