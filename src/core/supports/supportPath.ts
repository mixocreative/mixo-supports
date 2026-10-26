export interface SupportPathLink {
  from: string;
  to: string | 'plate';
  topY: number;
  bottomY: number;
  verified: boolean;
  origin: 'auto' | 'manual';
}

export type SupportPathResult =
  | { status: 'ok'; resolved: string[]; unresolved: string[]; manualResolved: string[] }
  | { status: 'inconclusive'; reason: string };

/** Reachability over links whose geometry and body clearance were checked by the caller. */
export function resolveBirthPaths(births: readonly { id: string; height: number }[],
  links: readonly SupportPathLink[]): SupportPathResult {
  const heights = new Map<string, number>();
  for (const birth of births) {
    if (!birth.id || birth.id === 'plate' || heights.has(birth.id) || !Number.isFinite(birth.height)) {
      return { status: 'inconclusive', reason: 'invalid birth identity or height' };
    }
    heights.set(birth.id, birth.height);
  }

  const accepted: SupportPathLink[] = [];
  for (const link of links) {
    const sourceHeight = heights.get(link.from);
    if (sourceHeight === undefined || (link.to !== 'plate' && !heights.has(link.to)) ||
      !Number.isFinite(link.topY) || !Number.isFinite(link.bottomY) ||
      (link.origin !== 'auto' && link.origin !== 'manual')) {
      return { status: 'inconclusive', reason: 'invalid support path link' };
    }
    if (!link.verified || link.topY > sourceHeight || link.bottomY > link.topY ||
      (link.to === 'plate' ? link.bottomY > 0 : heights.get(link.to)! > link.bottomY)) continue;
    accepted.push(link);
  }

  const reachable = (allowManual: boolean): Set<string> => {
    const resolved = new Set<string>();
    const dependents = new Map<string, string[]>();
    for (const link of accepted) {
      if (!allowManual && link.origin === 'manual') continue;
      if (link.to === 'plate') resolved.add(link.from);
      else {
        const children = dependents.get(link.to) ?? [];
        children.push(link.from);
        dependents.set(link.to, children);
      }
    }
    const queue = [...resolved];
    for (let i = 0; i < queue.length; i++) {
      for (const child of dependents.get(queue[i]) ?? []) {
        if (resolved.has(child)) continue;
        resolved.add(child);
        queue.push(child);
      }
    }
    return resolved;
  };

  const automatic = reachable(false);
  const all = reachable(true);
  return {
    status: 'ok',
    resolved: births.filter((birth) => all.has(birth.id)).map((birth) => birth.id),
    unresolved: births.filter((birth) => !all.has(birth.id)).map((birth) => birth.id),
    manualResolved: births.filter((birth) => all.has(birth.id) && !automatic.has(birth.id)).map((birth) => birth.id),
  };
}
