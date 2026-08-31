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
import { AccessMembershipsController } from "./access-memberships.controller.js";
import { readApiConfig } from "./config.js";
import { DATABASE_CLIENT, PostgresDatabaseClient, readDatabaseConfig } from "./database.js";
import { HealthController } from "./health.controller.js";
import { SessionController } from "./session.controller.js";
import { DiningZonesController } from "./dining-zones.controller.js";
import {
  DINING_ZONE_CREATOR,
  DiningZoneService,
  PostgresDiningZoneCreator,
} from "./dining-zones.js";

@Module({
  controllers: [
    HealthController,
    SessionController,
    BranchAccessController,
    AccessMembershipsController,
    DiningZonesController,
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
    PostgresDiningZoneCreator,
    {
      provide: DINING_ZONE_CREATOR,
      useExisting: PostgresDiningZoneCreator,
    },
    DiningZoneService,
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
  ],
})
export class AppModule {}
