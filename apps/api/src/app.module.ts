import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import {
  AUTH_PRINCIPAL_VERIFIER,
  SupabaseAuthGuard,
  SupabaseAuthPrincipalVerifier,
} from "./auth/authentication.js";
import {
  MEMBERSHIP_LOOKUP,
  MembershipAuthorizationService,
} from "./auth/membership-authorization.js";
import { PostgresMembershipLookup } from "./auth/postgres-membership-lookup.js";
import {
  MEMBERSHIP_DIRECTORY,
  PostgresMembershipDirectory,
} from "./auth/membership-directory.js";
import { BranchAccessController } from "./access.controller.js";
import { BranchOperationalContextController } from "./branch-operational-context.controller.js";
import {
  BRANCH_OPERATIONAL_CONTEXT_PORT,
  PostgresBranchOperationalContext,
} from "./branch-operational-context.js";
import { AccessMembershipsController } from "./access-memberships.controller.js";
import { readApiConfig } from "./config.js";
import { DATABASE_CLIENT, PostgresDatabaseClient, readDatabaseConfig } from "./database.js";
import { HealthController } from "./health.controller.js";
import { CapturesController } from "./captures.controller.js";
import { CustomerDirectoryController } from "./customer-directory.controller.js";
import { CustomerOrderHistoryController } from "./customer-order-history.controller.js";
import {
  CUSTOMER_DIRECTORY_READER_PORT, CUSTOMER_DIRECTORY_WRITER_PORT,
  CustomerDirectoryQueryService, CustomerDirectoryService,
  PostgresCustomerDirectoryReader, PostgresCustomerDirectoryWriter,
} from "./customer-directory.js";
import {
  CUSTOMER_ORDER_HISTORY_PORT,
  CUSTOMER_ORDER_REPEAT_SOURCE_PORT,
  CUSTOMER_ORDER_REPEAT_CAPTURE_PORT,
  CustomerOrderHistoryService,
  CustomerOrderRepeatPreviewService,
  CustomerOrderRepeatCaptureService,
  PostgresCustomerOrderHistory,
  PostgresCustomerOrderRepeatCapture,
} from "./customer-order-history.js";
import { CAPTURE_ASSIGNMENT_DIRECTORY_PORT, CAPTURE_ATTENTION_PORT, CAPTURE_CONFIRMATION_PORT, CAPTURE_CREATION_PORT, CAPTURE_CUSTOMER_PORT, CAPTURE_DELIVERY_INSTRUCTIONS_PORT, CAPTURE_FULFILLMENT_PORT, CAPTURE_SELECTION_PLAN_PORT, CAPTURE_TRAY_PORT, CaptureAssignmentDirectoryService, CaptureConfirmationService, CaptureCustomerService, CaptureDeliveryInstructionsService, CaptureFulfillmentService, CaptureAttentionService, CaptureSelectionPlanService, CaptureService, CaptureTrayService, PostgresCaptureCreator } from "./captures.js";
import { SessionController } from "./session.controller.js";
import { DiningZonesController } from "./dining-zones.controller.js";
import {
  DINING_ZONE_CREATOR,
  DiningZoneService,
  PostgresDiningZoneCreator,
} from "./dining-zones.js";
import { DiningTablesController } from "./dining-tables.controller.js";
import { DINING_TABLE_PORT, DiningTableService, PostgresDiningTableAdapter } from "./dining-tables.js";
import { MenuCatalogController } from "./menu-catalog.controller.js";
import { MENU_CATALOG_PORT, MenuCatalogService, PostgresMenuCatalogAdapter } from "./menu-catalog.js";
import { OrdersController } from "./orders.controller.js";
import {
  ORDER_PERSISTENCE_PORT,
  OrderService,
  PostgresOrderPersistenceAdapter,
  REALTIME_NOTIFICATION_PORT,
} from "./orders.js";
import { RealtimeGateway } from "./realtime.gateway.js";
import { PaymentsController } from "./payments.controller.js";
import {
  FINANCIAL_PERSISTENCE_PORT,
  FinancialService,
  PostgresFinancialPersistenceAdapter,
} from "./payments.js";
import { OperationalShiftsController } from "./operational-shifts.controller.js";
import {
  OPERATIONAL_SHIFT_DIRECTORY,
  OperationalShiftService,
  PostgresOperationalShiftDirectory,
} from "./operational-shifts.js";
import { TableOrderContextController } from "./table-order-context.controller.js";
import {
  PostgresTableOrderContextDirectory,
  TABLE_ORDER_CONTEXT_DIRECTORY,
  TableOrderContextService,
} from "./table-order-context.js";
import { SystemOnboardingController } from "./system-onboarding.controller.js";
import { SYSTEM_ONBOARDING_AUTH, SystemOnboardingService, createSystemOnboardingAuth } from "./system-onboarding.js";
import { OperationalWorkTrayController } from "./operational-work-tray.controller.js";
import {
  OPERATIONAL_WORK_TRAY_PORT,
  OperationalWorkTrayService,
  PostgresOperationalWorkTray,
} from "./operational-work-tray.js";
import { DeliveryZonesController } from "./delivery-zones.controller.js";
import {
  DELIVERY_ZONE_LIST_PORT,
  DELIVERY_ZONE_QUOTE_FACTS_PORT,
  DELIVERY_ZONE_UPSERT_PORT,
  DeliveryZoneService,
  PostgresDeliveryZoneStore,
} from "./delivery-zones.js";
import { SERVER_CLOCK_PORT, SystemClock } from "./clock.js";

