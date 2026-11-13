import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isDataFileName } from "../src/dataFiles.js";
import { importDiagramData, isSafeDataPath, readDataSource } from "../src/diagramData.js";
import { lintDiagram } from "../src/diagramLint.js";
import { parseCdpNeighbors } from "../src/neighbors/cdp.js";
import { neighborParsers, parseNeighborSource } from "../src/neighbors/index.js";
import { parseLldpNeighbors } from "../src/neighbors/lldp.js";
import { normalizeInterface } from "../src/neighbors/normalize.js";
import type { NeighborParseResult } from "../src/neighbors/types.js";

const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/samples/neighbors");

type ExpectLink = {
  local: string;
  localPort: string;
  remote: string;
  remotePort: string;
  platform: string;
  capability: string;
};

function summary(result: NeighborParseResult): ExpectLink[] {
  return result.links.map((link) => ({
    local: link.localDevice,
    localPort: link.localPort,
    remote: link.remoteDevice,
    remotePort: link.remotePort,
    platform: link.remotePlatform,
    capability: link.remoteCapability,
  }));
}

async function readSample(name: string): Promise<string> {
  return fs.readFile(path.join(samples, name), "utf8");
}

describe("interface normalization", () => {
  it("treats Cisco and Arista spellings of one interface as the same key", () => {
    const gig = ["Gi1/0/1", "GigabitEthernet1/0/1", "gigabitethernet 1/0/1", "Gig 1/0/1"].map(normalizeInterface);
    expect(new Set(gig.map((item) => item.key)).size).toBe(1);
    expect(gig[0]?.display).toBe("Gi1/0/1");

    const eth = ["Eth1/1", "Ethernet1/1", "Et1/1"].map(normalizeInterface);
    expect(new Set(eth.map((item) => item.key)).size).toBe(1);
    expect(eth[0]?.display).toBe("Eth1/1");
    expect(normalizeInterface("ether1")).toMatchObject({ display: "Eth1", key: "eth1" });

    const channel = ["Po1", "Port-channel1", "Port-Channel 1"].map(normalizeInterface);
    expect(new Set(channel.map((item) => item.key)).size).toBe(1);
    expect(channel[0]?.display).toBe("Po1");

    expect(normalizeInterface("Twe1/0/1").key).toBe(normalizeInterface("TwentyFiveGigE1/0/1").key);
    expect(normalizeInterface("Te1/1/1").key).toBe(normalizeInterface("TenGigabitEthernet1/1/1").key);
    expect(normalizeInterface("Fa0/1").key).toBe(normalizeInterface("FastEthernet0/1").key);
    expect(normalizeInterface("ge-0/0/0")).toMatchObject({ display: "ge-0/0/0", key: "ge-0/0/0" });
    expect(normalizeInterface("xe-0/0/1").display).toBe("xe-0/0/1");

    const mac = ["00:11:22:33:44:55", "0011.2233.4455", "00-11-22-33-44-55"].map(normalizeInterface);
    expect(new Set(mac.map((item) => item.key)).size).toBe(1);
    expect(mac[0]?.isMac).toBe(true);
  });
});

