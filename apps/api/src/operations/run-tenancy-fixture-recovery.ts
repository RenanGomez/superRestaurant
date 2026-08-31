import {
  formatTenancyFixtureRecoveryFailure,
  readTenancyFixtureRecoveryConfig,
} from "./tenancy-fixture-recovery-config.js";
import { executeTenancyFixtureRecovery } from "./tenancy-fixture-recovery.js";

async function main(): Promise<void> {
  try {
    const config = readTenancyFixtureRecoveryConfig(process.env, process.argv.slice(2));
    const result = await executeTenancyFixtureRecovery(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error: unknown) {
    process.stderr.write(`${formatTenancyFixtureRecoveryFailure(error)}\n`);
    process.exitCode = 1;
  }
}

await main();
