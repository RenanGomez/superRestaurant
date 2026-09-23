import {
  formatTenancyFixtureRecoveryFailure,
  readTenancyFixtureRecoveryConfig,
} from "./tenancy-fixture-recovery-config.js";
import { executeCaptureContinuitySmokeRecovery } from "./capture-continuity-smoke-recovery.js";

try {
  const config = readTenancyFixtureRecoveryConfig(process.env, process.argv.slice(2));
  const result = await executeCaptureContinuitySmokeRecovery(config);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error: unknown) {
  process.stderr.write(`${formatTenancyFixtureRecoveryFailure(error)}\n`);
  process.exitCode = 1;
}
