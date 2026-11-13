import type { NeighborKind, NeighborParser } from "./types.js";

/**
 * Protocol parsers, not vendor parsers.
 *
 * `cisco-cdp` reads Cisco IOS, IOS-XE, and NX-OS CDP.
 * `lldp` reads any vendor's LLDP detail output from the standard TLVs.
 * To add a vendor, extend the LLDP field aliases or a tweak. Register a new
 * parser only for a different protocol.
 */

const parsers: NeighborParser[] = [];

export function registerNeighborParser(parser: NeighborParser): void {
  const index = parsers.findIndex((item) => item.id === parser.id);
  if (index >= 0) parsers.splice(index, 1);
  parsers.push(parser);
}

export function neighborParsers(): readonly NeighborParser[] {
  return parsers;
}

export function parserForKind(kind: NeighborKind): NeighborParser | undefined {
  return parsers.find((parser) => parser.kind === kind);
}
