export type DrillCrumb = {
  path: string;
  title: string;
};

export type DrillTrail = {
  crumbs: DrillCrumb[];
  index: number;
};

export function singleTrail(crumb: DrillCrumb): DrillTrail {
  return { crumbs: [crumb], index: 0 };
}

/** Drop anything after the current crumb, then open `crumb`. Staying on the same path does not grow the trail. */
export function drillForward(trail: DrillTrail, crumb: DrillCrumb): DrillTrail {
  const crumbs = trail.crumbs.slice(0, trail.index + 1);
  const current = crumbs[crumbs.length - 1];
  if (current?.path === crumb.path) {
    crumbs[crumbs.length - 1] = crumb;
    return { crumbs, index: crumbs.length - 1 };
  }
  crumbs.push(crumb);
  return { crumbs, index: crumbs.length - 1 };
}

export function drillIndex(trail: DrillTrail, index: number): DrillTrail {
  if (!Number.isInteger(index) || index < 0 || index >= trail.crumbs.length) return trail;
  return { ...trail, index };
}

function isCrumb(value: unknown): value is DrillCrumb {
  if (!value || typeof value !== "object") return false;
  const crumb = value as { path?: unknown; title?: unknown };
  return typeof crumb.path === "string" && crumb.path.length > 0 && typeof crumb.title === "string";
}

export function trailFromState(state: unknown, fallback: DrillCrumb): DrillTrail {
  if (!state || typeof state !== "object" || !("drill" in state)) return singleTrail(fallback);
  const drill = (state as { drill?: unknown }).drill;
  if (!drill || typeof drill !== "object") return singleTrail(fallback);
  const record = drill as { crumbs?: unknown; index?: unknown };
  if (!Array.isArray(record.crumbs) || !record.crumbs.every(isCrumb)) return singleTrail(fallback);
  if (!record.crumbs.length) return singleTrail(fallback);
  if (typeof record.index !== "number" || !Number.isInteger(record.index)) return singleTrail(fallback);
  if (record.index < 0 || record.index >= record.crumbs.length) return singleTrail(fallback);
  if (record.crumbs[record.index]?.path !== fallback.path) return singleTrail(fallback);
  return { crumbs: record.crumbs, index: record.index };
}

export function withCrumbTitle(trail: DrillTrail, title: string): DrillTrail {
  const crumb = trail.crumbs[trail.index];
  if (!crumb || crumb.title === title) return trail;
  const crumbs = trail.crumbs.slice();
  crumbs[trail.index] = { ...crumb, title };
  return { crumbs, index: trail.index };
}
