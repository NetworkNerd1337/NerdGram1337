#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderFormat } from "./renderDiagram.js";

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

const BOOL_FLAGS = new Set([
  "json",
  "server",
  "strict",
  "help",
  "h",
  "no-update-links",
  "dry-run",
  "apply",
  "copy-data",
  "share-data",
  "with-data",
  "keep-data",
]);

const HELP = `nerdgram — automation client for NerdGram1337

Usage
  nerdgram render <file|path> -o out.svg|png
  nerdgram list [folder]
  nerdgram search <query>
  nerdgram get <path> [-o file]
  nerdgram put <path> <file>
  nerdgram export <folder> -o dir/
  nerdgram lint [path|file] [--strict]
  nerdgram rename <from> <to>
  nerdgram move <from> [folder]
  nerdgram duplicate <path> (--copy-data | --share-data)
  nerdgram delete <path> (--with-data | --keep-data)
  nerdgram repair-links [--dry-run] [--apply]
  nerdgram generate --path Diagram.mmd --data data.csv
  nerdgram generate --path Diagram.mmd --data neighbors.lldp --format lldp --local-device edge-sw
  nerdgram refresh <path> [--data data.csv]

A local .mmd file is rendered and linted in this process. Anything else uses
NERDGRAM_URL (default http://127.0.0.1:8787) and NERDGRAM_TOKEN.
--url and --token override those. --json prints one JSON object.
--server forces render to use the API. Exit status is 1 on errors.
Rename and move also move a CSV, JSON, CDP, or LLDP file that sits next to the
diagram and update nerdgram.source. duplicate --copy-data gives the copy its
own data file. duplicate --share-data keeps both diagrams on the original file.
delete --with-data moves that file to the trash with the diagram.
delete --keep-data leaves it in the workspace. When a data file is present and
the flag is omitted, duplicate and delete stop and list the file.
repair-links previews click repairs after a rename or move made outside the
app. --dry-run is the default and writes nothing. --apply saves the previewed
rewrites. If the data file moved with that diagram, the same confirmation
updates nerdgram.source. An ambiguous match is listed and left unchanged.
`;

type RenderModule = typeof import("./renderDiagram.js");

let renderModule: Promise<RenderModule> | null = null;

function loadRender(): Promise<RenderModule> {
  renderModule ??= import("./renderDiagram.js");
  return renderModule;
}

async function loadLint(): Promise<typeof import("./mermaidSyntax.js")> {
  return import("./mermaidSyntax.js");
}

export async function shutdownCli(): Promise<void> {
  if (!renderModule) return;
  const { closeRenderer } = await renderModule;
  await closeRenderer();
}

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
    const { renderDiagram } = await loadRender();
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
    const { lintDiagramSource } = await loadLint();
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

async function repairLinksCommand(parsed: Parsed, io: Io): Promise<void> {
  const apply = parsed.flags.get("apply") === true && parsed.flags.get("dry-run") !== true;
  const { base, token } = configOf(parsed.flags, io.env);
  const result = apply
    ? await callApi(base, requireToken(token), "POST", "/api/v1/link-repairs", { dryRun: false, confirm: true })
    : await callApi(base, requireToken(token), "GET", "/api/v1/link-repairs");
  const body = result.json as {
    suggestions?: { from: string; to: string | null; match: string; candidates: string[] }[];
    changes?: { path: string; links: { line: number; target: string; next: string }[] }[];
    dataFiles?: { diagram: string; from: string; to: string }[];
    applied?: boolean;
    saved?: string[];
  };
  const lines: string[] = [];
  for (const change of body.changes ?? []) {
    lines.push(change.path);
    for (const link of change.links) lines.push(`  line ${link.line}: ${link.target} -> ${link.next}`);
  }
  const ambiguous = (body.suggestions ?? []).filter((item) => item.to == null || item.match === "ambiguous");
  for (const dataFile of body.dataFiles ?? []) {
    lines.push(`${dataFile.diagram}: ${dataFile.from} -> ${dataFile.to}`);
  }
  if (ambiguous.length > 0) {
    lines.push("Ambiguous, not changed:");
    for (const item of ambiguous) lines.push(`  ${item.from} matches ${item.candidates.join(", ")}`);
  }
  if (lines.length === 0) lines.push("No link repairs.");
  else if (!apply) lines.push("Nothing was written. Run nerdgram repair-links --apply to update these files.");
  else if ((body.saved ?? []).length > 0) lines.push(`Updated ${(body.saved ?? []).join(", ")}`);
  else lines.push("No files needed a rewrite.");
  writeOut(
    io,
    isJson(parsed.flags),
    {
      applied: body.applied === true,
      saved: body.saved ?? [],
      suggestions: body.suggestions ?? [],
      changes: body.changes ?? [],
      dataFiles: body.dataFiles ?? [],
    },
    lines.join("\n"),
  );
}

