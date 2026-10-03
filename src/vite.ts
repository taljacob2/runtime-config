import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import type { RuntimeConfig } from "./index.js";

export interface RuntimeConfigPluginOptions {
  /**
   * The local file `vite` (dev) and `vite preview` serve at the config's path,
   * relative to the project root. Keep it out of git and out of `public/`.
   * Default `"config.dev.json"`.
   */
  devFile?: string;
}

/**
 * - **`vite` and `vite preview`**: serve the config's path from a local file,
 *   so development goes through the same loader and the same errors as a real
 *   deployment. A missing file answers 404 with what to put in it.
 * - **`vite build`**: refuses to ship a real config file (from `public/` or any
 *   plugin), and ships the template instead - `config.json.template` for
 *   `config.json` - for a deployment to fill in.
 *
 * @example
 * // vite.config.ts
 * import { runtimeConfigPlugin } from "@taljacob2/runtime-config/vite";
 * import { config } from "./src/config";
 *
 * export default defineConfig({ plugins: [runtimeConfigPlugin(config)] });
 */
export function runtimeConfigPlugin(config: RuntimeConfig<string>, options: RuntimeConfigPluginOptions = {}): Plugin {
  const devFile = options.devFile ?? "config.dev.json";

  if (!config.path.startsWith("/")) {
    throw new Error(
      `runtimeConfigPlugin: the config's path "${config.path}" is on another server - ` +
        "the plugin only serves and ships a path on this app's own server.",
    );
  }

  let resolved: ResolvedConfig;
  let fileName: string;

  const serveDevFile = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (req.url?.split("?")[0] !== config.path) {
      next();
      return;
    }
    const file = resolve(resolved.root, devFile);
    res.setHeader("Cache-Control", "no-store");
    if (!existsSync(file)) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`${devFile} is missing - create it in ${resolved.root}, with a real value for each setting:\n${config.template()}`);
      return;
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(readFileSync(file));
  };

  return {
    name: "runtime-config",

    configResolved(resolvedConfig) {
      resolved = resolvedConfig;
      // Built files sit under outDir without the base: "/app/config.json" with base "/app/" is "config.json".
      const base = resolvedConfig.base.startsWith("/") ? resolvedConfig.base : "/";
      fileName = config.path.startsWith(base) ? config.path.slice(base.length) : config.path.slice(1);
    },

    // Added directly rather than returned, so they answer before Vite's own page fallback.
    configureServer(server) {
      server.middlewares.use(serveDevFile);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveDevFile);
    },

    buildStart() {
      if (resolved.command !== "build" || !resolved.publicDir) return;
      if (existsSync(resolve(resolved.publicDir, fileName))) {
        this.error(
          `${fileName} is in ${resolved.publicDir}, so it would be shipped - and a deployment that ` +
            `forgot to set its own would quietly run on it. Remove it; the build ships ${fileName}.template instead.`,
        );
      }
      const devFilePath = resolve(resolved.root, devFile);
      const fromPublic = relative(resolved.publicDir, devFilePath);
      if (!fromPublic.startsWith("..") && !isAbsolute(fromPublic)) {
        this.error(`The dev file ${devFile} is inside ${resolved.publicDir}, so it would be shipped. Keep it outside public/.`);
      }
    },

    generateBundle(_options, bundle) {
      if (bundle[fileName]) {
        this.error(`Something in this build emits ${fileName} - only ${fileName}.template may be shipped.`);
      }
      this.emitFile({ type: "asset", fileName: `${fileName}.template`, source: config.template() });
    },
  };
}
