import { cleanCli, cleanSentinel, clipIssue, promptHost, stripSubtype } from "./clean.js";
import { finalizeNeighbors, isMacAddress, macOf, normalizeCapability, platformOf } from "./normalize.js";
import type { NeighborParseOptions, NeighborParseResult, NeighborParser, RawNeighbor, RowIssue } from "./types.js";
import { MAX_NEIGHBOR_BLOCKS } from "./types.js";

/**
 * Vendor-agnostic LLDP detail parser.
 *
 * Every vendor prints the same IEEE 802.1AB TLVs under slightly different
 * labels: local port, chassis ID, port ID, port description, system name,
 * system description, system capabilities, and management address. This
 * parser matches those labels, splits neighbor blocks on repeated TLVs and
 * the usual delimiters, and falls back from system name to chassis ID and
 * from a MAC port ID to the port description.
 *
 * Linux `lldpctl` text, `-f keyvalue`, and `-f json` use the same entry point.
 * A vendor quirk belongs in `TWEAKS` or `FIELDS`, not in a new parser.
 */

type Field =
  | "localPort"
  | "chassisId"
  | "portId"
  | "portDescription"
  | "systemName"
  | "systemDescription"
  | "enabledCaps"
  | "supportedCaps"
  | "platform";

type Bag = {
  line: number;
  localPort: string;
  chassisId: string;
  portId: string;
  portDescription: string;
  systemName: string;
  systemDescription: string;
  enabledCaps: string;
  supportedCaps: string;
  platform: string;
  openField: "" | "systemDescription" | "portDescription";
  skippedBlank: boolean;
};

const FIELDS: Record<string, Field> = {
  "local intf": "localPort",
  localintf: "localPort",
  "local interface": "localPort",
  localinterface: "localPort",
  "local port": "localPort",
  localport: "localPort",
  interface: "localPort",
  intf: "localPort",
  "chassis id": "chassisId",
  chassisid: "chassisId",
  "chassis identifier": "chassisId",
  "port id": "portId",
  portid: "portId",
  "port info": "portId",
  portinfo: "portId",
  "port description": "portDescription",
  portdescription: "portDescription",
  "port descr": "portDescription",
  portdescr: "portDescription",
  "port desc": "portDescription",
  portdesc: "portDescription",
  "system name": "systemName",
  systemname: "systemName",
  sysname: "systemName",
  "sys name": "systemName",
  "chassis name": "systemName",
  chassisname: "systemName",
  "device id": "systemName",
  deviceid: "systemName",
  identity: "systemName",
  "system description": "systemDescription",
  systemdescription: "systemDescription",
  "system descr": "systemDescription",
  systemdescr: "systemDescription",
  "system desc": "systemDescription",
  sysdescr: "systemDescription",
  "sys descr": "systemDescription",
  "existing system capabilities": "enabledCaps",
  existingsystemcapabilities: "enabledCaps",
  "enabled capabilities": "enabledCaps",
  enabledcapabilities: "enabledCaps",
  "capabilities enabled": "enabledCaps",
  "enabled caps": "enabledCaps",
  enabledcaps: "enabledCaps",
  "system capabilities enabled": "enabledCaps",
  "system capabilities": "supportedCaps",
  systemcapabilities: "supportedCaps",
  "system caps": "supportedCaps",
  systemcaps: "supportedCaps",
  "capabilities supported": "supportedCaps",
  "capabilities available": "supportedCaps",
  "system capabilities supported": "supportedCaps",
  capabilities: "supportedCaps",
  platform: "platform",
};

const REPEAT = new Set<Field>(["localPort", "chassisId", "portId", "systemName"]);

const PAIR_FIELDS: Record<string, Field> = {
  interface: "localPort",
  "local-interface": "localPort",
  "interface-name": "portId",
  "port-id": "portId",
  portid: "portId",
  identity: "systemName",
  "system-name": "systemName",
  sysname: "systemName",
  "system-description": "systemDescription",
  sysdescr: "systemDescription",
  "mac-address": "chassisId",
  "chassis-id": "chassisId",
  chassisid: "chassisId",
  "port-description": "portDescription",
  portdescr: "portDescription",
  platform: "platform",
};

function emptyBag(line: number): Bag {
  return {
    line,
    localPort: "",
    chassisId: "",
    portId: "",
    portDescription: "",
    systemName: "",
    systemDescription: "",
    enabledCaps: "",
    supportedCaps: "",
    platform: "",
    openField: "",
    skippedBlank: false,
  };
}

function normLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(?:neighbor|neighbour|remote)\s+/, "");
}

