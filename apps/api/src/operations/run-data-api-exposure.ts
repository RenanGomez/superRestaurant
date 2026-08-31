import {
  formatDataApiExposureFailure,
  readDataApiExposureConfig,
} from "./data-api-exposure-config.js";
import { exposeAppDataApi } from "./data-api-exposure.js";

try {
  const config = readDataApiExposureConfig(process.env, process.argv.slice(2));
  const result = await exposeAppDataApi({ config });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error: unknown) {
  process.stderr.write(`${formatDataApiExposureFailure(error)}\n`);
  process.exitCode = 1;
}
