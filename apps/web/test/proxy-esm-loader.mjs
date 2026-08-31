import { registerHooks } from "node:module";

const compiledRoot = new URL("../.test-dist/", import.meta.url).href;
const supabaseDouble = new URL(
  "../.test-dist/test-doubles/supabase-ssr.js",
  import.meta.url,
).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }
    if (specifier === "@supabase/ssr") {
      return nextResolve(supabaseDouble, context);
    }

    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const isCompiledRelativeImport = context.parentURL?.startsWith(compiledRoot) === true
        && (specifier.startsWith("./") || specifier.startsWith("../"))
        && !/\.[A-Za-z0-9]+$/u.test(specifier);
      if (isCompiledRelativeImport) {
        return nextResolve(`${specifier}.js`, context);
      }
      throw error;
    }
  },
});
