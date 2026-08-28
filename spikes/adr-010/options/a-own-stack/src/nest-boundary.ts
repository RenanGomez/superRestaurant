import { Inject, Injectable, Module, type DynamicModule } from "@nestjs/common";

import type { CreateOrderInput, OrderRecord } from "../../../src/model.js";
import type { OwnStackPostgresAdr010Adapter } from "./adapter.js";

export const OWN_STACK_ADR010_CRITICAL_WRITE_PORT = Symbol("OWN_STACK_ADR010_CRITICAL_WRITE_PORT");

/** The server must derive this principal; browser, mobile and KDS never receive a database credential. */
export interface OwnStackAuthenticatedPrincipal {
  readonly sessionId: string;
  readonly restaurantId: string;
  readonly branchId: string;
}

@Injectable()
export class OwnStackCriticalOrderService {
  public constructor(@Inject(OWN_STACK_ADR010_CRITICAL_WRITE_PORT) private readonly writes: Pick<OwnStackPostgresAdr010Adapter, "createOrder">) {}

  public createOrder(principal: OwnStackAuthenticatedPrincipal, input: Omit<CreateOrderInput, "sessionId">): Promise<OrderRecord> {
    if (principal.restaurantId !== input.scope.restaurantId || principal.branchId !== input.scope.branchId) {
      throw new Error("UNAUTHORIZED_SCOPE");
    }
    return this.writes.createOrder({ ...input, sessionId: principal.sessionId });
  }
}

@Module({})
export class OwnStackAdr010Module {
  public static register(adapter: OwnStackPostgresAdr010Adapter): DynamicModule {
    return {
      module: OwnStackAdr010Module,
      providers: [OwnStackCriticalOrderService, { provide: OWN_STACK_ADR010_CRITICAL_WRITE_PORT, useValue: adapter }],
      exports: [OwnStackCriticalOrderService],
    };
  }
}
