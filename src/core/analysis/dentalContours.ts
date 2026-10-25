import { proposeDentalOrientation, type DentalRim } from './dental';
import type { TriangleMesh } from './types';
import { cross, distance, dot, normalize, subtract, type Vector } from '../vec3';

export type DentalContourProposal =
  | { kind: 'proposal'; context: MeshContext; outer: Set<Edge>; opening: Set<Edge>;
    outerEdges: Uint32Array; outerRidgeEdges: Uint32Array; outerConnectorEdges: Uint32Array;
    openingEdges: Uint32Array; connectorLengths: [number, number] }
  | { kind: 'inconclusive'; reason: string };

export type Edge = { a: number; b: number; faces: number[]; key: number };
type EdgeComponent = { edges: Set<Edge>; vertices: Set<number>; endpoints: number[] };
export type MeshContext = { mesh: TriangleMesh; rim: DentalRim; vertices: Vector[]; projected: [number, number][];
  normals: Vector[]; edges: Map<number, Edge>; extent: [number, number] };

const fail = (reason: string): DentalContourProposal => ({ kind: 'inconclusive', reason });

function buildContext(mesh: TriangleMesh, rim: DentalRim): MeshContext | null {
  const vertexCount = mesh.positions.length / 3;
  if (vertexCount * vertexCount > Number.MAX_SAFE_INTEGER) return null;
  const vertices: Vector[] = [];
  const projected: [number, number][] = [];
  const low = [Infinity, Infinity], high = [-Infinity, -Infinity];
  for (let index = 0; index < vertexCount; index += 1) {
    const at = index * 3;
    const point: Vector = [mesh.positions[at]!, mesh.positions[at + 1]!, mesh.positions[at + 2]!];
    vertices.push(point);
    const delta = subtract(point, rim.centroid);
    const uv: [number, number] = [dot(delta, rim.tangent), dot(delta, rim.bitangent)];
    projected.push(uv);
    for (let axis = 0; axis < 2; axis += 1) {
      low[axis] = Math.min(low[axis]!, uv[axis]);
      high[axis] = Math.max(high[axis]!, uv[axis]);
    }
  }
  const edges = new Map<number, Edge>();
  const normals: Vector[] = [];
  const keyOf = (a: number, b: number) => Math.min(a, b) * vertexCount + Math.max(a, b);
  for (let face = 0; face < mesh.indices.length / 3; face += 1) {
    const at = face * 3;
    const ids = [mesh.indices[at]!, mesh.indices[at + 1]!, mesh.indices[at + 2]!];
    const [a, b, c] = ids.map((index) => vertices[index]!) as [Vector, Vector, Vector];
    const normal = normalize(cross(subtract(b, a), subtract(c, a)));
    if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) return null;
    normals.push(normal);
    for (let corner = 0; corner < 3; corner += 1) {
      const x = ids[corner]!, y = ids[(corner + 1) % 3]!;
      const key = keyOf(x, y);
      const existing = edges.get(key);
      if (existing) existing.faces.push(face);
      else edges.set(key, { a: Math.min(x, y), b: Math.max(x, y), faces: [face], key });
    }
  }
  if ([...edges.values()].some((edge) => edge.faces.length !== 2)) return null;
  return { mesh, rim, vertices, projected, normals, edges, extent: [high[0]! - low[0]!, high[1]! - low[1]!] };
}

function sharpEdges(context: MeshContext, degrees: number): Edge[] {
  const limit = Math.cos(degrees * Math.PI / 180);
  return [...context.edges.values()].filter((edge) =>
    Math.abs(dot(context.normals[edge.faces[0]!]!, context.normals[edge.faces[1]!]!)) <= limit);
}

