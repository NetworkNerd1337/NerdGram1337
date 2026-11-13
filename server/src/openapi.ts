import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const serverPackage = require("../package.json") as { version: string };

export type V1Method = "get" | "post" | "put" | "delete";
export type V1Scope = "public" | "read" | "write";

export type V1Route = {
  method: V1Method;
  /** Path on the `/api/v1` router. */
  path: string;
  scope: V1Scope;
  operationId: string;
  summary: string;
  tag: string;
};

/**
 * Source of truth for `/api/v1` routes and the OpenAPI document.
 * `mountAutomationApi` registers one handler per entry.
 */
export const V1_ROUTES: readonly V1Route[] = [
  {
    method: "get",
    path: "/openapi.json",
    scope: "public",
    operationId: "getOpenApi",
    summary: "OpenAPI document for this API.",
    tag: "Meta",
  },
  {
    method: "get",
    path: "/diagrams",
    scope: "read",
    operationId: "listDiagrams",
    summary: "List folders and diagrams in one folder.",
    tag: "Diagrams",
  },
  {
    method: "get",
    path: "/search",
    scope: "read",
    operationId: "searchDiagrams",
    summary: "Search diagram names and text.",
    tag: "Diagrams",
  },
  {
    method: "get",
    path: "/diagrams/content",
    scope: "read",
    operationId: "getDiagram",
    summary: "Read one diagram's source and metadata.",
    tag: "Diagrams",
  },
  {
    method: "post",
    path: "/diagrams",
    scope: "write",
    operationId: "createDiagram",
    summary: "Create a diagram. Fails if the path already exists.",
    tag: "Diagrams",
  },
  {
    method: "put",
    path: "/diagrams",
    scope: "write",
    operationId: "updateDiagram",
    summary: "Create or overwrite a diagram.",
    tag: "Diagrams",
  },
  {
    method: "post",
    path: "/diagrams/rename",
    scope: "write",
    operationId: "renameDiagram",
    summary: "Rename a diagram or folder and update click links.",
    tag: "Diagrams",
  },
  {
    method: "post",
    path: "/diagrams/move",
    scope: "write",
    operationId: "moveDiagram",
    summary: "Move a diagram or folder and update click links.",
    tag: "Diagrams",
  },
  {
    method: "delete",
    path: "/diagrams",
    scope: "write",
    operationId: "deleteDiagram",
    summary: "Move a diagram or folder to the trash.",
    tag: "Diagrams",
  },
  {
    method: "post",
    path: "/folders",
    scope: "write",
    operationId: "createFolder",
    summary: "Create a folder.",
    tag: "Diagrams",
  },
  {
    method: "get",
    path: "/export",
    scope: "read",
    operationId: "exportDiagrams",
    summary: "Read every diagram under a folder.",
    tag: "Diagrams",
  },
  {
    method: "get",
    path: "/lint",
    scope: "read",
    operationId: "lintWorkspace",
    summary: "Lint one saved diagram, or every diagram when path is omitted.",
    tag: "Lint",
  },
  {
    method: "post",
    path: "/lint",
    scope: "read",
    operationId: "lintSource",
    summary: "Lint Mermaid source that is not necessarily saved.",
    tag: "Lint",
  },
  {
    method: "get",
    path: "/render",
    scope: "read",
    operationId: "renderSavedDiagram",
    summary: "Render a saved diagram to SVG or PNG.",
    tag: "Render",
  },
  {
    method: "post",
    path: "/render",
    scope: "read",
    operationId: "renderDiagram",
    summary: "Render a saved diagram or posted Mermaid source to SVG or PNG.",
    tag: "Render",
  },
  {
    method: "post",
    path: "/generate/preview",
    scope: "read",
    operationId: "previewGenerate",
    summary: "Preview a diagram generated from CSV or JSON. Nothing is written.",
    tag: "Generate",
  },
  {
    method: "post",
    path: "/generate",
    scope: "write",
    operationId: "generateDiagram",
    summary: "Create a diagram from CSV or JSON and store the data file beside it.",
    tag: "Generate",
  },
  {
    method: "post",
    path: "/generate/refresh",
    scope: "write",
    operationId: "refreshDiagram",
    summary: "Refresh the generated block of a diagram from its data file.",
    tag: "Generate",
  },
];

export function openApiPath(route: V1Route): string {
  return `/api/v1${route.path}`;
}

const errorSchema = {
  type: "object",
  properties: {
    error: { type: "string" },
    code: { type: "string" },
  },
  required: ["error"],
};

const pathQuery = {
  name: "path",
  in: "query",
  required: false,
  schema: { type: "string" },
  description: "Workspace path relative to the data directory. Empty is the root.",
};

function jsonBody(description: string, properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return {
    required: true,
    content: {
      "application/json": {
        schema: { type: "object", description, properties, required },
      },
    },
  };
}

