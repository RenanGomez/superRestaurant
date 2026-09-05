const { existsSync } = require("node:fs");
const path = require("node:path");

const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..", "..");
const config = getDefaultConfig(projectRoot);

// pnpm workspace: watch the repository root so the linked workspace packages
// are part of the build. Hierarchical lookup stays enabled on purpose: pnpm
// stores each package's own dependencies next to it inside the store, and
// disabling it would hide them from Metro.
config.watchFolders = [workspaceRoot];

// Sources in this repository import sibling modules with the explicit ".js"
// specifier the shared TypeScript style uses. Metro resolves real files, so map
// a relative ".js" request back to the ".ts"/".tsx" source when it exists.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const candidate = path.resolve(path.dirname(context.originModulePath), moduleName.slice(0, -3));
    for (const extension of [".ts", ".tsx"]) {
      if (existsSync(candidate + extension)) {
        return context.resolveRequest(context, `${moduleName.slice(0, -3)}${extension}`, platform);
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
