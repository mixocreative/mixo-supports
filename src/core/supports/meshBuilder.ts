import type { ContactIntent, CurveNode, GeneratedSupportMesh, Point2, SupportComponent, SupportPart } from './mesh';
import { add, cross, dot, normalizeOrDown, scale, subtract, type Vector } from '../vec3';

/** Shorter than this (mm), a segment or axis counts as zero length. */
export const MIN_LENGTH = 1e-4;

export class MeshBuilder {
  private positions: number[] = [];
  private indices: number[] = [];
  private components: SupportComponent[] = [];
  private parts: SupportPart[] = [];
  private current?: SupportComponent;

  begin(part: SupportPart, contactId?: string, landingReach?: number, contactIntent?: ContactIntent[], structureKind?: 'tree'): void {
    this.current = { part, ...(contactId === undefined ? {} : { contactId }), start: this.indices.length, count: 0,
      ...(landingReach === undefined ? {} : { landingReach }),
      ...(contactIntent === undefined ? {} : { contactIntent }),
      ...(structureKind === undefined ? {} : { structureKind }) };
  }

  end(): void {
    const component = this.current!;
    component.count = this.indices.length - component.start;
    this.current = undefined;
    if (component.count === 0) return;
    if (this.signedVolume(component) < 0) {
      for (let offset = component.start; offset < component.start + component.count; offset += 3) {
        [this.indices[offset + 1], this.indices[offset + 2]] = [this.indices[offset + 2]!, this.indices[offset + 1]!];
      }
    }
    this.components.push(component);
    if (!this.parts.includes(component.part)) this.parts.push(component.part);
  }

  finish(dropped: string[] = [], droppedByZones: string[] = []): GeneratedSupportMesh {
    return {
      positions: new Float32Array(this.positions),
      indices: new Uint32Array(this.indices),
      parts: [...this.parts],
      components: this.components.map((component) => ({ ...component })),
      dropped,
      droppedByZones,
    };
  }

  /** Truncated cone between two centres with flat caps. */
  frustum(from: Vector, to: Vector, fromRadius: number, toRadius: number, segments: number): void {
    const axis = subtract(to, from);
    if (Math.hypot(...axis) < MIN_LENGTH) return;
    const [u, v] = basis(normalizeOrDown(axis));
    const ring = (center: Vector, radius: number) => Array.from({ length: segments }, (_, step) => {
      const angle = (step / segments) * Math.PI * 2;
      return add(center, add(scale(u, Math.cos(angle) * radius), scale(v, Math.sin(angle) * radius)));
    });
    this.loft([ring(from, fromRadius), ring(to, toRadius)], true);
  }

  /** Closed prism between two rings of equal count, with ear-clipped (possibly concave) caps. */
  prism(bottom: readonly Vector[], top: readonly Vector[]): void {
    const b = bottom.map((point) => this.vertex(point));
    const t = top.map((point) => this.vertex(point));
    const count = b.length;
    for (let step = 0; step < count; step += 1) {
      const next = (step + 1) % count;
      this.indices.push(b[step]!, b[next]!, t[next]!, b[step]!, t[next]!, t[step]!);
    }
    for (const [a, c, d] of earClip(bottom.map(([x, , z]) => [x, z] as Point2))) {
      this.indices.push(b[a]!, b[d]!, b[c]!);
      this.indices.push(t[a]!, t[c]!, t[d]!);
    }
  }

  /** Closed solid over a run of corners: bottom and top strips joined by outer, inner and end walls. */
  strip(outerBottom: readonly Vector[], innerBottom: readonly Vector[], outerTop: readonly Vector[], innerTop: readonly Vector[]): void {
    const [ob, ib, ot, it] = [outerBottom, innerBottom, outerTop, innerTop].map((line) => line.map((point) => this.vertex(point)));
    for (let k = 0; k + 1 < ob!.length; k += 1) {
      this.indices.push(ob![k]!, ib![k]!, ib![k + 1]!, ob![k]!, ib![k + 1]!, ob![k + 1]!);
      this.indices.push(ot![k]!, ot![k + 1]!, it![k + 1]!, ot![k]!, it![k + 1]!, it![k]!);
      this.indices.push(ob![k]!, ob![k + 1]!, ot![k + 1]!, ob![k]!, ot![k + 1]!, ot![k]!);
      this.indices.push(ib![k]!, it![k]!, it![k + 1]!, ib![k]!, it![k + 1]!, ib![k + 1]!);
    }
    const last = ob!.length - 1;
    this.indices.push(ob![0]!, ot![0]!, it![0]!, ob![0]!, it![0]!, ib![0]!);
    this.indices.push(ob![last]!, ib![last]!, it![last]!, ob![last]!, it![last]!, ot![last]!);
  }

