import { ciscoCdpParser, parseCdpNeighbors } from "./cdp.js";
import { lldpParser, parseLldpNeighbors } from "./lldp.js";
import { neighborParsers, parserForKind, registerNeighborParser } from "./registry.js";
import type { NeighborKind, NeighborParseOptions, NeighborParseResult } from "./types.js";

registerNeighborParser(ciscoCdpParser);
registerNeighborParser(lldpParser);

export function parseNeighborSource(
  kind: NeighborKind,
  text: string,
  options: NeighborParseOptions = {},
): NeighborParseResult {
  const parser = parserForKind(kind);
  if (!parser) {
    return {
      parserId: kind,
      links: [],
      warnings: [],
      errors: [{ row: 1, message: "No parser is registered for this source." }],
    };
  }
  return parser.parse(text, options);
}

/** Auto-detect pasted CDP or LLDP. A CSV or JSON diagram does not match. */
export function detectNeighborKind(text: string): NeighborKind | null {
  const cdp = /show\s+cdp\s+neighbors/i.test(text) || /port id \(outgoing port\)/i.test(text);
  const lldp =
    /show\s+lldp\s+neighbors/i.test(text) ||
    /lldpctl/i.test(text) ||
    /^lldp\./m.test(text) ||
    /local intf\s*:/i.test(text) ||
    /detected\s+\d+\s+lldp neighbors/i.test(text) ||
    /LLDP Neighbor Information/i.test(text) ||
    /lldp neighbor-information/i.test(text) ||
    /"lldp"\s*:/i.test(text) ||
    /SysName\s*:/i.test(text) ||
    /system[- ]name\s*:/i.test(text) ||
    /chassis id\s*:/i.test(text) ||
    /interface=.*identity=/i.test(text);
  if (cdp && lldp) {
    const cdpAt = text.search(/show\s+cdp\s+neighbors|port id \(outgoing port\)/i);
    const lldpAt = text.search(/show\s+lldp\s+neighbors|lldpctl|^lldp\.|"lldp"\s*:|local intf\s*:/im);
    if (cdpAt >= 0 && (lldpAt < 0 || cdpAt <= lldpAt)) return "cdp";
    return "lldp";
  }
  if (cdp) return "cdp";
  if (lldp) return "lldp";
  return null;
}

export { neighborParsers, parseCdpNeighbors, parseLldpNeighbors };
export type { NeighborKind, NeighborParseOptions, NeighborParseResult, NeighborParser } from "./types.js";
export type { NormalizedNeighbor } from "./types.js";
