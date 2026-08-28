import { runCommonGates } from "../../../src/index.js";
import { OwnStackPostgresAdr010Adapter } from "./adapter.js";
import { requireOwnStackIntegrationOptIn } from "./config.js";

const adapter = new OwnStackPostgresAdr010Adapter(requireOwnStackIntegrationOptIn(process.env));
try {
  const report = await runCommonGates(adapter);
  // issueSession is a test double, so this can never be a product-Auth GO.
  console.log(JSON.stringify({
    ...report,
    evidence: {
      verifiedAgainstPostgres: ["isolation", "transaction", "idempotency", "realtime-recovery", "migration", "backup-restore"],
      notDemonstrated: ["login", "refresh", "authenticated-principal-derivation", "product-session-revocation", "secrets-client-build-inspection"],
    },
    eligibleForAdr010Go: false,
  }));
  console.error("ADR-010 option A remains NO-GO: the spike session is not product Auth and the write frontier still requires human inspection.");
  process.exitCode = 2;
} finally {
  await adapter.close();
}
