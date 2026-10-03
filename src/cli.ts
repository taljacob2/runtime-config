#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { RuntimeConfig } from "./index.js";

const USAGE = `Usage: runtime-config template <definition> [--export <name>] [--out <file>]

Prints the template a deployment fills in - every setting holding its
environment variable's placeholder - for any build tool (the Vite plugin
does this by itself).

  <definition>     The module that defines the config with runtimeConfig():
                   a .js/.mjs file, or .ts on a Node that runs TypeScript.
  --export <name>  Which export is the config, when the module has several.
  --out <file>     Write the template there instead of printing it. Fails if
                   the real config file sits next to it (it would be shipped).

Options:
  -h, --help       Show this help.
  -v, --version    Show the version.`;

class UsageError extends Error {}

async function main(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      export: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  const [command, definition, ...rest] = positionals;
  if (command !== "template") {
    throw new UsageError(command === undefined ? "No command given." : `Unknown command "${command}".`);
  }
  if (definition === undefined) {
    throw new UsageError("template needs the module that defines the config.");
  }
  if (rest.length > 0) {
    throw new UsageError(`Unexpected arguments: ${rest.join(" ")}`);
  }

  const config = await importConfig(definition, values.export);
  const template = config.template();

  if (values.out === undefined) {
    process.stdout.write(template);
    return;
  }

  const out = resolve(values.out);
  const real = out.endsWith(".template") ? out.slice(0, -".template".length) : undefined;
  if (real !== undefined && existsSync(real)) {
    throw new Error(`${real} exists next to the template, so it would be shipped - and a deployment that forgot to set its own would quietly run on it. Remove it.`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, template);
  process.stdout.write(`runtime-config: wrote ${out}\n`);
}

async function importConfig(definition: string, exportName: string | undefined): Promise<RuntimeConfig<string>> {
  const file = resolve(definition);
  if (!existsSync(file)) {
    throw new Error(`${file} does not exist.`);
  }

  let module: Record<string, unknown>;
  try {
    module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_UNKNOWN_FILE_EXTENSION") {
      throw new Error(`This Node (${process.version}) can't load ${file} - point at the built .js, or use a Node that runs TypeScript (22.18 or later).`);
    }
    throw new Error(`Loading ${file} failed: ${(error as Error).message}`);
  }

  if (exportName !== undefined) {
    const chosen = module[exportName];
    if (!isRuntimeConfig(chosen)) {
      throw new Error(`${file} has no runtimeConfig() export named "${exportName}" - its exports: ${Object.keys(module).join(", ") || "none"}.`);
    }
    return chosen;
  }

  const found = Object.entries(module).filter(([, value]) => isRuntimeConfig(value));
  const [first, second] = found;
  if (first === undefined) {
    throw new Error(`${file} exports no runtimeConfig() result - its exports: ${Object.keys(module).join(", ") || "none"}.`);
  }
  if (second !== undefined) {
    throw new Error(`${file} exports several configs (${found.map(([name]) => name).join(", ")}) - choose one with --export.`);
  }
  return first[1] as RuntimeConfig<string>;
}

function isRuntimeConfig(value: unknown): value is RuntimeConfig<string> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RuntimeConfig<string>>;
  return typeof candidate.template === "function" && typeof candidate.envVarOf === "function" && Array.isArray(candidate.settings);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`runtime-config: ${error.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  // parseArgs' own errors (an unknown option, a missing value) are usage errors too.
  const code = (error as { code?: string }).code;
  if (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS")) {
    process.stderr.write(`runtime-config: ${(error as Error).message}\n\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  process.stderr.write(`runtime-config: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
