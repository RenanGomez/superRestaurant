import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { captureAndConfirm, ok, openShiftAndRegister, publishCatalog, record, sendOrderToKitchen } from "./http-flow-support.js";
import { runHttpFlow } from "./http-test-harness.js";

const marker = "LOCAL_HTTP_FLOW_ONLY";
const sizePriceMinor = 18_000;
const hawaiianPriceMinor = 20_000;
const extraCheeseMinor = 1_501;
// Rules under test: the dearer flavor prices the whole pizza; an extra on one half costs half, rounded up.
const halfExtraMinor = Math.ceil(extraCheeseMinor / 2);
const expectedLineMinor = hawaiianPriceMinor + halfExtraMinor;

/** Half-and-half: line quote and selection plan agree on price, and the kitchen ticket reads each half apart. */
export async function halvesFlow(): Promise<void> {
  await runHttpFlow({ databasePrefix: "superrestaurant_http_halves", marker, stage: "http_flow_halves" }, async (context) => {
    const { scope } = context;
    const categoryId = randomUUID();
    const productId = randomUUID();
    const variantId = randomUUID();
    const flavorGroupId = randomUUID();
    const extraGroupId = randomUUID();
    const pepperoniId = randomUUID();
    const hawaiianId = randomUUID();
    const cheeseId = randomUUID();
    const { catalogVersion } = await publishCatalog(context, {
      categories: [{ categoryId, name: "Pizzas", active: true, displayOrder: 0 }],
      products: [{ productId, categoryId, name: "Pizza", sku: "PIZ-001", active: true, displayOrder: 0, stationId: "kitchen", unit: "piece",
        unitPriceMinor: 15_000, tax: null, imagePath: null,
        variants: [{ variantId, name: "Grande", sku: null, active: true, displayOrder: 0, unitPriceMinor: sizePriceMinor,
          fraction: { enabled: true, flavorGroupId, extraGroupId, excludableIngredientIds: ["cebolla"] } }] }],
      modifierGroups: [
        { groupId: flavorGroupId, productId, name: "Sabores", active: true, displayOrder: 0, minimumQuantity: 0, maximumQuantity: 2,
          options: [
            { optionId: pepperoniId, name: "Pepperoni", unitPriceMinor: 0, active: true, imagePath: null, maximumQuantity: null },
            { optionId: hawaiianId, name: "Hawaiana", unitPriceMinor: hawaiianPriceMinor, active: true, imagePath: null, maximumQuantity: null },
          ] },
        { groupId: extraGroupId, productId, name: "Extras", active: true, displayOrder: 1, minimumQuantity: 0, maximumQuantity: 5,
          options: [{ optionId: cheeseId, name: "Queso extra", unitPriceMinor: extraCheeseMinor, active: true, imagePath: null, maximumQuantity: null }] },
      ],
    });
    const register = await openShiftAndRegister(context, 0);
    const fraction = { geometry: "halves", slots: [
      { fraction: "half-a", flavorOptionId: pepperoniId, extraOptionIds: [cheeseId], excludedIngredientIds: ["cebolla"] },
      { fraction: "half-b", flavorOptionId: hawaiianId, extraOptionIds: [], excludedIngredientIds: [] },
    ] };

    const quote = ok(await context.send("cashier", "POST", "/captures/line-quote", { schemaVersion: 1, scope, catalogVersion, productId, variantId,
      modifierGroups: [], fraction, quantity: 1 }), "line_quote");
    assert.equal(quote.geometry, "halves");
    assert.equal(quote.lineTotalMinor, expectedLineMinor);
    assert.deepEqual((quote.fractionBreakdown as Record<string, unknown>[]).map((half) => [half.fraction, half.flavorName, half.amountMinor]),
      [["half-a", "Pepperoni", sizePriceMinor], ["half-b", "Hawaiana", hawaiianPriceMinor]]);
    context.check("line_quote_greater_flavor_plus_half_extra_ceil");

    const captured = await captureAndConfirm(context, { catalogVersion, shiftId: register.shiftId,
      lines: [{ lineId: randomUUID(), productId, variantId, quantity: 1, fraction }] });
    const projection = record(captured.workspace.selectionProjection);
    assert.equal(projection.itemsTotalMinor, quote.lineTotalMinor);
    assert.equal(record((projection.lines as unknown[])[0]).lineTotalMinor, quote.lineTotalMinor);
    context.check("selection_plan_projection_matches_line_quote");

    const detail = await sendOrderToKitchen(context, captured.orderId);
    const item = record((detail.items as unknown[])[0]);
    assert.equal(item.geometry, "halves");
    const tickets = ok(await context.send("manager", "GET", `/kds/tickets${context.query({ ...scope, stationId: "kitchen" })}`), "kds_tickets");
    const ticket = (tickets.tickets as Record<string, unknown>[]).find((candidate) => candidate.orderId === captured.orderId);
    assert.ok(ticket !== undefined, `ticket for the order: ${JSON.stringify(tickets).slice(0, 600)}`);
    const lines = (ticket.modifiers as Record<string, unknown>[]).map((modifier) => modifier.name);
    assert.deepEqual(lines, ["Mitad A: Pepperoni", "Mitad B: Hawaiana", "Mitad A: + Queso extra", "Mitad A: Sin cebolla"]);
    context.check("kds_ticket_shows_mitad_a_and_b");
    return { expectedLineMinor, halfExtraMinor };
  });
}
