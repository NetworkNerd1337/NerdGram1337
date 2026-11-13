import { cleanSentinel } from "./clean.js";
import type { NeighborParseResult, NormalizedNeighbor, RawNeighbor, RowIssue } from "./types.js";

export type NormalizedInterface = {
  display: string;
  key: string;
  isMac: boolean;
};

const PREFIXES: { re: RegExp; display: string; key: string }[] = [
  { re: /^(?:twentyfivegigabitethernet|twentyfivegige|twe)/, display: "Twe", key: "twe" },
  { re: /^(?:hundredgigabitethernet|hundredgige|hu)/, display: "Hu", key: "hu" },
  { re: /^(?:fortygigabitethernet|fortygige|fo)/, display: "Fo", key: "fo" },
  { re: /^(?:tengigabitethernet|tengige|te)/, display: "Te", key: "te" },
  { re: /^(?:fivegigabitethernet|fivegige|fi)/, display: "Fi", key: "fi" },
  { re: /^(?:twogigabitethernet|twogige|tw)/, display: "Tw", key: "tw" },
  { re: /^(?:appgigabitethernet|appgige|ap)/, display: "Ap", key: "ap" },
  { re: /^(?:gigabitethernet|gig|gi)/, display: "Gi", key: "gi" },
  { re: /^(?:fastethernet|fas|fa)/, display: "Fa", key: "fa" },
  { re: /^(?:port-channel|portchannel|po)/, display: "Po", key: "po" },
  { re: /^(?:management|mgmt|ma)/, display: "Ma", key: "ma" },
  { re: /^(?:ethernet|ether|eth|et)/, display: "Eth", key: "eth" },
  { re: /^(?:loopback|lo)/, display: "Lo", key: "lo" },
  { re: /^(?:vlan|vl)/, display: "Vl", key: "vl" },
];

const CAPABILITY_ORDER = ["Router", "Switch", "Phone", "WLAN", "Station", "Cable", "Repeater", "Other"] as const;

const CAPABILITY_LETTER: Record<string, string> = {
  r: "Router",
  b: "Switch",
  t: "Phone",
  w: "WLAN",
  s: "Station",
  c: "Cable",
  p: "Repeater",
  o: "Other",
};

const NOT_CAPABILITY_CODES = new Set(["stp", "igmp", "cdp", "lldp", "mndp", "vlan"]);

const CAPABILITY_WORD: Record<string, string> = {
  router: "Router",
  switch: "Switch",
  bridge: "Switch",
  telephone: "Phone",
  phone: "Phone",
  wlan: "WLAN",
  wireless: "WLAN",
  station: "Station",
  host: "Station",
  docsis: "Cable",
  cable: "Cable",
  repeater: "Repeater",
  other: "Other",
};

export function isMacAddress(value: string): boolean {
  return macOf(value) !== "";
}

export function macOf(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 40) return "";
  const hex = trimmed.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12) return "";
  const hasSep = /[:.\-\s]/.test(trimmed);
  const hasLetter = /[a-f]/i.test(hex);
  if (!hasSep && !hasLetter) return "";
  if (!/^[0-9a-f:.\-\s]+$/i.test(trimmed)) return "";
  const parts = hex.match(/.{2}/g);
  return parts ? parts.join(":") : "";
}

function isIp(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

/** Canonical interface name. `GigabitEthernet1/0/1` and `Gi1/0/1` share a key. */
export function normalizeInterface(raw: string): NormalizedInterface {
  const original = cleanSentinel(raw).replace(/\s+/g, " ").trim();
  if (!original) return { display: "", key: "", isMac: false };
  const mac = macOf(original);
  if (mac) return { display: mac, key: `mac:${mac}`, isMac: true };
  const compact = original.toLowerCase().replace(/[\s_]+/g, "");
  if (
    /^(?:ge|xe|et|ae|em|fxp|irb|lo|me|vme|gr|lt)-[\d/.]+$/.test(compact) ||
    /^(?:ae|em|lo|fxp|irb|vme|me)\d/.test(compact)
  ) {
    return { display: compact, key: compact, isMac: false };
  }
  for (const prefix of PREFIXES) {
    const match = prefix.re.exec(compact);
    if (!match) continue;
    const rest = compact.slice(match[0].length).replace(/^[-_/]+/, "");
    if (!rest || !/^[\d:.]/.test(rest)) continue;
    return { display: `${prefix.display}${rest}`, key: `${prefix.key}${rest}`, isMac: false };
  }
  const plain = original.replace(/\s+/g, " ").trim();
  return { display: plain, key: plain.toLowerCase().replace(/\s+/g, ""), isMac: false };
}

export function normalizeCapability(raw: string): string {
  const found = new Set<string>();
  const tokens = raw
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (/^(?:igmp|filtering|enabled|available|supported|on|off|yes|no)$/i.test(lower)) continue;
    if (CAPABILITY_WORD[lower]) {
      found.add(CAPABILITY_WORD[lower]);
      continue;
    }
    if (/^[brtwscpo]{1,4}$/i.test(token) && !NOT_CAPABILITY_CODES.has(lower)) {
      for (const letter of token.toLowerCase()) {
        const label = CAPABILITY_LETTER[letter];
        if (label) found.add(label);
      }
    }
  }
  return CAPABILITY_ORDER.filter((label) => found.has(label)).join(", ");
}

