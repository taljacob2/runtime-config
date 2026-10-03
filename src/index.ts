import { envVarName } from "./naming.js";

export { envVarName } from "./naming.js";

/** The settings' values: every setting present, each the text it was given. */
export type ConfigValues<K extends string> = Readonly<Record<K, string>>;

export interface RuntimeConfigOptions<K extends string> {
  /**
   * Where the app fetches its settings when it starts: a path on its own server
   * (`"/config.json"`), or an absolute `http(s)://` address. A path must start
   * with `/`, so a page opened at a deep link still finds it.
   */
  path: string;
  /**
   * Put before each setting's name to make its environment variable:
   * `"MYAPP_"` + `apiBaseUrl` -> `MYAPP_API_BASE_URL`. Capitals, digits and `_`,
   * ending with `_`; or `""` for no prefix.
   */
  envPrefix: string;
  /**
   * The settings' names, camelCase. Every one is required, and each value is
   * text, exactly as given - converting and judging values is `check`'s job.
   */
  settings: readonly K[];
  /**
   * The project's own checks, run once every setting is present. Return one
   * sentence per problem; they are reported together with the library's own,
   * before the app starts.
   */
  check?: (values: ConfigValues<K>) => readonly string[];
  /** How long `load()` waits for the file before giving up loudly. Default 10000. */
  timeoutMs?: number;
}

export interface RuntimeConfig<K extends string> {
  readonly path: string;
  readonly envPrefix: string;
  readonly settings: readonly K[];
  /** The environment variable a setting is filled from. */
  envVarOf(setting: K): string;
  /** The file a deployment fills in: every setting holding its environment variable's placeholder. */
  template(): string;
  /**
   * Fetches the file and checks it. Resolves with the values (also available from
   * `get()` from then on), or rejects with a `ConfigError` listing every problem.
   */
  load(): Promise<ConfigValues<K>>;
  /**
   * Takes values that are already at hand - from your own server, or in tests -
   * through the same checks as `load()`, and makes them the loaded values.
   */
  provide(input: unknown): ConfigValues<K>;
  /** Checks values without keeping them. Throws a `ConfigError` listing every problem. */
  parse(input: unknown, source?: string): ConfigValues<K>;
  /** The loaded values. Throws if neither `load()` nor `provide()` has finished. */
  get(): ConfigValues<K>;
}

/** Every problem found, all at once - one per line of the message. */
export class ConfigError extends Error {
  /** What was being read: the file's path, "environment variables", ... */
  readonly source: string;
  readonly problems: readonly string[];

