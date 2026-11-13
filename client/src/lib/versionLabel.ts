/** Same shape as the server label: `v1.0.5 "Atlas"`. */
const CODENAME_RE = /^[A-Z][A-Za-z0-9]{1,31}$/;

export function formatVersionLabel(version: string, codename: string | null | undefined): string {
  const trimmed = version.trim();
  const base = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  if (!codename || !CODENAME_RE.test(codename)) return base;
  return `${base} "${codename}"`;
}