/** A short platform name for grouping. Unknown gear keeps a clipped description. */
export function platformOf(description: string, platformField = ""): string {
  const text = `${platformField} ${description}`.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/nx-os|nexus|\bn[3579]k\b/.test(text)) return "Cisco NX-OS";
  if (/ios-xe|ios xe|cat9k|iosxe|\bc9[0-9]{3}\b|\bisr\d|\basr\d/.test(text)) return "Cisco IOS-XE";
  if (/cisco ios|\bcatalyst\b|ws-c\d|\bc3750\b|\bc2960\b/.test(text)) return "Cisco IOS";
  if (/arista|\beos\b|\bdcs-/.test(text)) return "Arista EOS";
  if (/junos|juniper/.test(text)) return "Junos";
  if (/aruba|provision|aos-cx|arubaos/.test(text)) return "Aruba";
  if (/comware|hewlett|\bhpe\b|\bhp\b/.test(text)) return "HPE";
  if (/extreme\s*xos|\bexos\b|extremexos/.test(text)) return "Extreme";
  if (/os10|\bdell\b|force10|\bdnos\b/.test(text)) return "Dell";
  if (/routeros|mikrotik/.test(text)) return "MikroTik";
  if (/ubiquiti|unifi|edgeswitch|edgeos|\buisp\b/.test(text)) return "Ubiquiti";
  if (/lldpd|\blinux\b|debian|ubuntu/.test(text)) return "Linux";
  const clip = (platformField || description).split("\n")[0]?.trim() ?? "";
  if (!clip) return "";
  return clip.length > 40 ? `${clip.slice(0, 40)}…` : clip;
}

function deviceKey(name: string, shortNames: ReadonlySet<string>): string {
  const lower = name.trim().toLowerCase();
  if (isIp(lower)) return `ip:${lower}`;
  const short = lower.split(".")[0] ?? lower;
  if (short && shortNames.has(short)) return `host:${short}`;
  return `host:${lower}`;
}

function chooseDisplay(variants: string[], preferred: ReadonlySet<string>): string {
  const prefs = variants.filter((name) => preferred.has(name.trim().toLowerCase()));
  const pool = prefs.length > 0 ? prefs : variants;
  return [...pool].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? "";
}

/**
 * One undirected edge when both ends report the same cable, including
 * hostname vs FQDN and Gi vs GigabitEthernet.
 */
export function finalizeNeighbors(
  parserId: string,
  raw: readonly RawNeighbor[],
  errors: RowIssue[],
  warnings: RowIssue[],
  preferredNames: readonly string[],
  emptyMessage: string,
): NeighborParseResult {
  const preferred = new Set(preferredNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const names: string[] = [];
  for (const link of raw) {
    names.push(link.localDevice, link.remoteDevice);
  }
  const shortNames = new Set<string>();
  for (const name of names) {
    const lower = name.trim().toLowerCase();
    if (lower && !lower.includes(".") && !isIp(lower)) shortNames.add(lower);
  }
  for (const name of preferred) {
    if (!name.includes(".") && !isIp(name)) shortNames.add(name);
  }

  const variants = new Map<string, string[]>();
  const remember = (name: string) => {
    const key = deviceKey(name, shortNames);
    const list = variants.get(key) ?? [];
    if (!list.includes(name)) list.push(name);
    variants.set(key, list);
    return key;
  };

  type Attr = { platform: string; capability: string };
  const attrs = new Map<string, Attr>();
  const touchAttr = (key: string, platform: string, capability: string) => {
    const current = attrs.get(key) ?? { platform: "", capability: "" };
    if (!current.platform && platform) current.platform = platform;
    if (!current.capability && capability) current.capability = capability;
    attrs.set(key, current);
  };

  const prepared: {
    line: number;
    localKey: string;
    remoteKey: string;
    localPort: NormalizedInterface;
    remotePort: NormalizedInterface;
  }[] = [];

  for (const link of raw) {
    const localPort = normalizeInterface(link.localPort);
    const remotePort = normalizeInterface(link.remotePort);
    if (!localPort.key || !remotePort.key) continue;
    const localKey = remember(link.localDevice);
    const remoteKey = remember(link.remoteDevice);
    touchAttr(remoteKey, link.remotePlatform, link.remoteCapability);
    prepared.push({ line: link.line, localKey, remoteKey, localPort, remotePort });
  }

  const display = new Map<string, string>();
  for (const [key, list] of variants) display.set(key, chooseDisplay(list, preferred));

  const seen = new Set<string>();
  const links: NormalizedNeighbor[] = [];
  let dropped = 0;
  for (const link of prepared) {
    const left = `${link.localKey}\0${link.localPort.key}`;
    const right = `${link.remoteKey}\0${link.remotePort.key}`;
    const undirected = left < right ? `${left}\0${right}` : `${right}\0${left}`;
    if (seen.has(undirected)) {
      dropped += 1;
      continue;
    }
    seen.add(undirected);
    const localAttr = attrs.get(link.localKey) ?? { platform: "", capability: "" };
    const remoteAttr = attrs.get(link.remoteKey) ?? { platform: "", capability: "" };
    links.push({
      line: link.line,
      localDevice: display.get(link.localKey) ?? link.localKey,
      localPort: link.localPort.display,
      remoteDevice: display.get(link.remoteKey) ?? link.remoteKey,
      remotePort: link.remotePort.display,
      localPlatform: localAttr.platform,
      remotePlatform: remoteAttr.platform,
      localCapability: localAttr.capability,
      remoteCapability: remoteAttr.capability,
    });
  }
  if (dropped > 0) {
    warnings.push({
      row: 0,
      message: `Combined ${dropped} duplicate link${dropped === 1 ? "" : "s"} seen from both ends.`,
    });
  }
  if (links.length === 0 && errors.length === 0) {
    errors.push({ row: 1, message: emptyMessage });
  }
  return { parserId, links, errors, warnings };
}