  constructor(source: string, problems: readonly string[]) {
    super(`${source}:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
    this.source = source;
    this.problems = Object.freeze([...problems]);
  }
}

const SETTING_NAME = /^[a-z][A-Za-z0-9]*$/;
const ENV_PREFIX = /^(?:[A-Z][A-Z0-9_]*_)?$/;
const PLACEHOLDER = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Defines the settings an app reads when it starts, rather than when it is built.
 *
 * @example
 * export const config = runtimeConfig({
 *   path: "/config.json",
 *   envPrefix: "MYAPP_",
 *   settings: ["apiBaseUrl"],
 * });
 *
 * const { apiBaseUrl } = await config.load();
 */
export function runtimeConfig<const K extends string>(options: RuntimeConfigOptions<K>): RuntimeConfig<K> {
  const { path, envPrefix, check } = options;
  const settings = Object.freeze([...options.settings]);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assertDefinition(path, envPrefix, settings, timeoutMs);

  const envVarOf = (setting: K): string => envVarName(envPrefix, setting);
  let loaded: ConfigValues<K> | undefined;

  const parse = (input: unknown, source: string = path): ConfigValues<K> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new ConfigError(source, [`must be one JSON object: { "setting": "value", ... } - got ${describe(input)}`]);
    }
    const given = input as Record<string, unknown>;
    const problems: string[] = [];
    const values = {} as Record<K, string>;

    for (const setting of settings) {
      const envVar = envVarOf(setting);
      if (!Object.hasOwn(given, setting)) {
        problems.push(`"${setting}" is missing (its environment variable is ${envVar})`);
        continue;
      }
      const value = given[setting];
      if (typeof value !== "string") {
        problems.push(`"${setting}" must be text - got ${describe(value)}`);
        continue;
      }
      const placeholder = PLACEHOLDER.exec(value);
      if (placeholder) {
        problems.push(`"${setting}" still holds the placeholder ${placeholder[0]} - set ${envVar}`);
        continue;
      }
      if (value.trim() === "") {
        problems.push(`"${setting}" is empty - set ${envVar}`);
        continue;
      }
      values[setting] = value;
    }
    const everySettingUsable = problems.length === 0;

    for (const key of Object.keys(given)) {
      if (!(settings as readonly string[]).includes(key)) {
        problems.push(`"${key}" is not a setting of this app - its settings are: ${settings.join(", ")}`);
      }
    }

    // The project's checks see a complete set of values, or none at all. An extra,
    // unknown key doesn't stop them - its problem and theirs are reported together.
    if (everySettingUsable && check) {
      problems.push(...check(values));
    }

    if (problems.length > 0) {
      throw new ConfigError(source, problems);
    }
    return Object.freeze(values);
  };

  return Object.freeze({
    path,
    envPrefix,
    settings,
    envVarOf,

    template() {
      const entries = settings.map((setting) => [setting, `\${${envVarOf(setting)}}`] as const);
      return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
    },

    async load() {
      loaded = parse(await fetchJson(path, timeoutMs));
      return loaded;
    },

    provide(input: unknown) {
      loaded = parse(input, "provided values");
      return loaded;
    },

    parse,

    get() {
      if (!loaded) {
        throw new Error(`The settings from ${path} were read before load() finished - something ran too early.`);
      }
      return loaded;
    },
  });
}

export interface ShowConfigErrorOptions {
  /** The element whose content is replaced by the message. Default `document.body`. */
  into?: Element;
  /** The first line. Default "This app can't start - its settings are missing or wrong." */
  title?: string;
}

/**
 * Puts an error on the page with plain DOM - no framework, nothing else that
 * could fail. A blank page tells nobody anything.
 */
export function showConfigError(error: unknown, options: ShowConfigErrorOptions = {}): void {
  const into = options.into ?? document.body;
  const title = options.title ?? "This app can't start - its settings are missing or wrong.";
  const message = error instanceof Error ? error.message : String(error);

  const box = document.createElement("pre");
  box.setAttribute("role", "alert");
  box.dataset["runtimeConfigError"] = "";
  box.style.cssText = [
    "box-sizing:border-box",
    "max-width:60rem",
    "margin:2rem auto",
    "padding:1rem 1.25rem",
    "white-space:pre-wrap",
    "overflow-wrap:anywhere",
    "font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
    "color:#7a0016",
    "background:#fff5f6",
    "border:2px solid #b00020",
    "border-radius:6px",
  ].join(";");
  // textContent, never innerHTML: the message can quote whatever the file held.
  box.textContent = `${title}\n\n${message}`;
  into.replaceChildren(box);
}

/** The definition is checked as it is written - a mistake here is the developer's, not the deployment's. */
function assertDefinition(path: string, envPrefix: string, settings: readonly string[], timeoutMs: number): void {
  const problems: string[] = [];

  if (!path.startsWith("/") && !isHttpUrl(path)) {
    problems.push(`path must start with "/" (so a page opened at a deep link still finds it), or be an http(s) address - got "${path}"`);
  }
  if (!ENV_PREFIX.test(envPrefix)) {
    problems.push(`envPrefix must be capitals, digits and _, ending with _ (or "" for none) - got "${envPrefix}"`);
  }
  if (settings.length === 0) {
    problems.push("settings is empty - name at least one");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    problems.push(`timeoutMs must be a positive number - got ${timeoutMs}`);
  }

  const owners = new Map<string, string>();
  for (const setting of settings) {
    if (!SETTING_NAME.test(setting)) {
      problems.push(`setting "${setting}" must be camelCase: a lowercase letter, then letters and digits`);
      continue;
    }
    const envVar = envVarName(envPrefix, setting);
    const owner = owners.get(envVar);
    if (owner !== undefined) {
      problems.push(
        owner === setting
          ? `setting "${setting}" is listed twice`
          : `settings "${owner}" and "${setting}" would both be filled from ${envVar}`,
      );
    }
    owners.set(envVar, setting);
  }

  if (problems.length > 0) {
    throw new ConfigError("runtimeConfig() definition", problems);
  }
}

async function fetchJson(path: string, timeoutMs: number): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? `no answer within ${timeoutMs / 1000} s`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new ConfigError(path, [`the file could not be fetched: ${reason}`]);
  }

  const text = await response.text();
  const isWebPage = text.trimStart().startsWith("<");

  if (!response.ok) {
    const answered = `the server answered ${response.status} ${response.statusText}`.trimEnd();
    const explanation = !isWebPage && text.trim() !== "" ? text.trim().slice(0, 500) : undefined;
    if (explanation !== undefined) {
      throw new ConfigError(path, [`${answered}\n  ${explanation.replace(/\n/g, "\n  ")}`]);
    }
    const hint = response.status === 404 ? ` - the file isn't there. Create it from ${templateNameOf(path)}` : "";
    throw new ConfigError(path, [answered + hint]);
  }
  if (isWebPage) {
    // A server that answers unknown paths with the app's index.html (as single-page
    // apps are usually served) says 200 for a file that isn't there.
    throw new ConfigError(path, [`the file is missing - the server sent a web page in its place. Create it from ${templateNameOf(path)}`]);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ConfigError(path, [`the file is not valid JSON: ${(error as Error).message}`]);
  }
}

function templateNameOf(path: string): string {
  const name = path.split("?")[0]?.split("/").pop() ?? path;
  return `${name}.template`;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** A short, safe rendering of any value for a message. */
function describe(value: unknown): string {
  if (value === undefined) return "nothing";
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  const shown = json === undefined ? `a ${typeof value}` : json.length > 80 ? `${json.slice(0, 77)}...` : json;
  return Array.isArray(value) ? `a list: ${shown}` : shown;
}
