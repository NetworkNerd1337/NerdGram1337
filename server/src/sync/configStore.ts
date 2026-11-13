import fs from "node:fs/promises";
import { BRANCH } from "./constants.js";
import { configPath, writePrivateFile } from "./layout.js";

export type SyncConfig = {
  version: 1;
  enabled: boolean;
  clientId: string | null;
  login: string | null;
  owner: string | null;
  repo: string | null;
  private: boolean;
  htmlUrl: string | null;
  remoteUrl: string | null;
  branch: string;
  lastSyncAt: string | null;
  lastPushedOid: string | null;
  ahead: number;
  behind: number;
};

export function emptyConfig(): SyncConfig {
  return {
    version: 1,
    enabled: false,
    clientId: null,
    login: null,
    owner: null,
    repo: null,
    private: true,
    htmlUrl: null,
    remoteUrl: null,
    branch: BRANCH,
    lastSyncAt: null,
    lastPushedOid: null,
    ahead: 0,
    behind: 0,
  };
}

export async function loadConfig(): Promise<SyncConfig> {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    const config = emptyConfig();
    config.enabled = parsed.enabled === true;
    config.clientId = typeof parsed.clientId === "string" ? parsed.clientId : null;
    config.login = typeof parsed.login === "string" ? parsed.login : null;
    config.owner = typeof parsed.owner === "string" ? parsed.owner : null;
    config.repo = typeof parsed.repo === "string" ? parsed.repo : null;
    config.private = parsed.private !== false;
    config.htmlUrl = typeof parsed.htmlUrl === "string" ? parsed.htmlUrl : null;
    config.remoteUrl = typeof parsed.remoteUrl === "string" ? parsed.remoteUrl : null;
    config.branch = typeof parsed.branch === "string" && parsed.branch ? parsed.branch : BRANCH;
    config.lastSyncAt = typeof parsed.lastSyncAt === "string" ? parsed.lastSyncAt : null;
    config.lastPushedOid = typeof parsed.lastPushedOid === "string" ? parsed.lastPushedOid : null;
    config.ahead = typeof parsed.ahead === "number" ? parsed.ahead : 0;
    config.behind = typeof parsed.behind === "number" ? parsed.behind : 0;
    if (configContainsSecret(raw)) {
      throw new Error("GitHub sync config is damaged");
    }
    return config;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyConfig();
    if (err instanceof SyntaxError) return emptyConfig();
    throw err;
  }
}

export async function saveConfig(config: SyncConfig): Promise<void> {
  const body = `${JSON.stringify(config, null, 2)}\n`;
  if (configContainsSecret(body)) {
    throw new Error("Refusing to store a token in GitHub sync config");
  }
  await writePrivateFile(configPath(), body);
}

function configContainsSecret(body: string): boolean {
  return /"(token|access_token|device_code|client_secret)"\s*:/i.test(body) || /ghp_[A-Za-z0-9]/.test(body);
}

export function clientIdOf(config: SyncConfig): { id: string | null; source: "env" | "config" | null } {
  const fromEnv = process.env.NERDGRAM_GITHUB_CLIENT_ID?.trim();
  if (fromEnv) return { id: fromEnv, source: "env" };
  if (config.clientId) return { id: config.clientId, source: "config" };
  return { id: null, source: null };
}
