import { cleanCli, cleanSentinel, clipIssue, promptHost } from "./clean.js";
import { finalizeNeighbors, normalizeCapability, platformOf } from "./normalize.js";
import type { NeighborParseOptions, NeighborParseResult, NeighborParser, RawNeighbor, RowIssue } from "./types.js";
import { MAX_NEIGHBOR_BLOCKS } from "./types.js";

/**
 * Cisco IOS, IOS-XE, and NX-OS `show cdp neighbors detail`.
 * The three CLIs share Device ID / Platform / Interface / Port ID blocks.
 */

type CdpBag = {
  line: number;
  deviceId: string;
  platform: string;
  capability: string;
  localPort: string;
  remotePort: string;
  version: string;
  readingVersion: boolean;
};

function emptyBag(line: number): CdpBag {
  return {
    line,
    deviceId: "",
    platform: "",
    capability: "",
    localPort: "",
    remotePort: "",
    version: "",
    readingVersion: false,
  };
}

function parseCdpNeighbors(text: string, options: NeighborParseOptions = {}): NeighborParseResult {
  const cleaned = cleanCli(text);
  if (/local intrfce/i.test(cleaned) && !/port id \(outgoing port\)/i.test(cleaned)) {
    return {
      parserId: "cisco-cdp",
      links: [],
      warnings: [],
      errors: [
        {
          row: 1,
          message: "This is the short CDP table. Paste show cdp neighbors detail.",
        },
      ],
    };
  }

  const raw: RawNeighbor[] = [];
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const preferred: string[] = [];
  let localDevice = cleanSentinel(options.localDevice ?? "");
  if (localDevice) preferred.push(localDevice);
  let bag: CdpBag | null = null;
  let count = 0;

  const flush = () => {
    if (!bag) return;
    const current = bag;
    bag = null;
    if (!current.deviceId && !current.localPort && !current.remotePort) return;
    count += 1;
    if (count > MAX_NEIGHBOR_BLOCKS) return;
    const remote = cleanSentinel(current.deviceId).replace(/\(([A-Za-z0-9_-]{4,})\)\s*$/, "").trim();
    const localPort = cleanSentinel(current.localPort);
    const remotePort = cleanSentinel(current.remotePort);
    const missing: string[] = [];
    if (!localDevice) missing.push("local device");
    if (!localPort) missing.push("local interface");
    if (!remote) missing.push("remote device");
    if (!remotePort) missing.push("remote port");
    if (missing.length > 0) {
      const who = remote ? ` "${clipIssue(remote)}"` : "";
      errors.push({
        row: current.line,
        message: `Line ${current.line}: CDP neighbor${who} is missing ${missing.join(" and ")}.`,
      });
      return;
    }
    raw.push({
      line: current.line,
      localDevice,
      localPort,
      remoteDevice: remote,
      remotePort,
      remotePlatform: platformOf(current.version, current.platform),
      remoteCapability: normalizeCapability(current.capability),
    });
  };

  const lines = cleaned.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (count > MAX_NEIGHBOR_BLOCKS) break;
    const lineNo = index + 1;
    const trimmed = (lines[index] ?? "").trim();
    if (!trimmed) {
      if (bag?.readingVersion) bag.readingVersion = false;
      continue;
    }
    if (/^[-=*_]{5,}$/.test(trimmed)) {
      flush();
      continue;
    }
    const host = promptHost(trimmed);
    if (host) {
      flush();
      localDevice = host;
      preferred.push(host);
      continue;
    }
    const device = /^Device ID\s*:\s*(.*)$/i.exec(trimmed);
    if (device) {
      if (bag?.deviceId) flush();
      bag = emptyBag(lineNo);
      bag.deviceId = device[1]?.trim() ?? "";
      continue;
    }
    if (!bag) continue;
    const platform = /^Platform\s*:\s*(.*)$/i.exec(trimmed);
    if (platform) {
      bag.readingVersion = false;
      const value = platform[1] ?? "";
      const caps = /^(.*?)\s*,\s*Capabilities\s*:\s*(.*)$/i.exec(value);
      if (caps) {
        bag.platform = caps[1]?.trim() ?? "";
        bag.capability = caps[2]?.trim() ?? "";
      } else {
        bag.platform = value.trim();
      }
      continue;
    }
    const capsOnly = /^Capabilities\s*:\s*(.*)$/i.exec(trimmed);
    if (capsOnly) {
      bag.readingVersion = false;
      bag.capability = capsOnly[1]?.trim() ?? "";
      continue;
    }
    const iface = /^Interface\s*:\s*(.*)$/i.exec(trimmed);
    if (iface) {
      bag.readingVersion = false;
      const value = iface[1] ?? "";
      const combined = /^(.*?)\s*,\s*Port ID \(outgoing port\)\s*:\s*(.+)$/i.exec(value);
      if (combined) {
        bag.localPort = combined[1]?.trim() ?? "";
        bag.remotePort = combined[2]?.trim() ?? "";
      } else {
        bag.localPort = value.replace(/,\s*$/, "").trim();
      }
      continue;
    }
    const port = /^Port ID \(outgoing port\)\s*:\s*(.*)$/i.exec(trimmed);
    if (port) {
      bag.readingVersion = false;
      bag.remotePort = port[1]?.trim() ?? "";
      continue;
    }
    if (/^Version\s*:?\s*$/i.test(trimmed) || /^Version\s*:\s*\S/i.test(trimmed)) {
      bag.readingVersion = true;
      const inline = /^Version\s*:\s*(.+)$/i.exec(trimmed);
      if (inline?.[1]) bag.version = inline[1].trim();
      continue;
    }
    if (bag.readingVersion && !/^[A-Za-z][\w ./-]{0,40}:\s/.test(trimmed)) {
      bag.version = bag.version ? `${bag.version} ${trimmed}` : trimmed;
    }
  }
  flush();
  if (count > MAX_NEIGHBOR_BLOCKS) {
    return {
      parserId: "cisco-cdp",
      links: [],
      warnings: [],
      errors: [{ row: 1, message: `A file can have at most ${MAX_NEIGHBOR_BLOCKS} neighbor blocks.` }],
    };
  }
  return finalizeNeighbors(
    "cisco-cdp",
    raw,
    errors,
    warnings,
    preferred,
    "No CDP neighbors were found. Paste show cdp neighbors detail.",
  );
}

export const ciscoCdpParser: NeighborParser = {
  id: "cisco-cdp",
  kind: "cdp",
  label: "Cisco CDP (IOS, IOS-XE, NX-OS)",
  parse: parseCdpNeighbors,
};

export { parseCdpNeighbors };