describe("Cisco CDP", () => {
  it.each([
    [
      "cisco-ios-cdp.cdp",
      [
        { local: "core-sw", localPort: "Gi1/0/1", remote: "dist-sw", remotePort: "Gi1/0/48", platform: "Cisco IOS", capability: "Switch" },
        { local: "core-sw", localPort: "Fa0/2", remote: "access-sw", remotePort: "Fa0/1", platform: "Cisco IOS", capability: "Switch" },
      ],
    ],
    [
      "cisco-iosxe-cdp.cdp",
      [
        { local: "core-sw", localPort: "Twe1/0/1", remote: "dist-sw", remotePort: "Te1/1/1", platform: "Cisco IOS-XE", capability: "Switch" },
        { local: "core-sw", localPort: "Gi1/0/24", remote: "wan-rtr", remotePort: "Gi0/0/0", platform: "Cisco IOS-XE", capability: "Router, Switch" },
      ],
    ],
    [
      "cisco-nxos-cdp.cdp",
      [
        { local: "core-sw", localPort: "Eth1/1", remote: "leaf-1", remotePort: "Eth1/49", platform: "Cisco NX-OS", capability: "Router, Switch" },
        { local: "core-sw", localPort: "Eth1/2", remote: "leaf-2", remotePort: "Eth1/50", platform: "Cisco NX-OS", capability: "Router, Switch" },
      ],
    ],
  ] as const)("parses %s", async (file, expected) => {
    const result = parseCdpNeighbors(await readSample(file));
    expect(result.parserId).toBe("cisco-cdp");
    expect(result.errors).toEqual([]);
    expect(summary(result)).toEqual(expected);
  });

  it("names the truncated block and keeps the neighbor that parsed", () => {
    const text = `core-sw#show cdp neighbors detail
-------------------------
Device ID: dist-sw
Platform: cisco C9300-48P, Capabilities: Switch
Interface: Gi1/0/1, Port ID (outgoing port): Gi1/0/2
-------------------------
Device ID: access-sw
Platform: cisco WS-C2960-24TT-L, Capabilities: Switch
`;
    const result = parseCdpNeighbors(text);
    expect(summary(result)).toEqual([
      { local: "core-sw", localPort: "Gi1/0/1", remote: "dist-sw", remotePort: "Gi1/0/2", platform: "Cisco IOS-XE", capability: "Switch" },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/access-sw/);
    expect(result.errors[0]?.message).toMatch(/local interface/);
    expect(result.errors[0]?.row).toBeGreaterThan(1);
  });

  it("ignores pagination, banners, and odd spacing", async () => {
    const noisy = (await readSample("cisco-ios-cdp.cdp")).replace(
      "Interface: GigabitEthernet1/0/1",
      "Interface: GigabitEthernet1/0/1 --More--",
    );
    const result = parseCdpNeighbors(noisy.replace(/\n/g, "\r\n"));
    expect(result.errors).toEqual([]);
    expect(result.links).toHaveLength(2);
    expect(result.links[0]?.localPort).toBe("Gi1/0/1");
  });

  it("collapses both ends and long interface names into one link", () => {
    const text = `core-sw#show cdp neighbors detail
-------------------------
Device ID: dist-sw.example.com
Platform: cisco C9300-48P, Capabilities: Switch
Interface: GigabitEthernet1/0/1, Port ID (outgoing port): GigabitEthernet1/0/48

dist-sw#show cdp neighbors detail
-------------------------
Device ID: core-sw
Platform: cisco C9300-48P, Capabilities: Switch
Interface: Gi1/0/48, Port ID (outgoing port): Gi1/0/1
`;
    const result = parseCdpNeighbors(text);
    expect(result.errors).toEqual([]);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]).toMatchObject({
      localDevice: "core-sw",
      localPort: "Gi1/0/1",
      remoteDevice: "dist-sw",
      remotePort: "Gi1/0/48",
    });
    expect(result.warnings.some((issue) => /duplicate link/i.test(issue.message))).toBe(true);
  });

  it("uses the device name the user typed when the prompt is missing", () => {
    const text = `-------------------------
Device ID: dist-sw
Platform: cisco WS-C3750X-48, Capabilities: Switch
Interface: Gi1/0/1, Port ID (outgoing port): Gi1/0/2
`;
    expect(parseCdpNeighbors(text).errors[0]?.message).toMatch(/local device/);
    const named = parseCdpNeighbors(text, { localDevice: "core-sw" });
    expect(named.errors).toEqual([]);
    expect(named.links[0]?.localDevice).toBe("core-sw");
  });

  it("rejects the short CDP table", () => {
    const text = `core-sw#show cdp neighbors
Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID
dist-sw          Gig 1/0/1         120        S I         WS-C3750  Gig 1/0/48
`;
    expect(parseCdpNeighbors(text).errors[0]?.message).toMatch(/short CDP table/);
  });
});

