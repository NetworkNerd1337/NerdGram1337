#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintDiagramSource } from "./mermaidSyntax.js";
import { closeRenderer, renderDiagram, type RenderFormat } from "./renderDiagram.js";

/**
 * `nerdgram` talks to a local NerdGram server, except `render` and `lint`
 * of a file that is already on disk. Those run in this process.
 *
 * NERDGRAM_URL defaults to http://127.0.0.1:8787. NERDGRAM_TOKEN is the
 * automation token from Settings. Flags win over the environment.
 */

type Io = {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  env: NodeJS.ProcessEnv;
};

type Parsed = {
  command: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
};

const BOOL_FLAGS = new Set(["json", "server", "strict", "help", "h", "no-update-links"]);

const HELP = `nerdgram — automation client for NerdGram1337

Usage
  nerdgram render <file|path> -o out.svg|png
  nerdgram list [folder]
  nerdgram search <query>
  nerdgram get <path> [-o file]
  nerdgram put <path> <file>
  nerdgram export <folder> -o dir/
  nerdgram lint [path|file] [--strict]
  nerdgram generate --path Diagram.mmd --data data.csv
  nerdgram generate --path Diagram.mmd --data neighbors.lldp --format lldp --local-device edge-sw
  nerdgram refresh <path> [--data data.csv]

A local .mmd file is rendered and linted in this process. Anything else uses
NERDGRAM_URL (default http://127.0.0.1:8787) and NERDGRAM_TOKEN.
--url and --token override those. --json prints one JSON object.
--server forces render to use the API. Exit status is 1 on errors.
`;

class CliError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function parseArgs(argv: string[]): Parsed {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  let command = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const rawName = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const name = rawName === "o" ? "output" : rawName;
      if (BOOL_FLAGS.has(rawName) && eq === -1) {
        flags.set(name, true);
        continue;
      }
      const value = eq === -1 ? argv[index + 1] : arg.slice(eq + 1);
      if (eq === -1) index += 1;
      if (value == null || value.startsWith("-")) throw new CliError(`Missing value for --${rawName}`);
      flags.set(name, BOOL_FLAGS.has(rawName) ? value !== "false" : value);
      continue;
    }
    if (arg === "-h") {
      flags.set("help", true);
      continue;
    }
    if (arg === "-o") {
      const value = argv[index + 1];
      index += 1;
      if (value == null || value.startsWith("-")) throw new CliError("Missing value for -o");
      flags.set("output", value);
      continue;
    }
    if (!command) command = arg;
    else positionals.push(arg);
  }
  return { command, positionals, flags };
}

function flagString(flags: Parsed["flags"], name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function isJson(flags: Parsed["flags"]): boolean {
  return flags.get("json") === true;
}

function writeOut(io: Io, json: boolean, payload: Record<string, unknown>, human: string): void {
  if (json) io.stdout(`${JSON.stringify({ ok: true, ...payload })}\n`);
  else io.stdout(human.endsWith("\n") ? human : `${human}\n`);
}

function configOf(flags: Parsed["flags"], env: NodeJS.ProcessEnv): { base: string; token: string } {
  const base = (flagString(flags, "url") ?? env.NERDGRAM_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
  const token = flagString(flags, "token") ?? env.NERDGRAM_TOKEN ?? "";
  return { base, token };
}

function requireToken(token: string): string {
  if (!token.trim()) throw new CliError("Set NERDGRAM_TOKEN or pass --token.");
  return token.trim();
}

async function callApi(
  base: string,
  token: string,
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; bytes: Buffer; contentType: string }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || method !== "GET") headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${base}${apiPath}`, {
      method,
      headers,
      body: body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(`Could not reach ${base}. ${message}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  let json: unknown = undefined;
  if (contentType.includes("json") || (!contentType.includes("image/") && bytes.length > 0 && bytes[0] === 0x7b)) {
    try {
      json = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      json = undefined;
    }
  }
  if (!response.ok) {
    const record = json && typeof json === "object" ? (json as { error?: unknown }) : {};
    const message = typeof record.error === "string" ? record.error : `Request failed (${response.status})`;
    throw new CliError(message, response.status);
  }
  return { status: response.status, json, bytes, contentType };
}

function formatOf(output: string): RenderFormat {
  const lower = output.toLowerCase();
  if (lower.endsWith(".svg")) return "svg";
  if (lower.endsWith(".png")) return "png";
  throw new CliError("The output file must end in .svg or .png.");
}

async function pathExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function renderCommand(parsed: Parsed, io: Io): Promise<void> {
  const target = parsed.positionals[0];
  const output = flagString(parsed.flags, "output");
  if (!target) throw new CliError("render needs a file or a workspace path.");
  if (!output) throw new CliError("render needs -o out.svg or -o out.png.");
  const format = formatOf(output);
  const local = !parsed.flags.get("server") && (await pathExists(target));
  let bytes: Buffer;
  if (local) {
    const source = await fs.readFile(target, "utf8");
    const rendered = await renderDiagram({ source, format });
    bytes = rendered.body;
  } else {
    const { base, token } = configOf(parsed.flags, io.env);
    const result = await callApi(base, requireToken(token), "POST", "/api/v1/render", { path: target, format });
    bytes = result.bytes;
  }
  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await fs.writeFile(output, bytes);
  writeOut(io, isJson(parsed.flags), { output, format, bytes: bytes.length, offline: local }, `Wrote ${output}`);
}