function components(selected: readonly Edge[]): EdgeComponent[] {
  const graph = new Map<number, Edge[]>();
  for (const edge of selected) for (const index of [edge.a, edge.b]) {
    const incident = graph.get(index) ?? [];
    incident.push(edge);
    graph.set(index, incident);
  }
  const seen = new Set<number>();
  const result: EdgeComponent[] = [];
  for (const start of graph.keys()) {
    if (seen.has(start)) continue;
    const queue = [start];
    seen.add(start);
    const vertices = new Set<number>();
    const edges = new Set<Edge>();
    while (queue.length) {
      const current = queue.pop()!;
      vertices.add(current);
      for (const edge of graph.get(current)!) {
        edges.add(edge);
        const next = edge.a === current ? edge.b : edge.a;
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    const endpoints = [...vertices].filter((index) => graph.get(index)!.length === 1);
    result.push({ edges, vertices, endpoints });
  }
  return result.sort((a, b) => b.edges.size - a.edges.size);
}

function openChain(component: EdgeComponent): boolean {
  if (component.endpoints.length !== 2 || component.edges.size !== component.vertices.size - 1) return false;
  const degree = new Map<number, number>();
  for (const edge of component.edges) for (const index of [edge.a, edge.b]) degree.set(index, (degree.get(index) ?? 0) + 1);
  return [...degree.values()].every((count) => count === 1 || count === 2);
}

type Route = { vertices: number[]; length: number };
function shortestRoute(graph: Map<number, { next: number; length: number }[]>, start: number, end: number): Route | null {
  const costs = new Map<number, number>([[start, 0]]);
  const prior = new Map<number, number>();
  const heap: { index: number; cost: number }[] = [{ index: start, cost: 0 }];
  const push = (entry: { index: number; cost: number }) => {
    heap.push(entry);
    for (let at = heap.length - 1; at > 0;) {
      const parent = (at - 1) >> 1;
      if (heap[parent]!.cost <= heap[at]!.cost) break;
      [heap[parent], heap[at]] = [heap[at]!, heap[parent]!];
      at = parent;
    }
  };
  const pop = () => {
    const first = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let at = 0;;) {
        const left = at * 2 + 1, right = left + 1;
        if (left >= heap.length) break;
        const child = right < heap.length && heap[right]!.cost < heap[left]!.cost ? right : left;
        if (heap[at]!.cost <= heap[child]!.cost) break;
        [heap[at], heap[child]] = [heap[child]!, heap[at]!];
        at = child;
      }
    }
    return first;
  };
  while (heap.length) {
    const { index, cost } = pop();
    if (cost !== costs.get(index)) continue;
    if (index === end) break;
    for (const neighbor of graph.get(index) ?? []) {
      const nextCost = cost + neighbor.length;
      if (nextCost >= (costs.get(neighbor.next) ?? Infinity)) continue;
      costs.set(neighbor.next, nextCost);
      prior.set(neighbor.next, index);
      push({ index: neighbor.next, cost: nextCost });
    }
  }
  if (!costs.has(end)) return null;
  const vertices = [end];
  while (vertices[0] !== start) vertices.unshift(prior.get(vertices[0]!)!);
  return { vertices, length: costs.get(end)! };
}

function outerContour(context: MeshContext): { edges: Set<Edge>; ridgeEdges: Set<Edge>; connectorEdges: Set<Edge>; connectorLengths: [number, number] } | null {
  const candidates = components(sharpEdges(context, 60));
  const [first, second] = candidates;
  if (!first || !second || first.edges.size < 500 || second.edges.size < 300 || !openChain(first) || !openChain(second)) return null;
  const uv = [...first.vertices].map((index) => context.projected[index]!);
  const extent = [0, 1].map((axis) => Math.max(...uv.map((point) => point[axis]!)) - Math.min(...uv.map((point) => point[axis]!)));
  if (extent[0]! / context.extent[0] < 0.6 || extent[1]! / context.extent[1] < 0.6) return null;
  const base = new Set<Edge>([...first.edges, ...second.edges]);
  const graph = new Map<number, { next: number; length: number }[]>();
  for (const edge of sharpEdges(context, 20)) {
    if (base.has(edge)) continue;
    const length = distance(context.vertices[edge.a]!, context.vertices[edge.b]!);
    for (const [from, to] of [[edge.a, edge.b], [edge.b, edge.a]]) {
      const incident = graph.get(from) ?? [];
      incident.push({ next: to, length });
      graph.set(from, incident);
    }
  }
  let choice: { edges: Set<Edge>; ridgeEdges: Set<Edge>; connectorEdges: Set<Edge>; connectorLengths: [number, number]; total: number } | null = null;
  for (const pairing of [[0, 1], [1, 0]]) {
    const routes = pairing.map((to, at) => shortestRoute(graph, first.endpoints[at]!, second.endpoints[to]!));
    if (!routes[0] || !routes[1]) continue;
    const all = new Set(base);
    for (const route of routes) for (let at = 1; at < route!.vertices.length; at += 1) {
      const a = route!.vertices[at - 1]!, b = route!.vertices[at]!;
      const key = Math.min(a, b) * context.vertices.length + Math.max(a, b);
      all.add(context.edges.get(key)!);
    }
    const degree = new Map<number, number>();
    for (const edge of all) for (const index of [edge.a, edge.b]) degree.set(index, (degree.get(index) ?? 0) + 1);
    if ([...degree.values()].some((count) => count !== 2) || all.size !== degree.size) continue;
    const connectorLengths: [number, number] = [routes[0]!.length, routes[1]!.length];
    const total = connectorLengths[0] + connectorLengths[1];
    if (!choice || total < choice.total) choice = { edges: all, ridgeEdges: base,
      connectorEdges: new Set([...all].filter((edge) => !base.has(edge))), connectorLengths, total };
  }
  return choice;
}