function lookupField(label: string): Field | null {
  const norm = normLabel(label);
  if (FIELDS[norm]) return FIELDS[norm];
  const compact = norm.replace(/ /g, "");
  return FIELDS[compact] ?? null;
}

function splitLabel(line: string): { label: string; value: string } | null {
  const trimmed = line.trim().replace(/^[>*•]+\s*/, "").replace(/^-\s+/, "");
  const match = /^([A-Za-z][A-Za-z0-9 ./_+-]{0,48}?)\s*[:=]\s*(.*)$/.exec(trimmed);
  if (!match?.[1]) return null;
  const label = match[1].trim();
  if (label.split(/\s+/).length > 6) return null;
  return { label, value: (match[2] ?? "").trim() };
}

function parsePairs(line: string): { key: string; value: string }[] {
  const pairs: { key: string; value: string }[] = [];
  const pattern = /([A-Za-z][\w-]*)=(?:"([^"]*)"|(\S+))/g;
  let match = pattern.exec(line);
  while (match) {
    pairs.push({ key: (match[1] ?? "").toLowerCase(), value: match[2] ?? match[3] ?? "" });
    match = pattern.exec(line);
  }
  return pairs;
}

function capToken(value: string): string {
  const flagged = /^(.*?)\s*,\s*(on|off|enabled|disabled|yes|no)\s*$/i.exec(value.trim());
  if (flagged?.[2] && /^(?:off|disabled|no)$/i.test(flagged[2])) return "";
  return (flagged?.[1] ?? value).trim();
}

function looksLikeCapability(value: string): boolean {
  return normalizeCapability(value) !== "" || /bridge|router|switch|phone|station|wlan/i.test(value);
}

function clipField(value: string): string {
  return value.length > 500 ? value.slice(0, 500) : value;
}

/** Tweaks that are not a vendor selector. They adjust one field bag. */
const TWEAKS: Array<(bag: Bag) => void> = [
  (bag) => {
    bag.chassisId = cleanSentinel(stripSubtype(bag.chassisId));
    bag.portId = cleanSentinel(stripSubtype(bag.portId));
    bag.portDescription = cleanSentinel(bag.portDescription);
    bag.systemName = cleanSentinel(bag.systemName);
    bag.localPort = cleanSentinel(bag.localPort);
    bag.platform = cleanSentinel(bag.platform);
    bag.systemDescription = cleanSentinel(bag.systemDescription);
  },
];

type Collected = {
  raw: RawNeighbor[];
  errors: RowIssue[];
  warnings: RowIssue[];
  preferred: string[];
  overflow: boolean;
};

function bagToNeighbor(
  bag: Bag,
  localDevice: string,
  pendingLocal: string,
  collected: Collected,
): void {
  for (const tweak of TWEAKS) tweak(bag);
  const localPort = bag.localPort || pendingLocal;
  const chassisId = bag.chassisId;
  const systemName = bag.systemName;
  let remotePort = bag.portId;
  const portIsMac = Boolean(remotePort) && isMacAddress(remotePort);
  if (portIsMac && bag.portDescription) {
    collected.warnings.push({
      row: bag.line,
      message: `Line ${bag.line}: port ID is a MAC address. Using the port description.`,
    });
    remotePort = bag.portDescription;
  } else if (!remotePort && bag.portDescription) {
    remotePort = bag.portDescription;
  }
  const remoteDevice = systemName || macOf(chassisId) || chassisId;
  const hasAny = Boolean(systemName || chassisId || bag.portId || localPort || bag.systemDescription || bag.platform);
  if (!hasAny) return;
  if (collected.raw.length + collected.errors.length >= MAX_NEIGHBOR_BLOCKS) {
    collected.overflow = true;
    return;
  }
  if (!systemName && chassisId) {
    collected.warnings.push({
      row: bag.line,
      message: `Line ${bag.line}: neighbor has no system name. Using chassis ID ${clipIssue(chassisId)}.`,
    });
  }
  const missing: string[] = [];
  if (!localDevice) missing.push("local device");
  if (!localPort) missing.push("local interface");
  if (!remoteDevice) missing.push("remote device");
  if (!remotePort) missing.push("remote port");
  if (missing.length > 0) {
    const who = remoteDevice ? ` "${clipIssue(remoteDevice)}"` : "";
    collected.errors.push({
      row: bag.line,
      message: `Line ${bag.line}: LLDP neighbor${who} is missing ${missing.join(" and ")}.`,
    });
    return;
  }
  const capability = normalizeCapability(bag.enabledCaps || bag.supportedCaps);
  collected.raw.push({
    line: bag.line,
    localDevice,
    localPort,
    remoteDevice,
    remotePort,
    remotePlatform: platformOf(bag.systemDescription, bag.platform),
    remoteCapability: capability,
  });
}