async function listCommand(parsed: Parsed, io: Io): Promise<void> {
  const { base, token } = configOf(parsed.flags, io.env);
  const folder = parsed.positionals[0] ?? "";
  const result = await callApi(base, requireToken(token), "GET", `/api/v1/diagrams?path=${encodeURIComponent(folder)}`);
  const body = result.json as { path?: string; folders?: { path: string }[]; files?: { path: string }[] };
  const lines = [
    ...(body.folders ?? []).map((item) => `${item.path}/`),
    ...(body.files ?? []).map((item) => item.path),
  ];
  writeOut(io, isJson(parsed.flags), { path: body.path ?? folder, folders: body.folders ?? [], files: body.files ?? [] }, lines.join("\n") || "(empty)");
}

async function searchCommand(parsed: Parsed, io: Io): Promise<void> {
  const query = parsed.positionals.join(" ").trim();
  if (!query) throw new CliError("search needs a query.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "GET", `/api/v1/search?q=${encodeURIComponent(query)}`);
  const body = result.json as { hits?: { path: string; line: number | null; snippet: string }[] };
  const lines = (body.hits ?? []).map((hit) => `${hit.path}:${hit.line ?? 1}: ${hit.snippet}`);
  writeOut(io, isJson(parsed.flags), { query, hits: body.hits ?? [] }, lines.join("\n") || "(no matches)");
}

async function getCommand(parsed: Parsed, io: Io): Promise<void> {
  const itemPath = parsed.positionals[0];
  if (!itemPath) throw new CliError("get needs a workspace path.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "GET", `/api/v1/diagrams/content?path=${encodeURIComponent(itemPath)}`);
  const body = result.json as { path: string; content: string; hash: string; mtimeMs: number };
  const output = flagString(parsed.flags, "output");
  if (output) {
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.writeFile(output, body.content, "utf8");
  }
  writeOut(
    io,
    isJson(parsed.flags),
    { path: body.path, hash: body.hash, mtimeMs: body.mtimeMs, content: body.content, output: output ?? null },
    output ? `Wrote ${output}` : body.content,
  );
}

async function putCommand(parsed: Parsed, io: Io): Promise<void> {
  const itemPath = parsed.positionals[0];
  const file = parsed.positionals[1];
  if (!itemPath || !file) throw new CliError("put needs a workspace path and a local file.");
  const content = await fs.readFile(file, "utf8");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "PUT", "/api/v1/diagrams", { path: itemPath, content, force: true });
  const body = result.json as { path: string; hash?: string };
  writeOut(io, isJson(parsed.flags), { path: body.path, hash: body.hash ?? null }, `Wrote ${body.path}`);
}

async function exportCommand(parsed: Parsed, io: Io): Promise<void> {
  const folder = parsed.positionals[0] ?? "";
  const output = flagString(parsed.flags, "output");
  if (!output) throw new CliError("export needs -o directory.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "GET", `/api/v1/export?path=${encodeURIComponent(folder)}`);
  const body = result.json as { files?: { path: string; content: string }[] };
  const root = path.resolve(output);
  await fs.mkdir(root, { recursive: true });
  let count = 0;
  for (const file of body.files ?? []) {
    const destination = path.resolve(root, file.path);
    const relative = path.relative(root, destination);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new CliError(`Refusing to write ${file.path}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.content, "utf8");
    count += 1;
  }
  writeOut(io, isJson(parsed.flags), { path: folder, output, count }, `Exported ${count} diagram${count === 1 ? "" : "s"} to ${output}`);
}

async function lintCommand(parsed: Parsed, io: Io): Promise<number> {
  const target = parsed.positionals[0] ?? flagString(parsed.flags, "source");
  const strict = parsed.flags.get("strict") === true;
  let diagnostics: { severity: string; line: number; message: string; ruleId: string }[];
  let label = target ?? "(workspace)";
  if (target && (flagString(parsed.flags, "source") || (await pathExists(target)))) {
    const source = await fs.readFile(target, "utf8");
    diagnostics = await lintDiagramSource(source, { sourcePath: target });
    label = target;
  } else {
    const { base, token } = configOf(parsed.flags, io.env);
    const apiPath = target ? `/api/v1/lint?path=${encodeURIComponent(target)}` : "/api/v1/lint";
    const result = await callApi(base, requireToken(token), "GET", apiPath);
    const body = result.json as {
      diagnostics?: { severity: string; line: number; message: string; ruleId: string }[];
      diagrams?: { path: string; diagnostics: { severity: string; line: number; message: string; ruleId: string }[] }[];
      checked?: number;
    };
    if (body.diagrams) {
      diagnostics = body.diagrams.flatMap((diagram) =>
        diagram.diagnostics.map((item) => ({ ...item, message: `${diagram.path}: ${item.message}` })),
      );
      writeOut(
        io,
        isJson(parsed.flags),
        { checked: body.checked ?? 0, diagrams: body.diagrams },
        diagnostics.map((item) => `${item.ruleId}: ${item.message}`).join("\n") || `Checked ${body.checked ?? 0} diagrams.`,
      );
      const failed = body.diagrams.some((diagram) =>
        diagram.diagnostics.some((item) => item.severity === "error" || (strict && diagram.diagnostics.length > 0)),
      );
      return failed ? 1 : 0;
    }
    diagnostics = body.diagnostics ?? [];
  }
  const lines = diagnostics.map((item) => `${label}:${item.line}: ${item.severity}: ${item.ruleId}: ${item.message}`);
  writeOut(io, isJson(parsed.flags), { path: label, diagnostics }, lines.join("\n") || "No problems.");
  const failed = diagnostics.some((item) => item.severity === "error" || (strict && diagnostics.length > 0));
  return failed ? 1 : 0;
}

async function generateCommand(parsed: Parsed, io: Io): Promise<void> {
  const diagramPath = flagString(parsed.flags, "path") ?? parsed.positionals[0];
  const dataFile = flagString(parsed.flags, "data");
  if (!diagramPath || !dataFile) {
    throw new CliError("generate needs --path Diagram.mmd and --data file.csv, file.json, file.cdp, or file.lldp.");
  }
  const text = await fs.readFile(dataFile, "utf8");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "POST", "/api/v1/generate", {
    path: diagramPath,
    text,
    format: flagString(parsed.flags, "format"),
    shape: flagString(parsed.flags, "shape"),
    direction: flagString(parsed.flags, "direction"),
    title: flagString(parsed.flags, "title"),
    localDevice: flagString(parsed.flags, "local-device"),
    groupBy: flagString(parsed.flags, "group-by"),
  });
  const body = result.json as { path: string; dataPath?: string; counts?: unknown };
  writeOut(io, isJson(parsed.flags), body, `Created ${body.path}${body.dataPath ? ` from ${body.dataPath}` : ""}`);
}

async function refreshCommand(parsed: Parsed, io: Io): Promise<void> {
  const diagramPath = parsed.positionals[0] ?? flagString(parsed.flags, "path");
  if (!diagramPath) throw new CliError("refresh needs a diagram path.");
  const dataFile = flagString(parsed.flags, "data");
  const text = dataFile ? await fs.readFile(dataFile, "utf8") : undefined;
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "POST", "/api/v1/generate/refresh", {
    path: diagramPath,
    text,
    save: true,
    writeData: text != null,
  });
  const body = result.json as { path: string; saved?: boolean; diff?: unknown };
  writeOut(io, isJson(parsed.flags), body, `Refreshed ${body.path}`);
}

export async function main(argv: string[], io: Partial<Io> = {}): Promise<number> {
  const streams: Io = {
    stdout: io.stdout ?? ((chunk) => process.stdout.write(chunk)),
    stderr: io.stderr ?? ((chunk) => process.stderr.write(chunk)),
    env: io.env ?? process.env,
  };
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    streams.stderr(`${message}\n`);
    return 1;
  }
  if (parsed.flags.get("help") === true || parsed.command === "help" || parsed.command === "") {
    streams.stdout(HELP);
    return parsed.command === "" && parsed.flags.get("help") !== true && parsed.positionals.length === 0 ? 0 : 0;
  }
  try {
    switch (parsed.command) {
      case "render":
        await renderCommand(parsed, streams);
        return 0;
      case "list":
        await listCommand(parsed, streams);
        return 0;
      case "search":
        await searchCommand(parsed, streams);
        return 0;
      case "get":
        await getCommand(parsed, streams);
        return 0;
      case "put":
        await putCommand(parsed, streams);
        return 0;
      case "export":
        await exportCommand(parsed, streams);
        return 0;
      case "lint":
        return await lintCommand(parsed, streams);
      case "generate":
        await generateCommand(parsed, streams);
        return 0;
      case "refresh":
        await refreshCommand(parsed, streams);
        return 0;
      default:
        throw new CliError(`Unknown command ${parsed.command}. Run nerdgram --help.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof CliError ? err.status : undefined;
    if (isJson(parsed.flags)) streams.stdout(`${JSON.stringify({ ok: false, error: message, status: status ?? null })}\n`);
    else streams.stderr(`${message}\n`);
    return 1;
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const invoked = path.resolve(entry);
  const self = fileURLToPath(import.meta.url);
  return invoked === self || invoked.endsWith(`${path.sep}cli.ts`) || invoked.endsWith(`${path.sep}cli.js`);
}

if (isDirectRun()) {
  main(process.argv.slice(2))
    .then(async (code) => {
      await closeRenderer();
      process.exit(code);
    })
    .catch(async (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      await closeRenderer().catch(() => undefined);
      process.exit(1);
    });
}