type HoleRaster =
  | { kind: 'present'; labels: Int32Array; id: number; pixels: [number, number][] }
  | { kind: 'absent' }
  | { kind: 'ambiguous'; reason: string };
type OpeningLoop = { kind: 'present'; edges: Set<Edge> } | { kind: 'absent' } | { kind: 'ambiguous'; reason: string };
export type CentralOpeningEvidence =
  | { kind: 'present'; edges: Uint32Array }
  | { kind: 'absent' }
  | { kind: 'ambiguous'; reason: string };

function openingHole(context: MeshContext, size: number): HoleRaster {
  const low: [number, number] = [Infinity, Infinity];
  const high: [number, number] = [-Infinity, -Infinity];
  for (const point of context.projected) for (let axis = 0; axis < 2; axis += 1) {
    low[axis] = Math.min(low[axis], point[axis]);
    high[axis] = Math.max(high[axis], point[axis]);
  }
  const scale = (size - 4) / Math.max(high[0] - low[0], high[1] - low[1]);
  const pixels = context.projected.map((point) => [(point[0] - low[0]) * scale + 2, (point[1] - low[1]) * scale + 2] as [number, number]);
  const filled = new Uint8Array(size * size);
  const { indices } = context.mesh;
  for (let face = 0; face < indices.length / 3; face += 1) {
    const a = pixels[indices[face * 3]!]!, b = pixels[indices[face * 3 + 1]!]!, c = pixels[indices[face * 3 + 2]!]!;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-8) continue;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const px = x + 0.5, py = y + 0.5;
      const u = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
      const v = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
      if (u >= -1e-8 && v >= -1e-8 && 1 - u - v >= -1e-8) filled[y * size + x] = 1;
    }
  }
  const labels = new Int32Array(size * size);
  let id = 0;
  const holes: { id: number; count: number }[] = [];
  for (let start = 0; start < labels.length; start += 1) {
    if (filled[start] || labels[start]) continue;
    id += 1;
    const queue = [start]; labels[start] = id;
    let exterior = false;
    for (let head = 0; head < queue.length; head += 1) {
      const cell = queue[head]!, x = cell % size, y = Math.floor(cell / size);
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) exterior = true;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const next = ny * size + nx;
        if (!filled[next] && !labels[next]) { labels[next] = id; queue.push(next); }
      }
    }
    if (!exterior) holes.push({ id, count: queue.length });
  }
  if (holes.length === 0) return { kind: 'absent' };
  if (holes.length !== 1 || holes[0]!.count < size * size * 0.01) return { kind: 'ambiguous', reason: 'projected-holes-uncertain' };
  return { kind: 'present', labels, id: holes[0]!.id, pixels };
}