function finish(collected: Collected, emptyMessage: string): NeighborParseResult {
  if (collected.overflow) {
    return {
      parserId: "lldp",
      links: [],
      warnings: [],
      errors: [{ row: 1, message: `A file can have at most ${MAX_NEIGHBOR_BLOCKS} neighbor blocks.` }],
    };
  }
  return finalizeNeighbors("lldp", collected.raw, collected.errors, collected.warnings, collected.preferred, emptyMessage);
}

function parseLldpText(text: string, options: NeighborParseOptions): Collected {
  const collected: Collected = { raw: [], errors: [], warnings: [], preferred: [], overflow: false };
  let localDevice = cleanSentinel(options.localDevice ?? "");
  if (localDevice) collected.preferred.push(localDevice);
  let pendingLocal = "";
  const held: { bag: Bag | null } = { bag: null };

  const flush = () => {
    const current = held.bag;
    if (!current) return;
    held.bag = null;
    bagToNeighbor(current, localDevice, pendingLocal, collected);
  };

  const ensure = (line: number): Bag => {
    if (!held.bag) held.bag = emptyBag(line);
    return held.bag;
  };

  const assign = (field: Field, value: string, line: number) => {
    const cleaned = clipField(value.trim().replace(/^["']|["']$/g, "").trim());
    if (!cleaned) {
      if (field === "systemDescription" || field === "portDescription") {
        const current = ensure(line);
        current.openField = field;
      }
      return;
    }
    const current = ensure(line);
    if (REPEAT.has(field) && current[field] && current[field] !== cleaned) {
      flush();
      const next = ensure(line);
      next[field] = cleaned;
      next.openField = "";
      return;
    }
    if (field === "enabledCaps" || field === "supportedCaps") {
      const token = capToken(cleaned);
      if (!token) return;
      current[field] = current[field] ? `${current[field]}, ${token}` : token;
      current.openField = "";
      return;
    }
    if (!current[field]) current[field] = cleaned;
    current.openField = field === "systemDescription" || field === "portDescription" ? field : "";
  };

  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (collected.overflow) break;
    const lineNo = index + 1;
    const original = lines[index] ?? "";
    const trimmed = original.trim();
    if (!trimmed) {
      const current = held.bag;
      if (current?.openField === "systemDescription" && !current.systemDescription && !current.skippedBlank) {
        current.skippedBlank = true;
        continue;
      }
      if (current) current.openField = "";
      continue;
    }
    if (/^[-=*_~]{5,}$/.test(trimmed)) {
      flush();
      continue;
    }
    const host = promptHost(trimmed);
    if (host) {
      flush();
      localDevice = host;
      collected.preferred.push(host);
      continue;
    }
    const detected = /^(?:LLDP\s+)?(?:Port|Interface)\s+(\S+)\s+detected\s+(\d+)\s+(?:LLDP\s+)?neighbors?:?\s*$/i.exec(trimmed);
    if (detected?.[1]) {
      flush();
      pendingLocal = detected[2] === "0" ? "" : detected[1];
      continue;
    }
    const bracketed = /LLDP neighbor-information of port\s+\d+\s*\[([^\]]+)\]/i.exec(trimmed);
    const comware = bracketed ?? /LLDP neighbor-information of port\s+(\S+)/i.exec(trimmed);
    if (comware?.[1] && /neighbor-information of port/i.test(trimmed)) {
      flush();
      pendingLocal = (bracketed?.[1] ?? comware[1] ?? "").replace(/:\s*$/, "").trim();
      continue;
    }
    const neighborStart = /^Neighbor\s+(\S+)/i.exec(trimmed);
    if (
      neighborStart?.[1] &&
      !/^Neighbor\s+(?:System|Port|Chassis|Device|Entries|Capabilities|Management)/i.test(trimmed)
    ) {
      const open = held.bag;
      if (open && (open.chassisId || open.systemName || open.portId)) flush();
      const slash = /^([^/]+)\/([^,\s]+)/.exec(neighborStart[1]);
      if (slash?.[1] && slash[2]) {
        const hint = ensure(lineNo);
        if (!hint.chassisId) hint.chassisId = slash[1];
        if (!hint.portId) hint.portId = slash[2];
      }
      continue;
    }
    const labeled = splitLabel(trimmed);
    const pairs = parsePairs(trimmed);
    const knownPair = pairs.some((pair) => PAIR_FIELDS[pair.key]);
    if (knownPair) {
      for (const pair of pairs) {
        const field = PAIR_FIELDS[pair.key];
        if (field) assign(field, pair.value, lineNo);
      }
      continue;
    }
    if (!labeled) {
      const current = held.bag;
      if (current?.openField) {
        const field = current.openField;
        current[field] = clipField(current[field] ? `${current[field]} ${trimmed}` : trimmed);
      }
      continue;
    }
    const norm = normLabel(labeled.label);
    if (norm === "local port id" || norm === "localportid") {
      if (!/^\d+$/.test(labeled.value)) assign("localPort", labeled.value, lineNo);
      continue;
    }
    if (norm === "interface") {
      const local = labeled.value.split(",")[0]?.trim() ?? "";
      if (local) assign("localPort", local, lineNo);
      continue;
    }
    if (norm === "port") {
      assign("localPort", labeled.value, lineNo);
      continue;
    }
    if (norm === "capability") {
      const token = capToken(labeled.value);
      if (token) assign("enabledCaps", token, lineNo);
      continue;
    }
    if ((norm === "enabled" || norm === "supported") && looksLikeCapability(labeled.value)) {
      assign(norm === "enabled" ? "enabledCaps" : "supportedCaps", labeled.value, lineNo);
      continue;
    }
    const field = lookupField(labeled.label);
    if (!field) {
      if (held.bag) held.bag.openField = "";
      continue;
    }
    assign(field, labeled.value, lineNo);
  }
  flush();
  return collected;
}

type KvBag = Bag & { iface: string };

function parseLldpKeyvalue(text: string, options: NeighborParseOptions): Collected {
  const collected: Collected = { raw: [], errors: [], warnings: [], preferred: [], overflow: false };
  let localDevice = cleanSentinel(options.localDevice ?? "");
  if (localDevice) collected.preferred.push(localDevice);
  let bag: KvBag | null = null;

  const flush = () => {
    if (!bag) return;
    const current = bag;
    bag = null;
    if (!current.localPort) current.localPort = current.iface;
    bagToNeighbor(current, localDevice, "", collected);
  };

  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (collected.overflow) break;
    const lineNo = index + 1;
    const trimmed = (lines[index] ?? "").trim();
    if (!trimmed) continue;
    const host = promptHost(trimmed);
    if (host) {
      flush();
      localDevice = host;
      collected.preferred.push(host);
      continue;
    }
    const match = /^lldp\.([^.]+)\.(.+?)=(.*)$/.exec(trimmed);
    if (!match?.[1] || !match[2]) continue;
    const iface = match[1];
    const path = match[2];
    const value = match[3] ?? "";
    if (!bag || bag.iface !== iface) {
      flush();
      bag = { ...emptyBag(lineNo), iface };
    }
    const current = bag;
    const setOnce = (field: Field, next: string) => {
      if (!next) return;
      if (REPEAT.has(field) && current[field] && current[field] !== next) {
        const savedIface = current.iface;
        flush();
        bag = { ...emptyBag(lineNo), iface: savedIface };
        bag[field] = next;
        return;
      }
      if (!current[field]) current[field] = next;
    };
    if (path === "chassis.name") setOnce("systemName", value);
    else if (path === "chassis.descr" || path === "chassis.description") setOnce("systemDescription", value);
    else if (path === "chassis.mac") setOnce("chassisId", value);
    else if (path === "port.ifname") {
      if (current.portId && isMacAddress(current.portId)) current.portId = "";
      setOnce("portId", value);
    } else if ((path === "port.id" || path === "port.mac") && !current.portId) setOnce("portId", value);
    else if (path === "port.descr" || path === "port.description") setOnce("portDescription", value);
    else if (/\.enabled$/.test(path)) {
      const name = path.split(".").slice(-2, -1)[0] ?? "";
      if (/^(?:on|true|yes|1)$/i.test(value) && name) {
        current.enabledCaps = current.enabledCaps ? `${current.enabledCaps}, ${name}` : name;
      }
    }
  }
  flush();
  return collected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => textOf(item)).filter(Boolean).join(", ");
  if (isRecord(value)) {
    if (typeof value.value === "string" || typeof value.value === "number") return String(value.value).trim();
  }
  return "";
}