describe("vendor-agnostic LLDP", () => {
  const cases: { file: string; localDevice?: string; links: ExpectLink[] }[] = [
    {
      file: "cisco-ios-lldp.lldp",
      links: [
        { local: "core-sw", localPort: "Gi1/0/1", remote: "dist-sw", remotePort: "Gi1/0/48", platform: "Cisco IOS", capability: "Switch" },
        { local: "core-sw", localPort: "Gi1/0/2", remote: "access-sw", remotePort: "Fa0/1", platform: "Cisco IOS", capability: "Switch" },
      ],
    },
    {
      file: "cisco-iosxe-lldp.lldp",
      links: [
        { local: "core-sw", localPort: "Twe1/0/1", remote: "dist-sw", remotePort: "Te1/1/1", platform: "Cisco IOS-XE", capability: "Router, Switch" },
        { local: "core-sw", localPort: "Gi1/0/24", remote: "wan-rtr", remotePort: "Gi0/0/0", platform: "Cisco IOS-XE", capability: "Router" },
      ],
    },
    {
      file: "cisco-nxos-lldp.lldp",
      links: [
        { local: "core-sw", localPort: "Eth1/1", remote: "leaf-1", remotePort: "Eth1/49", platform: "Cisco NX-OS", capability: "Router, Switch" },
        { local: "core-sw", localPort: "Eth1/2", remote: "leaf-2", remotePort: "Eth1/50", platform: "Cisco NX-OS", capability: "Router, Switch" },
      ],
    },
    {
      file: "arista-eos-lldp.lldp",
      links: [
        { local: "core-sw", localPort: "Eth1", remote: "dist-sw", remotePort: "Eth49", platform: "Arista EOS", capability: "Switch" },
        { local: "core-sw", localPort: "Eth2", remote: "access-sw", remotePort: "Eth1", platform: "Arista EOS", capability: "Switch" },
      ],
    },
    {
      file: "juniper-junos-lldp.lldp",
      links: [
        { local: "spine", localPort: "ge-0/0/0", remote: "leaf-1", remotePort: "ge-0/0/1", platform: "Junos", capability: "Router, Switch" },
        { local: "spine", localPort: "ge-0/0/1", remote: "leaf-2", remotePort: "xe-0/0/0", platform: "Junos", capability: "Switch" },
      ],
    },
    {
      file: "aruba-cx-lldp.lldp",
      links: [
        { local: "agg-sw", localPort: "1/1/1", remote: "core-sw", remotePort: "1/1/49", platform: "Aruba", capability: "Router, Switch" },
        { local: "agg-sw", localPort: "1/1/2", remote: "access-sw", remotePort: "1/1/1", platform: "Aruba", capability: "Switch" },
      ],
    },
    {
      file: "hpe-comware-lldp.lldp",
      links: [
        { local: "agg-sw", localPort: "Gi1/0/1", remote: "core-sw", remotePort: "Gi1/0/49", platform: "HPE", capability: "Router, Switch" },
        { local: "agg-sw", localPort: "Gi1/0/2", remote: "access-sw", remotePort: "Gi1/0/1", platform: "HPE", capability: "Switch" },
      ],
    },
    {
      file: "aruba-provision-lldp.lldp",
      links: [
        { local: "agg-sw", localPort: "1", remote: "core-sw", remotePort: "49", platform: "Aruba", capability: "Switch" },
        { local: "agg-sw", localPort: "2", remote: "access-sw", remotePort: "1", platform: "Aruba", capability: "Switch" },
      ],
    },
    {
      file: "dell-os10-lldp.lldp",
      links: [
        { local: "core-sw", localPort: "Eth1/1/1", remote: "leaf-1", remotePort: "Eth1/1/49", platform: "Dell", capability: "Router, Switch" },
        { local: "core-sw", localPort: "Eth1/1/2", remote: "leaf-2", remotePort: "Eth1/1/1", platform: "Dell", capability: "Switch" },
      ],
    },
    {
      file: "extreme-exos-lldp.lldp",
      links: [
        { local: "core-sw", localPort: "1:1", remote: "dist-sw", remotePort: "1:49", platform: "Extreme", capability: "Switch" },
        { local: "core-sw", localPort: "1:2", remote: "access-sw", remotePort: "2:1", platform: "Extreme", capability: "Switch" },
      ],
    },
    {
      file: "mikrotik-routeros-lldp.lldp",
      links: [
        { local: "edge", localPort: "Eth1", remote: "core-sw", remotePort: "Eth49", platform: "Arista EOS", capability: "" },
        { local: "edge", localPort: "Eth2", remote: "dist-sw", remotePort: "Gi1/0/24", platform: "Cisco IOS-XE", capability: "" },
      ],
    },
    {
      file: "lldpd.lldp",
      links: [
        { local: "edge", localPort: "Eth0", remote: "core-sw", remotePort: "Eth49", platform: "Arista EOS", capability: "Switch" },
        { local: "edge", localPort: "Eth1", remote: "dist-sw", remotePort: "Eth2", platform: "Linux", capability: "Switch, Station" },
      ],
    },
    {
      file: "lldpd-keyvalue.lldp",
      links: [
        { local: "edge", localPort: "Eth0", remote: "core-sw", remotePort: "Eth49", platform: "Arista EOS", capability: "Switch" },
        { local: "edge", localPort: "Eth1", remote: "dist-sw", remotePort: "Gi1/0/24", platform: "Cisco IOS-XE", capability: "Switch" },
      ],
    },
    {
      file: "lldpd.json",
      localDevice: "edge",
      links: [
        { local: "edge", localPort: "Eth0", remote: "core-sw", remotePort: "Eth49", platform: "Arista EOS", capability: "Switch" },
        { local: "edge", localPort: "Eth1", remote: "dist-sw", remotePort: "Gi1/0/24", platform: "Cisco IOS-XE", capability: "Switch" },
      ],
    },
  ];

  it("registers one LLDP parser and one Cisco CDP parser", () => {
    const parsers = neighborParsers();
    expect(parsers.map((parser) => parser.id).sort()).toEqual(["cisco-cdp", "lldp"]);
    expect(parsers.filter((parser) => parser.kind === "lldp")).toHaveLength(1);
    expect(parseNeighborSource("lldp", "core-sw#show lldp neighbors detail\n").parserId).toBe("lldp");
  });

  it.each(cases)("parses $file with the same LLDP parser", async ({ file, localDevice, links }) => {
    const result = parseLldpNeighbors(await readSample(file), { localDevice });
    expect(result.parserId).toBe("lldp");
    expect(result.errors).toEqual([]);
    expect(summary(result)).toEqual(links);
  });

  it("parses a vendor that is not one of the samples", () => {
    const text = `leaf-9#show lldp neighbors detail
Local Interface: swp1
Chassis ID: 00:11:22:33:44:55
Port ID: swp49
System Name: fabric-1
System Description: SomeVendor NOS 3.2
Port Description: uplink
System Capabilities: Bridge, Router
`;
    const result = parseLldpNeighbors(text);
    expect(result.parserId).toBe("lldp");
    expect(result.errors).toEqual([]);
    expect(summary(result)).toEqual([
      {
        local: "leaf-9",
        localPort: "swp1",
        remote: "fabric-1",
        remotePort: "swp49",
        platform: "SomeVendor NOS 3.2",
        capability: "Router, Switch",
      },
    ]);
  });

  it("reports a truncated block by line and keeps the complete neighbor", () => {
    const text = `core-sw#show lldp neighbors detail
------------------------------------------------
Local Intf: Gi1/0/1
Chassis id: 0011.2233.4455
Port id: Gi1/0/2
System Name: dist-sw
System Description: Cisco IOS Software
------------------------------------------------
Local Intf: Gi1/0/2
Chassis id: 0011.2233.4466
`;
    const result = parseLldpNeighbors(text);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]?.remoteDevice).toBe("dist-sw");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/missing/);
    expect(result.errors[0]?.message).toMatch(/remote/);
  });

  it("uses the port description when the port ID is a MAC", () => {
    const text = `core-sw#show lldp neighbors detail
Local Intf: Gi1/0/1
Chassis id: 0011.2233.4455
Port id: 00:11:22:33:44:66
Port Description: Gi1/0/48
System Name: dist-sw
System Description: Cisco IOS Software
`;
    const result = parseLldpNeighbors(text);
    expect(result.errors).toEqual([]);
    expect(result.links[0]?.remotePort).toBe("Gi1/0/48");
    expect(result.warnings.some((issue) => /port description/i.test(issue.message))).toBe(true);
  });

  it("uses the chassis ID when the system name is missing", () => {
    const text = `core-sw#show lldp neighbors detail
Local Intf: Gi1/0/1
Chassis id: 0011.2233.4455
Port id: Gi1/0/48
System Description: Cisco IOS Software
`;
    const result = parseLldpNeighbors(text);
    expect(result.errors).toEqual([]);
    expect(result.links[0]?.remoteDevice).toBe("00:11:22:33:44:55");
    expect(result.warnings.some((issue) => /chassis ID/i.test(issue.message))).toBe(true);
  });

  it("accepts an lldpctl JSON array as well as the object form", () => {
    const text = JSON.stringify({
      lldp: {
        interface: [
          {
            name: "eth0",
            chassis: { id: { type: "mac", value: "00:11:22:33:44:55" }, name: "core-sw", descr: "Arista Networks EOS" },
            port: { id: { type: "ifname", value: "Ethernet1" }, descr: "uplink" },
          },
        ],
      },
    });
    const result = parseLldpNeighbors(text, { localDevice: "edge" });
    expect(result.errors).toEqual([]);
    expect(result.links[0]).toMatchObject({ localDevice: "edge", localPort: "Eth0", remoteDevice: "core-sw", remotePort: "Eth1" });
  });

  it("deduplicates an LLDP link seen from both ends", () => {
    const text = `core-sw#show lldp neighbors detail
Local Intf: GigabitEthernet1/0/1
Port id: Gi1/0/48
System Name: dist-sw.example.com
System Description: Cisco IOS Software

dist-sw#show lldp neighbors detail
Local Intf: Gi1/0/48
Port id: GigabitEthernet1/0/1
System Name: core-sw
System Description: Cisco IOS-XE Software
`;
    const result = parseLldpNeighbors(text);
    expect(result.errors).toEqual([]);
    expect(result.links).toHaveLength(1);
    expect(result.warnings.some((issue) => /duplicate link/i.test(issue.message))).toBe(true);
  });
});