@Module({
  controllers: [
    HealthController,
    CapturesController,
    CustomerDirectoryController,
    CustomerOrderHistoryController,
    SessionController,
    BranchAccessController,
    BranchOperationalContextController,
    AccessMembershipsController,
    DiningZonesController,
    DiningTablesController,
    MenuCatalogController,
    OrdersController,
    PaymentsController,
    OperationalShiftsController,
    TableOrderContextController,
    OperationalWorkTrayController,
    SystemOnboardingController,
    DeliveryZonesController,
  ],
  providers: [
    {
      provide: AUTH_PRINCIPAL_VERIFIER,
      useFactory: () => new SupabaseAuthPrincipalVerifier(readApiConfig(process.env)),
    },
    {
      provide: DATABASE_CLIENT,
      useFactory: () => new PostgresDatabaseClient(readDatabaseConfig(process.env)),
    },
    PostgresMembershipLookup,
    PostgresMembershipDirectory,
    {
      provide: MEMBERSHIP_LOOKUP,
      useExisting: PostgresMembershipLookup,
    },
    {
      provide: MEMBERSHIP_DIRECTORY,
      useExisting: PostgresMembershipDirectory,
    },
    MembershipAuthorizationService,
    PostgresCaptureCreator,
    { provide: CAPTURE_CREATION_PORT, useExisting: PostgresCaptureCreator },
    CaptureService,
    { provide: CAPTURE_ATTENTION_PORT, useExisting: PostgresCaptureCreator },
    CaptureAttentionService,
    { provide: CAPTURE_CUSTOMER_PORT, useExisting: PostgresCaptureCreator },
    CaptureCustomerService,
    { provide: CAPTURE_FULFILLMENT_PORT, useExisting: PostgresCaptureCreator },
    CaptureFulfillmentService,
    { provide: CAPTURE_DELIVERY_INSTRUCTIONS_PORT, useExisting: PostgresCaptureCreator },
    CaptureDeliveryInstructionsService,
    { provide: CAPTURE_CONFIRMATION_PORT, useExisting: PostgresCaptureCreator },
    CaptureConfirmationService,
    { provide: CAPTURE_SELECTION_PLAN_PORT, useExisting: PostgresCaptureCreator },
    CaptureSelectionPlanService,
    { provide: CAPTURE_TRAY_PORT, useExisting: PostgresCaptureCreator },
    CaptureTrayService,
    { provide: CAPTURE_ASSIGNMENT_DIRECTORY_PORT, useExisting: PostgresCaptureCreator },
    CaptureAssignmentDirectoryService,
    PostgresCustomerDirectoryWriter,
    { provide: CUSTOMER_DIRECTORY_WRITER_PORT, useExisting: PostgresCustomerDirectoryWriter },
    CustomerDirectoryService,
    PostgresCustomerDirectoryReader,
    { provide: CUSTOMER_DIRECTORY_READER_PORT, useExisting: PostgresCustomerDirectoryReader },
    CustomerDirectoryQueryService,
    PostgresCustomerOrderHistory,
    { provide: CUSTOMER_ORDER_HISTORY_PORT, useExisting: PostgresCustomerOrderHistory },
    { provide: CUSTOMER_ORDER_REPEAT_SOURCE_PORT, useExisting: PostgresCustomerOrderHistory },
    PostgresCustomerOrderRepeatCapture,
    { provide: CUSTOMER_ORDER_REPEAT_CAPTURE_PORT, useExisting: PostgresCustomerOrderRepeatCapture },
    CustomerOrderHistoryService,
    CustomerOrderRepeatPreviewService,
    CustomerOrderRepeatCaptureService,
    PostgresBranchOperationalContext,
    { provide: BRANCH_OPERATIONAL_CONTEXT_PORT, useExisting: PostgresBranchOperationalContext },
    PostgresDiningZoneCreator,
    {
      provide: DINING_ZONE_CREATOR,
      useExisting: PostgresDiningZoneCreator,
    },
    DiningZoneService,
    PostgresDiningTableAdapter,
    { provide: DINING_TABLE_PORT, useExisting: PostgresDiningTableAdapter },
    DiningTableService,
    PostgresMenuCatalogAdapter,
    { provide: MENU_CATALOG_PORT, useExisting: PostgresMenuCatalogAdapter },
    MenuCatalogService,
    PostgresOrderPersistenceAdapter,
    { provide: ORDER_PERSISTENCE_PORT, useExisting: PostgresOrderPersistenceAdapter },
    RealtimeGateway,
    { provide: REALTIME_NOTIFICATION_PORT, useExisting: RealtimeGateway },
    OrderService,
    PostgresFinancialPersistenceAdapter,
    { provide: FINANCIAL_PERSISTENCE_PORT, useExisting: PostgresFinancialPersistenceAdapter },
    FinancialService,
    PostgresOperationalShiftDirectory,
    { provide: OPERATIONAL_SHIFT_DIRECTORY, useExisting: PostgresOperationalShiftDirectory },
    OperationalShiftService,
    PostgresTableOrderContextDirectory,
    { provide: TABLE_ORDER_CONTEXT_DIRECTORY, useExisting: PostgresTableOrderContextDirectory },
    TableOrderContextService,
    PostgresOperationalWorkTray,
    { provide: OPERATIONAL_WORK_TRAY_PORT, useExisting: PostgresOperationalWorkTray },
    OperationalWorkTrayService,
    { provide: SERVER_CLOCK_PORT, useClass: SystemClock },
    PostgresDeliveryZoneStore,
    { provide: DELIVERY_ZONE_LIST_PORT, useExisting: PostgresDeliveryZoneStore },
    { provide: DELIVERY_ZONE_UPSERT_PORT, useExisting: PostgresDeliveryZoneStore },
    { provide: DELIVERY_ZONE_QUOTE_FACTS_PORT, useExisting: PostgresDeliveryZoneStore },
    DeliveryZoneService,
    { provide: SYSTEM_ONBOARDING_AUTH, useFactory: () => createSystemOnboardingAuth(process.env) },
    SystemOnboardingService,
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
  ],
})
export class AppModule {}