function capabilityFromJson(value: unknown): string {
  if (!value) return "";
  const items = Array.isArray(value) ? value : [value];
  const enabled: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      enabled.push(item);
      continue;
    }
    if (!isRecord(item)) continue;
    const type = textOf(item.type ?? item.name);
    const flag = item.enabled;
    if (flag === false || flag === "off" || flag === "false") continue;
    if (type) enabled.push(type);
  }
  return enabled.join(", ");
}

function chassisFromJson(chassis: unknown): { name: string; id: string; descr: string; caps: string }[] {
  if (!isRecord(chassis)) return [];
  const known = new Set(["id", "name", "descr", "description", "mgmt-ip", "mgmt_ip", "capability", "capabilities"]);
  const direct = textOf(chassis.name) || chassis.id || chassis.descr || chassis.description;
  if (direct) {
    return [
      {
        name: textOf(chassis.name),
        id: textOf(chassis.id),
        descr: textOf(chassis.descr ?? chassis.description),
        caps: capabilityFromJson(chassis.capability ?? chassis.capabilities),
      },
    ];
  }
  const hosts = Object.keys(chassis).filter((key) => !known.has(key) && isRecord(chassis[key]));
  if (hosts.length === 0) return [];
  return hosts.map((host) => {
    const inner = chassis[host] as Record<string, unknown>;
    return {
      name: host,
      id: textOf(inner.id),
      descr: textOf(inner.descr ?? inner.description),
      caps: capabilityFromJson(inner.capability ?? inner.capabilities),
    };
  });
}

