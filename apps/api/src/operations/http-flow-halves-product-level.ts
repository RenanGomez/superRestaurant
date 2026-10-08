import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { captureAndConfirm, ok, openShiftAndRegister, publishCatalog, record, sendOrderToKitchen } from "./http-flow-support.js";
import { runHttpFlow } from "./http-test-harness.js";

const marker = "LOCAL_HTTP_FLOW_ONLY";
const productPriceMinor = 12_000;
const hawaiianPriceMinor = 17_000;
const cheeseMinor = 2_501;
// Rules under test: the dearer half sets the unit price (zero-priced flavors and a custom half take the
// product price); an ingredient on a half costs half, rounded up.
const halfCheeseMinor = Math.ceil(cheeseMinor / 2);

/**
 * Half-and-half configured on the PRODUCT: a product without sizes is split, one half may be built
 * ingredient by ingredient, and the save refuses a product setup next to an enabled legacy size setup.
 */
export async function halvesProductLevelFlow(): Promise<void> {
  await runHttpFlow({ databasePrefix: "superrestaurant_http_halves_pl", marker, stage: "http_flow_halves_product_level" }, async (context) => {
    const { scope } = context;
    const categoryId = randomUUID();
    const productId = randomUUID();
    const flavorGroupId = randomUUID();
    const ingredientGroupId = randomUUID();
    const pepperoniId = randomUUID();
    const hawaiianId = randomUUID();
    const cheeseId = randomUUID();
    const catalog = {
      categories: [{ categoryId, name: "Pizzas", active: true, displayOrder: 0 }],
      products: [{ productId, categoryId, name: "Pizza", sku: "PIZ-PL", active: true, displayOrder: 0, stationId: "kitchen", unit: "piece",
        unitPriceMinor: productPriceMinor, tax: null, imagePath: null,
        fraction: { enabled: true, flavorGroupId, extraGroupId: ingredientGroupId, excludableIngredientIds: ["cebolla"] } }],
      modifierGroups: [
        { groupId: flavorGroupId, productId, name: "Sabores", active: true, displayOrder: 0, minimumQuantity: 0, maximumQuantity: 2,
          options: [
            { optionId: pepperoniId, name: "Pepperoni", unitPriceMinor: 0, active: true, imagePath: null, maximumQuantity: null },
            { optionId: hawaiianId, name: "Hawaiana", unitPriceMinor: hawaiianPriceMinor, active: true, imagePath: null, maximumQuantity: null },
          ] },
        { groupId: ingredientGroupId, productId, name: "Ingredientes", active: true, displayOrder: 1, minimumQuantity: 0, maximumQuantity: 5,
          options: [{ optionId: cheeseId, name: "Queso", unitPriceMinor: cheeseMinor, active: true, imagePath: null, maximumQuantity: null }] },
      ],
    };

    // Save: a product with BOTH an enabled product setup and an enabled legacy size setup is refused.
    const refused = await context.send("manager", "PUT", "/catalog/menu", {
      ...context.audit(), schemaVersion: 1, scope, expectedVersion: 0, catalogVersion: randomUUID(), currency: "MXN",
      ...catalog,
      products: [{ ...catalog.products[0], variants: [{ variantId: randomUUID(), name: "Grande", sku: null, active: true, displayOrder: 0,
        unitPriceMinor: 18_000, fraction: { enabled: true, flavorGroupId, extraGroupId: null, excludableIngredientIds: [] } }] }],
    });
    assert.ok(refused.status >= 400 && refused.status < 500, `duplicate setup source refused: HTTP ${refused.status}`);
    context.check("save_refuses_two_enabled_fraction_sources");

    const { catalogVersion } = await publishCatalog(context, catalog);
    const read = ok(await context.send("manager", "GET", `/catalog/menu${context.query({ ...scope })}`), "catalog_read");
    const savedProduct = record((record(record(read).catalog).products as unknown[])[0]);
    assert.deepEqual(record(savedProduct.fraction), { enabled: true, flavorGroupId, extraGroupId: ingredientGroupId, excludableIngredientIds: ["cebolla"] });
    context.check("catalog_read_returns_product_level_fraction");

    const register = await openShiftAndRegister(context, 0);
    const slot = (fraction: string, flavorOptionId: string | null, extraOptionIds: string[] = []) =>
      ({ fraction, flavorOptionId, extraOptionIds, excludedIngredientIds: [] });
    const customAndHawaiian = { geometry: "halves", slots: [slot("half-a", null, [cheeseId]), slot("half-b", hawaiianId)] };
    const quoteBody = (fraction: unknown) => ({ schemaVersion: 1, scope, catalogVersion, productId, variantId: null,
      modifierGroups: [], fraction, quantity: 1 });

    const quote = ok(await context.send("cashier", "POST", "/captures/line-quote", quoteBody(customAndHawaiian)), "line_quote_custom");
    assert.equal(quote.geometry, "halves");
    assert.equal(quote.lineTotalMinor, hawaiianPriceMinor + halfCheeseMinor);
    assert.deepEqual((quote.fractionBreakdown as Record<string, unknown>[]).map((half) => [half.fraction, half.flavorName, half.amountMinor, half.flavorOptionId]),
      [["half-a", "Armada", productPriceMinor, null], ["half-b", "Hawaiana", hawaiianPriceMinor, hawaiianId]]);
    context.check("quote_product_without_sizes_with_custom_half");

    const zeroFlavors = ok(await context.send("cashier", "POST", "/captures/line-quote", quoteBody(
      { geometry: "halves", slots: [slot("half-a", pepperoniId), slot("half-b", pepperoniId)] })), "line_quote_flavors");
    assert.equal(zeroFlavors.lineTotalMinor, productPriceMinor);
    context.check("quote_zero_priced_flavors_take_product_price");

    const bothCustom = await context.send("cashier", "POST", "/captures/line-quote", quoteBody(
      { geometry: "halves", slots: [slot("half-a", null), slot("half-b", null)] }));
    assert.ok(bothCustom.status >= 400 && bothCustom.status < 500, `two custom halves refused: HTTP ${bothCustom.status}`);
    context.check("quote_refuses_two_custom_halves");

    const captured = await captureAndConfirm(context, { catalogVersion, shiftId: register.shiftId,
      lines: [{ lineId: randomUUID(), productId, variantId: null, quantity: 1, fraction: customAndHawaiian }] });
    const projection = record(captured.workspace.selectionProjection);
    assert.equal(projection.itemsTotalMinor, quote.lineTotalMinor);
    const projectedHalf = record((record((projection.lines as unknown[])[0]).halves as unknown[])[0]);
    assert.equal(projectedHalf.flavorOptionId, null);
    assert.equal(projectedHalf.flavorName, "Armada");
    context.check("selection_plan_projection_and_confirmation_match_quote");

    const detail = await sendOrderToKitchen(context, captured.orderId);
    const item = record((detail.items as unknown[])[0]);
    assert.equal(item.geometry, "halves");
    const orderHalf = record((item.fractionBreakdown as unknown[])[0]);
    assert.equal(orderHalf.flavorOptionId, null);
    const tickets = ok(await context.send("manager", "GET", `/kds/tickets${context.query({ ...scope, stationId: "kitchen" })}`), "kds_tickets");
    const ticket = (tickets.tickets as Record<string, unknown>[]).find((candidate) => candidate.orderId === captured.orderId);
    assert.ok(ticket !== undefined, `ticket for the order: ${JSON.stringify(tickets).slice(0, 600)}`);
    const lines = (ticket.modifiers as Record<string, unknown>[]).map((modifier) => modifier.name);
    assert.deepEqual(lines, ["Mitad A: Armada", "Mitad B: Hawaiana", "Mitad A: + Queso"]);
    context.check("kds_ticket_shows_armada_half");
    return { halfCheeseMinor, productPriceMinor };
  });
}
