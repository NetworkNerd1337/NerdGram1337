/** Turn pasted CLI output into plain lines without pagination or ANSI noise. */
export function cleanCli(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/.\x08/g, "")
    .replace(/\x08/g, "")
    .replace(/--More--|\(END\)/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/**
 * Hostname from a Cisco, Junos, Arista, or RouterOS prompt.
 * `core-sw#show ...`, `user@spine> show ...`, `[admin@edge] > /ip ...`.
 */
export function promptHost(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const comware = /^<([A-Za-z][\w.-]{0,63})>\s*(.*)$/.exec(trimmed);
  if (comware?.[1]) return comware[1];
  const mikrotik = /^\[(?:[\w.+-]+@)?([A-Za-z0-9][\w.-]*)\]\s*>?\s*(.*)$/.exec(trimmed);
  if (mikrotik?.[1]) return mikrotik[1];
  const userHost = /^[\w.+-]+@([A-Za-z][\w.-]{0,63})\s*[>#]\s*(.*)$/.exec(trimmed);
  if (userHost?.[1]) return userHost[1];
  const host = /^([A-Za-z][\w.-]{0,63})\s*[>#]\s*(.*)$/.exec(trimmed);
  if (!host?.[1]) return null;
  const rest = host[2] ?? "";
  if (rest === "") return host[1];
  if (/^(?:show|display|sh|lldpctl|\/)/i.test(rest)) return host[1];
  if (rest.length < 80 && !/[:=]/.test(rest)) return host[1];
  return null;
}

export function clipIssue(value: string): string {
  const flat = value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

export function cleanSentinel(value: string): string {
  const trimmed = value.trim().replace(/^["']|["']$/g, "").trim();
  if (!trimmed) return "";
  if (/^(?:null|n\/a|na|none|unknown|not advertised|-|--)$/i.test(trimmed)) return "";
  return trimmed;
}

/** Drop an LLDP subtype word (`mac`, `ifname`) that some CLIs print in front of the value. */
export function stripSubtype(value: string): string {
  const match = /^(?:mac|ifname|local|network|interface|ip|ipv4|ipv6)\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || value.trim();
}
