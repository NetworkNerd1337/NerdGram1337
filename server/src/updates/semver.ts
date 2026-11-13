export type SemVer = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

/** `newer` means the release should be offered. `ahead` means this build is newer. */
export type VersionRelation = "newer" | "same" | "ahead" | "incomparable";

const SEMVER =
  /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemver(input: string): SemVer | null {
  const match = SEMVER.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

export function formatSemver(version: SemVer): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  if (version.prerelease.length === 0) return core;
  return `${core}-${version.prerelease.join(".")}`;
}

export function stableTag(version: SemVer): string | null {
  if (version.prerelease.length > 0) return null;
  return `v${version.major}.${version.minor}.${version.patch}`;
}

export function compareSemver(left: SemVer, right: SemVer): number {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    if (index >= left.length) return -1;
    if (index >= right.length) return 1;
    const a = left[index] ?? "";
    const b = right[index] ?? "";
    const aNum = /^\d+$/.test(a);
    const bNum = /^\d+$/.test(b);
    if (aNum && bNum) {
      const diff = Number(a) - Number(b);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      continue;
    }
    if (aNum && !bNum) return -1;
    if (!aNum && bNum) return 1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

/**
 * Compare a running version to a release tag.
 * Prerelease tags are ignored unless `includePrerelease` is set.
 * A current version that is not a semver is incomparable, so a dev string
 * is never treated as something to downgrade.
 */
export function relationToRelease(
  current: string,
  latest: string,
  includePrerelease: boolean,
): VersionRelation {
  const running = parseSemver(current);
  const release = parseSemver(latest);
  if (!running || !release) return "incomparable";
  if (release.prerelease.length > 0 && !includePrerelease) return "incomparable";
  const cmp = compareSemver(release, running);
  if (cmp > 0) return "newer";
  if (cmp === 0) return "same";
  return "ahead";
}
