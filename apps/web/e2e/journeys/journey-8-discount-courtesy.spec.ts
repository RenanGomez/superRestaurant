import { beforeJourney, test } from "../fixtures/journey-test.ts";

test("journey 8: aplicar descuento/cortesía con autorización", async ({}, testInfo) => {
  beforeJourney(testInfo);
  // Deferred, never a silent pass or a guessed interaction: the authorized discount/courtesy
  // command (`orders.discount.apply` in the RBAC policy, its API/SQL flow and the order control)
  // is still being built in `m1-cov-discounts-courtesies`. This spec owns journey 8 and turns on
  // when that item delivers the real control; until then it skips with the explicit reason.
  test.skip(true, "Journey 8 diferido: el descuento/cortesía con autorización depende de m1-cov-discounts-courtesies (permiso orders.discount.apply y su control en la orden)");
});