async function renameCommand(parsed: Parsed, io: Io): Promise<void> {
  const from = parsed.positionals[0];
  const to = parsed.positionals[1];
  if (!from || !to) throw new CliError("rename needs the current path and the new path.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "POST", "/api/v1/diagrams/rename", {
    from,
    to,
    updateLinks: parsed.flags.get("no-update-links") !== true,
  });
  const body = result.json as { path?: string; dataFiles?: { to: string }[] };
  const moved = (body.dataFiles ?? []).map((item) => item.to).join(", ");
  writeOut(io, isJson(parsed.flags), body, moved ? `Renamed ${body.path}. Data file ${moved}.` : `Renamed ${body.path}`);
}

async function moveCommand(parsed: Parsed, io: Io): Promise<void> {
  const from = parsed.positionals[0];
  if (!from) throw new CliError("move needs the diagram or folder to move.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "POST", "/api/v1/diagrams/move", {
    from,
    toFolder: parsed.positionals[1] ?? "",
    updateLinks: parsed.flags.get("no-update-links") !== true,
  });
  const body = result.json as { path?: string; dataFiles?: { to: string }[] };
  const moved = (body.dataFiles ?? []).map((item) => item.to).join(", ");
  writeOut(io, isJson(parsed.flags), body, moved ? `Moved to ${body.path}. Data file ${moved}.` : `Moved to ${body.path}`);
}

async function duplicateCommand(parsed: Parsed, io: Io): Promise<void> {
  const itemPath = parsed.positionals[0];
  if (!itemPath) throw new CliError("duplicate needs a diagram or folder path.");
  const copyData = parsed.flags.get("copy-data") === true;
  const shareData = parsed.flags.get("share-data") === true;
  if (copyData && shareData) throw new CliError("Pass either --copy-data or --share-data.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "POST", "/api/v1/diagrams/duplicate", {
    path: itemPath,
    ...(copyData ? { copyData: true } : {}),
    ...(shareData ? { copyData: false } : {}),
  });
  const body = result.json as { path?: string; dataFiles?: { to: string }[] };
  const copied = (body.dataFiles ?? []).map((item) => item.to).join(", ");
  const human = copied
    ? `Duplicated as ${body.path}. Data file ${copied}.`
    : shareData
      ? `Duplicated as ${body.path}. It shares the original data file.`
      : `Duplicated as ${body.path}`;
  writeOut(io, isJson(parsed.flags), body, human);
}

async function deleteCommand(parsed: Parsed, io: Io): Promise<void> {
  const itemPath = parsed.positionals[0];
  if (!itemPath) throw new CliError("delete needs a diagram or folder path.");
  const withData = parsed.flags.get("with-data") === true;
  const keepData = parsed.flags.get("keep-data") === true;
  if (withData && keepData) throw new CliError("Pass either --with-data or --keep-data.");
  const { base, token } = configOf(parsed.flags, io.env);
  const result = await callApi(base, requireToken(token), "DELETE", "/api/v1/diagrams", {
    path: itemPath,
    confirmLinks: true,
    ...(withData ? { deleteData: true } : {}),
    ...(keepData ? { deleteData: false } : {}),
  });
  const body = result.json as { path?: string; trashed?: boolean };
  writeOut(io, isJson(parsed.flags), body, `Moved ${body.path ?? itemPath} to the trash.`);
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
      case "repair-links":
        await repairLinksCommand(parsed, streams);
        return 0;
      case "rename":
        await renameCommand(parsed, streams);
        return 0;
      case "move":
        await moveCommand(parsed, streams);
        return 0;
      case "duplicate":
        await duplicateCommand(parsed, streams);
        return 0;
      case "delete":
        await deleteCommand(parsed, streams);
        return 0;
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
      await shutdownCli();
      process.exit(code);
    })
    .catch(async (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      await shutdownCli().catch(() => undefined);
      process.exit(1);
    });
}