function portFromJson(port: unknown): { id: string; descr: string } {
  if (!isRecord(port)) return { id: "", descr: "" };
  return {
    id: textOf(port.id ?? port.ifname ?? port.name),
    descr: textOf(port.descr ?? port.description),
  };
}

function interfaceRecords(node: unknown): { name: string; value: Record<string, unknown> }[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => {
      if (!isRecord(item)) return [];
      const name = textOf(item.name) || `if${index + 1}`;
      return [{ name, value: item }];
    });
  }
  if (!isRecord(node)) return [];
  if (node.chassis || node.port || node.name) {
    return [{ name: textOf(node.name) || "interface", value: node }];
  }
  return Object.entries(node).flatMap(([name, value]) => (isRecord(value) ? [{ name, value }] : []));
}

function parseLldpJson(text: string, options: NeighborParseOptions): Collected {
  const collected: Collected = { raw: [], errors: [], warnings: [], preferred: [], overflow: false };
  const localDevice = cleanSentinel(options.localDevice ?? "");
  if (localDevice) collected.preferred.push(localDevice);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    collected.errors.push({ row: 1, message: "This LLDP JSON could not be parsed." });
    return collected;
  }
  const root = isRecord(parsed) && parsed.lldp ? parsed.lldp : parsed;
  const interfaces = isRecord(root) ? interfaceRecords(root.interface ?? root.interfaces ?? root) : [];
  if (interfaces.length === 0) {
    collected.errors.push({ row: 1, message: "This LLDP JSON has no interface neighbors." });
    return collected;
  }
  for (const item of interfaces) {
    const port = portFromJson(item.value.port);
    const chassisList = chassisFromJson(item.value.chassis);
    const bodies = chassisList.length > 0 ? chassisList : [{ name: "", id: "", descr: "", caps: "" }];
    for (const chassis of bodies) {
      const bag = emptyBag(1);
      bag.localPort = item.name;
      bag.systemName = chassis.name;
      bag.chassisId = chassis.id;
      bag.systemDescription = chassis.descr;
      bag.enabledCaps = chassis.caps;
      bag.portId = port.id;
      bag.portDescription = port.descr;
      bagToNeighbor(bag, localDevice, "", collected);
      if (collected.overflow) break;
    }
  }
  return collected;
}

function looksLikeLldpJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  return /"lldp"/i.test(trimmed) || (/"chassis"/i.test(trimmed) && /"port"/i.test(trimmed));
}

function looksLikeKeyvalue(text: string): boolean {
  return /^lldp\./m.test(text);
}

function emptyMessage(text: string): string {
  if (/local interface\s+.*system name/i.test(text) && !/chassis id\s*:/i.test(text) && !/system name\s*:/i.test(text)) {
    return "This is the short LLDP neighbor table. Paste the detail output, or lldpctl on Linux.";
  }
  return "No LLDP neighbors were found. Paste LLDP neighbor detail, or lldpctl output.";
}

export function parseLldpNeighbors(text: string, options: NeighborParseOptions = {}): NeighborParseResult {
  const cleaned = cleanCli(text);
  if (looksLikeLldpJson(cleaned)) {
    return finish(parseLldpJson(cleaned, options), emptyMessage(cleaned));
  }
  if (looksLikeKeyvalue(cleaned)) {
    return finish(parseLldpKeyvalue(cleaned, options), emptyMessage(cleaned));
  }
  return finish(parseLldpText(cleaned, options), emptyMessage(cleaned));
}

export const lldpParser: NeighborParser = {
  id: "lldp",
  kind: "lldp",
  label: "LLDP neighbors (any vendor)",
  parse: parseLldpNeighbors,
};