  /** Closed solid from a triangulated glyph: bottom and top copies joined along boundary edges. */
  extrudeGlyph(bottom: readonly Vector[], top: readonly Vector[], triangles: readonly number[][]): void {
    const b = bottom.map((point) => this.vertex(point));
    const t = top.map((point) => this.vertex(point));
    const uses = new Map<string, number>();
    for (const [i, j, k] of triangles) {
      this.indices.push(t[i!]!, t[j!]!, t[k!]!);
      this.indices.push(b[i!]!, b[k!]!, b[j!]!);
      for (const [p, q] of [[i!, j!], [j!, k!], [k!, i!]]) {
        const key = p! < q! ? `${p}:${q}` : `${q}:${p}`;
        uses.set(key, (uses.get(key) ?? 0) + 1);
      }
    }
    for (const [i, j, k] of triangles) {
      for (const [p, q] of [[i!, j!], [j!, k!], [k!, i!]]) {
        const key = p! < q! ? `${p}:${q}` : `${q}:${p}`;
        if (uses.get(key) !== 1) continue;
        this.indices.push(t[q!]!, t[p!]!, b[p!]!, t[q!]!, b[p!]!, b[q!]!);
      }
    }
  }

  /** Planar polygon extruded along `offset` (closed solid, ear-clipped caps in the polygon's plane). */
  sweep(polygon: readonly Vector[], offset: Vector): void {
    const bottom = polygon.map((point) => this.vertex(point));
    const top = polygon.map((point) => this.vertex(add(point, offset)));
    const count = polygon.length;
    for (let step = 0; step < count; step += 1) {
      const next = (step + 1) % count;
      this.indices.push(bottom[step]!, bottom[next]!, top[next]!, bottom[step]!, top[next]!, top[step]!);
    }
    let normal: Vector = [0, 0, 0];
    polygon.forEach((point, i) => {
      const next = polygon[(i + 1) % count]!;
      normal = add(normal, [(point[1] - next[1]) * (point[2] + next[2]), (point[2] - next[2]) * (point[0] + next[0]), (point[0] - next[0]) * (point[1] + next[1])]);
    });
    const [u, v] = basis(normalizeOrDown(normal));
    const plane = polygon.map((point) => [dot(point, u), dot(point, v)] as Point2);
    for (const [a, c, d] of earClip(plane)) {
      this.indices.push(bottom[a]!, bottom[d]!, bottom[c]!);
      this.indices.push(top[a]!, top[c]!, top[d]!);
    }
  }

  /** Closed tube following a closed polyline (Curve to Mesh of a cyclic curve with a circle profile). */
  closedTube(points: readonly Vector[], radius: number, segments: number): void {
    const count = points.length;
    let normal = basis(normalizeOrDown(subtract(points[1]!, points[0]!)))[0];
    const rings = points.map((point, index) => {
      const back = normalizeOrDown(subtract(point, points[(index - 1 + count) % count]!));
      const ahead = normalizeOrDown(subtract(points[(index + 1) % count]!, point));
      const tangent = normalizeOrDown(add(back, ahead));
      normal = normalizeOrDown(subtract(normal, scale(tangent, dot(normal, tangent))));
      const binormal = cross(tangent, normal);
      return Array.from({ length: segments }, (_, step) => {
        const angle = (step / segments) * Math.PI * 2;
        return add(point, add(scale(normal, Math.cos(angle) * radius), scale(binormal, Math.sin(angle) * radius)));
      });
    });
    this.loft(rings, false);
  }

  /**
   * Closed tube through a polyline with per-node radius (Blender Curve to Tube, flat caps).
   * `profile` (unit radius, normal / binormal plane) replaces the round cross-section.
   */
  tube(nodes: readonly CurveNode[], segments: number, profile?: readonly Point2[]): void {
    const path = nodes.filter((node, index) => index === 0 || Math.hypot(...subtract(node.point, nodes[index - 1]!.point)) > MIN_LENGTH);
    if (path.length < 2) return;
    let normal = basis(normalizeOrDown(subtract(path[1]!.point, path[0]!.point)))[0];
    const rings = path.map((node, index) => {
      const back = index > 0 ? normalizeOrDown(subtract(node.point, path[index - 1]!.point)) : undefined;
      const ahead = index < path.length - 1 ? normalizeOrDown(subtract(path[index + 1]!.point, node.point)) : undefined;
      const tangent = normalizeOrDown(back && ahead ? add(back, ahead) : (back ?? ahead)!);
      // Parallel transport keeps the profile from twisting along the curve.
      normal = normalizeOrDown(subtract(normal, scale(tangent, dot(normal, tangent))));
      const binormal = cross(tangent, normal);
      if (profile) return profile.map(([a, b]) => add(node.point, add(scale(normal, a * node.radius), scale(binormal, b * node.radius))));
      return Array.from({ length: segments }, (_, step) => {
        const angle = (step / segments) * Math.PI * 2;
        return add(node.point, add(scale(normal, Math.cos(angle) * node.radius), scale(binormal, Math.sin(angle) * node.radius)));
      });
    });
    this.loft(rings, true);
  }

