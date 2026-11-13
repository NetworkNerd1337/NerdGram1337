/** Extensions stored next to a generated diagram and copied by GitHub sync. */
export const DATA_FILE_EXTENSIONS = [".csv", ".json", ".cdp", ".lldp"] as const;

export type DataFileExtension = (typeof DATA_FILE_EXTENSIONS)[number];

export function dataFileExtension(name: string): DataFileExtension | "" {
  const lower = name.toLowerCase();
  return DATA_FILE_EXTENSIONS.find((ext) => lower.endsWith(ext)) ?? "";
}

export function isDataFileName(name: string): boolean {
  return dataFileExtension(name) !== "";
}

export function extensionForFormat(format: string): "csv" | "json" | "cdp" | "lldp" {
  if (format === "json" || format === "cdp" || format === "lldp") return format;
  return "csv";
}