describe("neighbor import", () => {
  it("stores CDP as the diagram source and groups by platform", async () => {
    const text = await readSample("cisco-ios-cdp.cdp");
    const result = importDiagramData({ text, format: "cdp", title: "Core", sourceFile: "core.cdp", groupBy: "platform" });
    expect(result.errors).toEqual([]);
    expect(result.format).toBe("cdp");
    expect(result.shape).toBe("links");
    expect(result.mermaid).toContain("%% nerdgram:generated");
    expect(result.mermaid).toContain("flowchart LR");
    expect(result.mermaid).toContain('["Cisco IOS"]');
    expect(result.mermaid).toContain('|"Gi1/0/1 – Gi1/0/48"|');
    expect(result.source).toMatchObject({ file: "core.cdp", format: "cdp", groupBy: "platform", shape: "links" });
    expect(readDataSource(result.mermaid)?.format).toBe("cdp");
    expect(lintDiagram(result.mermaid)).toEqual([]);
    expect(isSafeDataPath("Network/core.cdp")).toBe(true);
    expect(isSafeDataPath("Network/core.lldp")).toBe(true);
    expect(isSafeDataPath("Notes.txt")).toBe(false);
    expect(isDataFileName("core.lldp")).toBe(true);
  });

  it("groups LLDP by capability and escapes a hostile system name", () => {
    const text = `core-sw#show lldp neighbors detail
Local Intf: Gi1/0/1
Port id: Gi1/0/2
System Name: "] click pwn javascript:alert(1)
System Description: Cisco IOS Software
System Capabilities: B
`;
    const result = importDiagramData({ text, format: "lldp", groupBy: "capability", sourceFile: "core.lldp" });
    expect(result.errors).toEqual([]);
    expect(result.mermaid).toContain('["Switch"]');
    expect(result.mermaid).not.toMatch(/javascript\s*:/i);
    expect(result.mermaid).not.toMatch(/^\s*click\b/im);
    expect(lintDiagram(result.mermaid)).toEqual([]);
  });

  it("does not create a diagram when a neighbor block is unparseable", () => {
    const text = `core-sw#show lldp neighbors detail
Local Intf: Gi1/0/1
Chassis id: 0011.2233.4455
`;
    const result = importDiagramData({ text, format: "lldp" });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.mermaid).toBe("");
    expect(result.model).toEqual({ nodes: [], edges: [] });
  });

  it("rejects an unknown source without mentioning a removed connector", () => {
    expect(() => importDiagramData({ text: "device,port\n", format: "netbox" })).toThrow(/Cisco CDP output, or LLDP/);
    try {
      importDiagramData({ text: "device,port\n", format: "netbox" });
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message.toLowerCase()).not.toContain("netbox");
    }
  });

  it("refuses neighbor output larger than 512 KB", () => {
    expect(() => importDiagramData({ text: `core#show cdp neighbors detail\n${"A".repeat(512 * 1024)}`, format: "cdp" })).toThrow(
      /512 KB/,
    );
  });
});