function operationBody(operationId: string): Record<string, unknown> | undefined {
  switch (operationId) {
    case "createDiagram":
    case "updateDiagram":
      return jsonBody("Diagram source.", {
        path: { type: "string", description: "Workspace path ending in .mmd." },
        content: { type: "string" },
        force: { type: "boolean", description: "Overwrite an existing file. Update accepts this." },
        expectedHash: { type: "string" },
        expectedMtimeMs: { type: "number" },
      }, ["path", "content"]);
    case "renameDiagram":
      return jsonBody("Rename.", {
        from: { type: "string" },
        to: { type: "string" },
        updateLinks: { type: "boolean", description: "Defaults to true. Rewrites click targets the way the editor does." },
      }, ["from", "to"]);
    case "moveDiagram":
      return jsonBody("Move.", {
        from: { type: "string" },
        toFolder: { type: "string", description: "Empty moves to the workspace root." },
        updateLinks: { type: "boolean" },
      }, ["from"]);
    case "deleteDiagram":
      return jsonBody("Trash.", {
        path: { type: "string" },
        confirmLinks: { type: "boolean", description: "Defaults to true. False returns 409 when other diagrams link here." },
      }, ["path"]);
    case "createFolder":
      return jsonBody("Folder.", { path: { type: "string" } }, ["path"]);
    case "lintSource":
      return jsonBody("Source to lint.", {
        source: { type: "string" },
        sourcePath: { type: "string" },
        diagramPaths: { type: "array", items: { type: "string" } },
        rules: { type: "object", additionalProperties: { type: "boolean" } },
      }, ["source"]);
    case "renderDiagram":
      return jsonBody("What to render. Send path or source.", {
        path: { type: "string" },
        source: { type: "string" },
        format: { type: "string", enum: ["svg", "png"] },
        background: { type: "string", description: "Hex color, such as #ffffff." },
      }, ["format"]);
    case "previewGenerate":
    case "generateDiagram":
      return jsonBody("CSV or JSON table.", {
        text: { type: "string" },
        path: { type: "string", description: "Required for generate. Diagram path ending in .mmd." },
        format: { type: "string", enum: ["csv", "json"] },
        shape: { type: "string" },
        direction: { type: "string", enum: ["TD", "TB", "LR", "RL", "BT"] },
        mapping: { type: "object" },
        grouping: { type: "boolean" },
        title: { type: "string" },
        edgesText: { type: "string" },
        storeData: { type: "boolean" },
      }, ["text"]);
    case "refreshDiagram":
      return jsonBody("Refresh.", {
        path: { type: "string" },
        text: { type: "string", description: "Replacement data. Omitted reads the file named in the front matter." },
        save: { type: "boolean", description: "Write the refreshed diagram. Defaults to false." },
        writeData: { type: "boolean" },
      }, ["path"]);
    default:
      return undefined;
  }
}

function operationParameters(operationId: string): Record<string, unknown>[] {
  switch (operationId) {
    case "listDiagrams":
    case "exportDiagrams":
    case "lintWorkspace":
      return [pathQuery];
    case "getDiagram":
      return [{ ...pathQuery, required: true }];
    case "searchDiagrams":
      return [
        { name: "q", in: "query", required: true, schema: { type: "string" } },
        { name: "names", in: "query", schema: { type: "string", enum: ["0", "1"] } },
        { name: "contents", in: "query", schema: { type: "string", enum: ["0", "1"] } },
        { name: "regex", in: "query", schema: { type: "string", enum: ["0", "1"] } },
      ];
    case "renderSavedDiagram":
      return [
        { ...pathQuery, required: true },
        { name: "format", in: "query", required: true, schema: { type: "string", enum: ["svg", "png"] } },
        { name: "background", in: "query", schema: { type: "string" } },
      ];
    case "deleteDiagram":
      return [{ ...pathQuery, required: false, description: "Path, if not sent in the JSON body." }];
    default:
      return [];
  }
}

export function buildOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of V1_ROUTES) {
    const specPath = openApiPath(route);
    const item = paths[specPath] ?? {};
    const responses: Record<string, unknown> = {
      "200": route.operationId.startsWith("render")
        ? { description: "SVG or PNG bytes." }
        : { description: "Success.", content: { "application/json": { schema: { type: "object" } } } },
      "400": { description: "The request was rejected.", content: { "application/json": { schema: errorSchema } } },
    };
    if (route.scope !== "public") {
      responses["401"] = { description: "Missing, unknown, or revoked token.", content: { "application/json": { schema: errorSchema } } };
    }
    if (route.scope === "write") {
      responses["403"] = { description: "The token is read-only.", content: { "application/json": { schema: errorSchema } } };
      responses["423"] = { description: "An editor lock is held.", content: { "application/json": { schema: errorSchema } } };
    }
    if (route.tag === "Render") {
      responses["429"] = { description: "Render rate limit.", content: { "application/json": { schema: errorSchema } } };
    }
    const operation: Record<string, unknown> = {
      operationId: route.operationId,
      summary: route.summary,
      tags: [route.tag],
      security: route.scope === "public" ? [] : [{ bearerAuth: [] }],
      responses,
    };
    const parameters = operationParameters(route.operationId);
    if (parameters.length > 0) operation.parameters = parameters;
    const requestBody = operationBody(route.operationId);
    if (requestBody) operation.requestBody = requestBody;
    item[route.method] = operation;
    paths[specPath] = item;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "NerdGram1337 automation API",
      version: serverPackage.version,
      description:
        "Versioned API for scripts and CI. Browser routes under /api are unchanged and do not use these tokens. Tokens are created in Settings. Binding stays on loopback unless HOST is set. Publishing the port is unsupported: a token does not protect the browser routes.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Meta" },
      { name: "Diagrams" },
      { name: "Lint" },
      { name: "Render" },
      { name: "Generate" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API token",
          description: "Authorization: Bearer ng_…  Scope is read or read-write. A read-write token can read.",
        },
      },
    },
    paths,
  };
}
