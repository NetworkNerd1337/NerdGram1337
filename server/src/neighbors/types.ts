/**
 * Neighbor discovery shares one normalized link record with the diagram
 * generator. CDP is Cisco-only. LLDP is one vendor-agnostic parser.
 */

export type NeighborKind = "cdp" | "lldp";

export type RowIssue = {
  row: number;
  message: string;
};

export type NeighborParseOptions = {
  /** Used when the paste has no CLI prompt. */
  localDevice?: string;
};

export type RawNeighbor = {
  line: number;
  localDevice: string;
  localPort: string;
  remoteDevice: string;
  remotePort: string;
  remotePlatform: string;
  remoteCapability: string;
};

export type NormalizedNeighbor = {
  line: number;
  localDevice: string;
  localPort: string;
  remoteDevice: string;
  remotePort: string;
  localPlatform: string;
  remotePlatform: string;
  localCapability: string;
  remoteCapability: string;
};

export type NeighborParseResult = {
  parserId: string;
  links: NormalizedNeighbor[];
  errors: RowIssue[];
  warnings: RowIssue[];
};

export type NeighborParser = {
  id: string;
  kind: NeighborKind;
  /** Shown in docs and errors. Not a vendor the user has to pick. */
  label: string;
  parse: (text: string, options: NeighborParseOptions) => NeighborParseResult;
};

export const MAX_NEIGHBOR_BLOCKS = 5_000;