function openingContour(context: MeshContext, size: number): OpeningLoop {
  const hole = openingHole(context, size);
  if (hole.kind !== 'present') return hole;
  const selected: Edge[] = [];
  for (const edge of context.edges.values()) {
    const first = dot(context.normals[edge.faces[0]!]!, context.rim.openingDirection);
    const second = dot(context.normals[edge.faces[1]!]!, context.rim.openingDirection);
    if (first * second > 0) continue;
    const a = hole.pixels[edge.a]!, b = hole.pixels[edge.b]!;
    const x = Math.round((a[0] + b[0]) / 2), y = Math.round((a[1] + b[1]) / 2);
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < size && ny >= 0 && ny < size && hole.labels[ny * size + nx] === hole.id) { near = true; break; }
    }
    if (near) selected.push(edge);
  }
  const graph = new Map<number, Edge[]>();
  for (const edge of selected) for (const index of [edge.a, edge.b]) {
    const incident = graph.get(index) ?? [];
    incident.push(edge);
    graph.set(index, incident);
  }
  const branch = [...graph.keys()].filter((index) => graph.get(index)!.length > 2);
  if (branch.length > 1 || [...graph.values()].some((incident) => incident.length !== 2 && incident.length !== 4)) return { kind: 'ambiguous', reason: 'opening-loop-branched' };
  if (branch.length === 0) return selected.length > 50 && components(selected).length === 1
    ? { kind: 'present', edges: new Set(selected) } : { kind: 'ambiguous', reason: 'opening-loop-not-closed' };
  const centre = branch[0]!;
  const visited = new Set<Edge>();
  const loops: Set<Edge>[] = [];
  for (const startEdge of graph.get(centre)!) {
    if (visited.has(startEdge)) continue;
    const path = new Set<Edge>();
    let current = startEdge.a === centre ? startEdge.b : startEdge.a;
    let edge = startEdge;
    while (!visited.has(edge)) {
      visited.add(edge); path.add(edge);
      if (current === centre) break;
      const next = graph.get(current)!.find((candidate) => candidate !== edge);
      if (!next) break;
      edge = next;
      current = next.a === current ? next.b : next.a;
    }
    if (current === centre) loops.push(path);
  }
  loops.sort((a, b) => b.size - a.size);
  if (!loops[0] || loops[0].size < 50 || loops.length > 2 || (loops[1] && loops[1].size > 10)) return { kind: 'ambiguous', reason: 'opening-loop-not-isolated' };
  return { kind: 'present', edges: loops[0] };
}

function pairs(edges: Set<Edge>): Uint32Array {
  const result = new Uint32Array(edges.size * 2);
  let at = 0;
  for (const edge of [...edges].sort((a, b) => a.key - b.key)) { result[at++] = edge.a; result[at++] = edge.b; }
  return result;
}

function centralOpening(context: MeshContext): OpeningLoop {
  const low = openingContour(context, 256);
  const high = openingContour(context, 512);
  if (low.kind === 'absent' && high.kind === 'absent') return { kind: 'absent' };
  if (low.kind !== 'present' || high.kind !== 'present') return { kind: 'ambiguous', reason: 'opening-resolution-disagreement' };
  if (low.edges.size !== high.edges.size || [...low.edges].some((edge) => !high.edges.has(edge))) {
    return { kind: 'ambiguous', reason: 'opening-contour-unstable' };
  }
  return high;
}

/** Missing projected opening is distinct from an uncertain or failed loop lift. Neither grants permission. */
export function inspectDentalCentralOpening(mesh: TriangleMesh, rim: DentalRim): CentralOpeningEvidence {
  const context = buildContext(mesh, rim);
  if (!context) return { kind: 'ambiguous', reason: 'invalid-mesh' };
  const result = centralOpening(context);
  return result.kind === 'present' ? { kind: 'present', edges: pairs(result.edges) } : result;
}

/** Detects mesh-edge contours only. It does not classify faces or grant support permission. */
export function proposeDentalContours(mesh: TriangleMesh): DentalContourProposal {
  const orientation = proposeDentalOrientation(mesh);
  if (orientation.kind !== 'proposal') return fail(`orientation-${orientation.reason}`);
  const context = buildContext(mesh, orientation.rim);
  if (!context) return fail('non-manifold-or-degenerate-mesh');
  const outer = outerContour(context);
  if (!outer) return fail('outer-ridge-not-closed');
  const opening = centralOpening(context);
  if (opening.kind === 'absent') return fail('central-opening-absent');
  if (opening.kind === 'ambiguous') return fail(opening.reason);
  return { kind: 'proposal', context, outer: outer.edges, opening: opening.edges,
    outerEdges: pairs(outer.edges), outerRidgeEdges: pairs(outer.ridgeEdges),
    outerConnectorEdges: pairs(outer.connectorEdges), openingEdges: pairs(opening.edges),
    connectorLengths: outer.connectorLengths };
}