  sphere(center: Vector, radius: number, segments: number): void {
    const rings = Math.max(2, Math.round(segments / 2));
    const top = this.vertex([center[0], center[1] + radius, center[2]]);
    const bottom = this.vertex([center[0], center[1] - radius, center[2]]);
    const layers: number[][] = [];
    for (let layer = 1; layer < rings; layer += 1) {
      const polar = (layer / rings) * Math.PI;
      layers.push(Array.from({ length: segments }, (_, step) => {
        const azimuth = (step / segments) * Math.PI * 2;
        return this.vertex([
          center[0] + Math.sin(polar) * Math.cos(azimuth) * radius,
          center[1] + Math.cos(polar) * radius,
          center[2] + Math.sin(polar) * Math.sin(azimuth) * radius,
        ]);
      }));
    }
    for (let step = 0; step < segments; step += 1) {
      const next = (step + 1) % segments;
      this.indices.push(top, layers[0]![next]!, layers[0]![step]!);
      for (let layer = 0; layer + 1 < layers.length; layer += 1) {
        const [upper, lower] = [layers[layer]!, layers[layer + 1]!];
        this.indices.push(upper[step]!, upper[next]!, lower[next]!, upper[step]!, lower[next]!, lower[step]!);
      }
      const last = layers[layers.length - 1]!;
      this.indices.push(bottom, last[step]!, last[next]!);
    }
  }

  box(min: Vector, max: Vector): void {
    const corners = (y: number): Vector[] => [[min[0], y, min[2]], [max[0], y, min[2]], [max[0], y, max[2]], [min[0], y, max[2]]];
    this.loft([corners(min[1]), corners(max[1])], true);
  }

  /**
   * Joins rings of equal vertex count. `capped` closes the first and last ring with fans;
   * otherwise the last ring wraps to the first, forming a closed band (a torus topology).
   */
  loft(rings: readonly Vector[][], capped: boolean): void {
    const ids = rings.map((ring) => ring.map((point) => this.vertex(point)));
    const count = ids[0]!.length;
    const bands = capped ? ids.length - 1 : ids.length;
    for (let band = 0; band < bands; band += 1) {
      const [lower, upper] = [ids[band]!, ids[(band + 1) % ids.length]!];
      for (let step = 0; step < count; step += 1) {
        const next = (step + 1) % count;
        this.indices.push(lower[step]!, lower[next]!, upper[next]!, lower[step]!, upper[next]!, upper[step]!);
      }
    }
    if (!capped) return;
    const [first, last] = [ids[0]!, ids[ids.length - 1]!];
    const firstCenter = this.vertex(centroid(rings[0]!));
    const lastCenter = this.vertex(centroid(rings[rings.length - 1]!));
    for (let step = 0; step < count; step += 1) {
      const next = (step + 1) % count;
      this.indices.push(firstCenter, first[next]!, first[step]!);
      this.indices.push(lastCenter, last[step]!, last[next]!);
    }
  }

  private vertex(point: Vector): number {
    this.positions.push(point[0], point[1], point[2]);
    return this.positions.length / 3 - 1;
  }

  private signedVolume(component: SupportComponent): number {
    let volume = 0;
    const p = (index: number) => [this.positions[index * 3]!, this.positions[index * 3 + 1]!, this.positions[index * 3 + 2]!] as Vector;
    for (let offset = component.start; offset < component.start + component.count; offset += 3) {
      volume += dot(p(this.indices[offset]!), cross(p(this.indices[offset + 1]!), p(this.indices[offset + 2]!)));
    }
    return volume;
  }
}

/** Ear clipping of a simple polygon (either orientation); returns index triples in the polygon's orientation. */
function earClip(polygon: readonly Point2[]): [number, number, number][] {
  const signed = polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length]!;
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const orientation = Math.sign(signed) || 1;
  const remaining = polygon.map((_, i) => i);
  const triangles: [number, number, number][] = [];
  const cross2 = (o: Point2, a: Point2, b: Point2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  let guard = 0;
  while (remaining.length > 3 && guard < polygon.length * polygon.length) {
    guard += 1;
    let clipped = false;
    for (let k = 0; k < remaining.length; k += 1) {
      const [ia, ib, ic] = [remaining[(k - 1 + remaining.length) % remaining.length]!, remaining[k]!, remaining[(k + 1) % remaining.length]!];
      const [a, b, c] = [polygon[ia]!, polygon[ib]!, polygon[ic]!];
      if (cross2(a, b, c) * orientation <= 1e-12) continue;
      const contains = remaining.some((other) => {
        if (other === ia || other === ib || other === ic) return false;
        const p = polygon[other]!;
        return cross2(a, b, p) * orientation >= 0 && cross2(b, c, p) * orientation >= 0 && cross2(c, a, p) * orientation >= 0;
      });
      if (contains) continue;
      triangles.push([ia, ib, ic]);
      remaining.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) triangles.push([remaining[0]!, remaining[1]!, remaining[2]!]);
  else for (let k = 1; k + 1 < remaining.length; k += 1) triangles.push([remaining[0]!, remaining[k]!, remaining[k + 1]!]);
  return triangles;
}

function basis(axis: Vector): [Vector, Vector] {
  const helper: Vector = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalizeOrDown(cross(helper, axis));
  return [u, cross(axis, u)];
}

function centroid(points: readonly Vector[]): Vector {
  const sum = points.reduce<Vector>((total, point) => add(total, point), [0, 0, 0]);
  return scale(sum, 1 / points.length);
}
