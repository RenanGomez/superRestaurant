import { FlatList, StyleSheet, View } from "react-native";
import type {
  MenuCatalogStateV1,
  MenuCatalogV1,
  MenuCategoryV1,
  MenuModifierGroupV1,
  MenuProductV1,
} from "@super-restaurant/shared-types";

import { renderMinorAmount } from "../money.js";
import { failureMessage, type MobileResource } from "../mobile-state.js";
import { Banner, Body, Caption, Card, LoadingBlock, StateBlock, Subheading } from "./components.js";
import { spacing } from "./theme.js";

export function MenuScreen({ menu, onRetry }: {
  readonly menu: MobileResource<MenuCatalogStateV1>;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (menu.status === "idle" || menu.status === "loading") {
    return <LoadingBlock label="Cargando el menú publicado…" />;
  }
  if (menu.status === "failed" || menu.value === undefined) {
    return <StateBlock
      action={{ label: "Reintentar", onPress: onRetry }}
      description={failureMessage(menu.failure ?? "unavailable")}
      title="No se pudo cargar el menú"
    />;
  }

  const catalog = menu.value.catalog;
  if (catalog === null) {
    return <StateBlock
      action={{ label: "Actualizar", onPress: onRetry }}
      description="Esta sucursal todavía no tiene un catálogo publicado. El menú se administra desde la web."
      title="Sin menú publicado"
    />;
  }
  if (catalog.categories.length === 0) {
    return <StateBlock
      action={{ label: "Actualizar", onPress: onRetry }}
      description="El catálogo publicado no tiene categorías visibles."
      title="Menú vacío"
    />;
  }

  return <FlatList
    accessibilityLabel="Menú publicado"
    contentContainerStyle={styles.list}
    data={catalog.categories}
    keyExtractor={(category) => category.categoryId}
    ListHeaderComponent={<Banner
      message={`Solo lectura. Precios en ${catalog.currency}, expresados en unidades menores enteras.`}
      tone="info"
    />}
    renderItem={({ item }) => <CategorySection catalog={catalog} category={item} />}
  />;
}

function CategorySection({ catalog, category }: {
  readonly catalog: MenuCatalogV1;
  readonly category: MenuCategoryV1;
}): React.JSX.Element {
  const products = catalog.products.filter((product) => product.categoryId === category.categoryId);
  return <View style={styles.section}>
    <Subheading>{category.active ? category.name : `${category.name} (inactiva)`}</Subheading>
    {products.length === 0
      ? <Body>Esta categoría no tiene productos publicados.</Body>
      : products.map((product) => <ProductCard
        currency={catalog.currency}
        groups={catalog.modifierGroups.filter((group) => group.productId === product.productId)}
        key={product.productId}
        product={product}
      />)}
  </View>;
}

function ProductCard({ currency, groups, product }: {
  readonly currency: string;
  readonly groups: readonly MenuModifierGroupV1[];
  readonly product: MenuProductV1;
}): React.JSX.Element {
  return <Card>
    <Subheading>{product.active ? product.name : `${product.name} (inactivo)`}</Subheading>
    <Body>{renderMinorAmount(product.unitPriceMinor, currency)}</Body>
    <Caption>{`Unidad: ${product.unit} · Estación: ${product.stationId}${product.sku === null ? "" : ` · SKU: ${product.sku}`}`}</Caption>
    {product.tax === null
      ? <Caption>Sin impuesto declarado en el catálogo.</Caption>
      : <Caption>
        {`${product.tax.name}: ${product.tax.rateNumerator}/${product.tax.rateDenominator}`}
        {product.tax.inclusion === "included" ? " (incluido)" : " (excluido)"}
      </Caption>}
    {groups.map((group) => <View key={group.groupId} style={styles.group}>
      <Caption>
        {`${group.active ? group.name : `${group.name} (inactivo)`} · elige ${group.minimumQuantity} a ${group.maximumQuantity}`}
      </Caption>
      {group.options.map((option) => <Body key={option.optionId}>
        {`• ${option.name} — ${renderMinorAmount(option.unitPriceMinor, currency)}`}
      </Body>)}
    </View>)}
  </Card>;
}

const styles = StyleSheet.create({
  group: { gap: spacing.xs, marginTop: spacing.sm },
  list: { gap: spacing.lg, paddingBottom: spacing.xl },
  section: { gap: spacing.sm },
});
