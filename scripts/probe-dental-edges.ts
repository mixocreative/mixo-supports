/** Read-only edge-network diagnosis for a neutral dental STL; never writes mesh data. */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseStl } from '../src/core/import/stl';
import { proposeDentalOrientation } from '../src/core/analysis/dental';
import { cross, dot, normalize, subtract, type Vector } from '../src/core/vec3';

const file = process.env.DENTAL_PROBE_FIXTURE;
if (!file) throw new Error('DENTAL_PROBE_FIXTURE is required');
const bytes = readFileSync(file);
const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
const proposal = proposeDentalOrientation(mesh);
if (proposal.kind !== 'proposal') throw new Error(`No opening proposal: ${proposal.reason}`);
const { rim } = proposal;
const centre = rim.centroid;
const vertex = (index: number): Vector => {
  const at = index * 3;
  return [mesh.positions[at]!, mesh.positions[at + 1]!, mesh.positions[at + 2]!];
};
type Edge = { a: number; b: number; faces: number[] };
const edges = new Map<string, Edge>();
const normals: Vector[] = [];
for (let face = 0; face < mesh.indices.length / 3; face += 1) {
  const at = face * 3;
  const ids = [mesh.indices[at]!, mesh.indices[at + 1]!, mesh.indices[at + 2]!];
  const [a, b, c] = ids.map(vertex) as [Vector, Vector, Vector];
  normals.push(normalize(cross(subtract(b, a), subtract(c, a))));
  for (let corner = 0; corner < 3; corner += 1) {
    const x = ids[corner]!;
    const y = ids[(corner + 1) % 3]!;
    const key = x < y ? `${x}:${y}` : `${y}:${x}`;
    const edge = edges.get(key);
    if (edge) edge.faces.push(face);
    else edges.set(key, { a: x, b: y, faces: [face] });
  }
}

const coordinates = Array.from({ length: mesh.positions.length / 3 }, (_, index) => {
  const delta = subtract(vertex(index), centre);
  return [dot(delta, rim.tangent), dot(delta, rim.bitangent), dot(delta, rim.openingDirection)] as const;
});
const global = [0, 1, 2].map((axis) => {
  let low = Infinity;
  let high = -Infinity;
  for (const point of coordinates) { low = Math.min(low, point[axis]!); high = Math.max(high, point[axis]!); }
  return high - low;
});

function summarize(label: string, selected: readonly Edge[]) {
  const graph = new Map<number, Set<number>>();
  for (const edge of selected) {
    const a = graph.get(edge.a) ?? new Set<number>();
    const b = graph.get(edge.b) ?? new Set<number>();
    a.add(edge.b); b.add(edge.a);
    graph.set(edge.a, a); graph.set(edge.b, b);
  }
  const seen = new Set<number>();
  const components: { vertices: number; allDegreeTwo: boolean; openVertices: number; extent: number[]; ratio: number[]; depth: [number, number]; members: number[] }[] = [];
  for (const start of graph.keys()) {
    if (seen.has(start)) continue;
    const queue = [start];
    seen.add(start);
    const members: number[] = [];
    while (queue.length) {
      const current = queue.pop()!;
      members.push(current);
      for (const next of graph.get(current)!) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    let openVertices = 0;
    for (const index of members) {
      if (graph.get(index)!.size !== 2) openVertices += 1;
      for (let axis = 0; axis < 3; axis += 1) {
        low[axis] = Math.min(low[axis]!, coordinates[index]![axis]!);
        high[axis] = Math.max(high[axis]!, coordinates[index]![axis]!);
      }
    }
    const extent = high.map((value, axis) => value - low[axis]!);
    components.push({ vertices: members.length, allDegreeTwo: openVertices === 0, openVertices, extent, ratio: extent.map((value, axis) => value / global[axis]!), depth: [low[2]!, high[2]!], members });
  }
  components.sort((a, b) => b.vertices - a.vertices);
  console.log(JSON.stringify({ label, edges: selected.length, components: components.length,
    closed: components.filter((component) => component.allDegreeTwo && component.vertices >= 6).length,
    fullArch: components.filter((component) => component.ratio[0]! > 0.6 && component.ratio[1]! > 0.6).length,
    largest: components.slice(0, 8).map(({ members: _members, ...summary }) => summary) }));
  if (label === 'sharp-60') for (const component of components.slice(0, 2)) {
    const ends = component.members.filter((index) => graph.get(index)!.size === 1);
    if (ends.length !== 2) continue;
    const path = [ends[0]!];
    let previous = -1;
    while (path.at(-1) !== ends[1] && path.length <= component.vertices) {
      const current = path.at(-1)!;
      const next = [...graph.get(current)!].find((index) => index !== previous);
      if (next === undefined) break;
      previous = current;
      path.push(next);
    }
    const samples = Array.from({ length: 11 }, (_, at) => coordinates[path[Math.round((path.length - 1) * at / 10)]!]!.map((value) => Math.round(value * 100) / 100));
    console.log(JSON.stringify({ label: `sharp-60-path-${component.vertices}`, pathVertices: path.length, ends: ends.map((index) => coordinates[index]), samples }));
    const sides = [{ faces: 0, openingDot: 0, positiveNormals: 0, negativeNormals: 0 }, { faces: 0, openingDot: 0, positiveNormals: 0, negativeNormals: 0 }];
    for (let at = 1; at < path.length; at += 1) {
      const from = path[at - 1]!, to = path[at]!;
      const edge = edges.get(from < to ? `${from}:${to}` : `${to}:${from}`)!;
      for (const face of edge.faces) {
        const ids = [mesh.indices[face * 3]!, mesh.indices[face * 3 + 1]!, mesh.indices[face * 3 + 2]!];
        const side = ids.some((index, corner) => index === from && ids[(corner + 1) % 3] === to) ? 0 : 1;
        const axial = dot(normals[face]!, rim.openingDirection);
        sides[side]!.faces += 1;
        sides[side]!.openingDot += axial;
        if (axial >= 0) sides[side]!.positiveNormals += 1; else sides[side]!.negativeNormals += 1;
      }
    }
    console.log(JSON.stringify({ label: `sharp-60-sides-${component.vertices}`, sides: sides.map((side) => ({
      faces: side.faces, meanOpeningDot: side.openingDot / Math.max(1, side.faces),
      positiveNormals: side.positiveNormals, negativeNormals: side.negativeNormals,
    })) }));
  }
}

function summarizeSmoothPatches(threshold: number) {
  const faceCount = mesh.indices.length / 3;
  const parent = Int32Array.from({ length: faceCount }, (_, index) => index);
  const find = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root]!;
    let next = start;
    while (next !== root) { const prior = parent[next]!; parent[next] = root; next = prior; }
    return root;
  };
  const limit = Math.cos(threshold * Math.PI / 180);
  for (const edge of edges.values()) {
    if (edge.faces.length !== 2) continue;
    const [a, b] = edge.faces;
    if (Math.abs(dot(normals[a!]!, normals[b!]!)) <= limit) continue;
    parent[find(a!)] = find(b!);
  }
  const patches = new Map<number, { faces: number; openingDot: number; openingFacing: number; low: number[]; high: number[] }>();
  for (let face = 0; face < faceCount; face += 1) {
    const root = find(face);
    const patch = patches.get(root) ?? { faces: 0, openingDot: 0, openingFacing: 0, low: [Infinity, Infinity, Infinity], high: [-Infinity, -Infinity, -Infinity] };
    const axial = dot(normals[face]!, rim.openingDirection);
    patch.faces += 1;
    patch.openingDot += axial;
    if (axial > 0.5) patch.openingFacing += 1;
    const indices = [mesh.indices[face * 3]!, mesh.indices[face * 3 + 1]!, mesh.indices[face * 3 + 2]!];
    for (const index of indices) for (let axis = 0; axis < 3; axis += 1) {
      patch.low[axis] = Math.min(patch.low[axis]!, coordinates[index]![axis]!);
      patch.high[axis] = Math.max(patch.high[axis]!, coordinates[index]![axis]!);
    }
    patches.set(root, patch);
  }
  const ranked = [...patches.entries()].sort((a, b) => b[1].faces - a[1].faces);
  const largest = ranked.slice(0, 8).map(([, patch]) => ({
    faces: patch.faces, meanOpeningDot: patch.openingDot / patch.faces,
    openingFacingFraction: patch.openingFacing / patch.faces,
    extent: patch.high.map((value, axis) => value - patch.low[axis]!), depth: [patch.low[2], patch.high[2]],
  }));
  console.log(JSON.stringify({ label: `smooth-patches-${threshold}`, patches: patches.size, largest }));
  if (threshold === 10 && process.env.DENTAL_PROBE_SVG) {
    const [first, second] = ranked;
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (const point of coordinates) for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis]!, point[axis]!);
      high[axis] = Math.max(high[axis]!, point[axis]!);
    }
    const views = [[0, 1], [0, 2], [1, 2]] as const;
    const marks: string[][][] = views.map(() => [[], [], []]);
    for (let face = 0; face < faceCount; face += 4) {
      const indices = [mesh.indices[face * 3]!, mesh.indices[face * 3 + 1]!, mesh.indices[face * 3 + 2]!];
      const centroid = [0, 1, 2].map((axis) => indices.reduce((sum, index) => sum + coordinates[index]![axis]!, 0) / 3);
      const root = find(face);
      const color = root === first?.[0] ? 1 : root === second?.[0] ? 2 : 0;
      views.forEach(([horizontal, vertical], view) => {
        const x = view * 800 + 40 + (centroid[horizontal]! - low[horizontal]!) / (high[horizontal]! - low[horizontal]!) * 720;
        const y = 760 - (centroid[vertical]! - low[vertical]!) / (high[vertical]! - low[vertical]!) * 720;
        marks[view]![color]!.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.25"/>`);
      });
    }
    const panels = marks.map((panel, view) => `<text x="${view * 800 + 40}" y="30" font-size="22" fill="#333">${['opening plane', 'transverse / depth', 'sagittal / depth'][view]}</text><g fill="#a6a39a" opacity="0.6">${panel[0]!.join('')}</g><g fill="#168a7a" opacity="0.75">${panel[1]!.join('')}</g><g fill="#bf4b53" opacity="0.75">${panel[2]!.join('')}</g>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 800"><rect width="2400" height="800" fill="#efede8"/>${panels}</svg>`;
    writeFileSync(process.env.DENTAL_PROBE_SVG, svg);
  }
}

function summarizeFaceCuts(selected: readonly Edge[]) {
  const vertexEdges = new Map<number, Edge[]>();
  for (const edge of selected) for (const index of [edge.a, edge.b]) {
    const incident = vertexEdges.get(index) ?? [];
    incident.push(edge);
    vertexEdges.set(index, incident);
  }
  const seen = new Set<number>();
  const barriers: Set<Edge>[] = [];
  for (const start of vertexEdges.keys()) {
    if (seen.has(start)) continue;
    const queue = [start]; seen.add(start);
    const component = new Set<Edge>();
    while (queue.length) {
      const current = queue.pop()!;
      for (const edge of vertexEdges.get(current)!) {
        component.add(edge);
        const next = edge.a === current ? edge.b : edge.a;
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    barriers.push(component);
  }
  barriers.sort((a, b) => b.size - a.size);
  const main = barriers[0];
  if (main) {
    const degree = new Map<number, number>();
    for (const edge of main) for (const index of [edge.a, edge.b]) degree.set(index, (degree.get(index) ?? 0) + 1);
    const endpoints = [...degree.entries()].filter(([, count]) => count === 1).map(([index]) => index);
    const weak = Math.cos(10 * Math.PI / 180);
    const graph = new Map<number, number[]>();
    for (const edge of edges.values()) {
      if (main.has(edge) || edge.faces.length !== 2 || Math.abs(dot(normals[edge.faces[0]!]!, normals[edge.faces[1]!]!)) > weak) continue;
      for (const [from, to] of [[edge.a, edge.b], [edge.b, edge.a]]) {
        const next = graph.get(from) ?? [];
        next.push(to);
        graph.set(from, next);
      }
    }
    if (endpoints.length === 2) {
      const [start, end] = endpoints;
      const previous = new Map<number, number>();
      const queue = [start!]; previous.set(start!, -1);
      for (let head = 0; head < queue.length && !previous.has(end!); head += 1) {
        for (const next of graph.get(queue[head]!) ?? []) if (!previous.has(next)) { previous.set(next, queue[head]!); queue.push(next); }
      }
      const path: number[] = [];
      if (previous.has(end!)) for (let next = end!; next !== -1; next = previous.get(next)!) path.push(next);
      const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
      for (const index of path) for (let axis = 0; axis < 3; axis += 1) {
        low[axis] = Math.min(low[axis]!, coordinates[index]![axis]!);
        high[axis] = Math.max(high[axis]!, coordinates[index]![axis]!);
      }
      console.log(JSON.stringify({ label: 'sharp-10-alternate-main-chain', reachableVertices: queue.length,
        pathVertices: path.length, extent: path.length ? high.map((value, axis) => value - low[axis]!) : [],
        samples: Array.from({ length: path.length ? 11 : 0 }, (_, at) => coordinates[path[Math.round((path.length - 1) * at / 10)]!]!.map((value) => Math.round(value * 100) / 100)) }));
    }
  }
  const faceCount = mesh.indices.length / 3;
  for (const count of [1, 2]) {
    const blocked = new Set([...barriers.slice(0, count).flatMap((component) => [...component])]);
    const parent = Int32Array.from({ length: faceCount }, (_, index) => index);
    const find = (start: number): number => {
      let root = start;
      while (parent[root] !== root) root = parent[root]!;
      let next = start;
      while (next !== root) { const prior = parent[next]!; parent[next] = root; next = prior; }
      return root;
    };
    for (const edge of edges.values()) {
      if (edge.faces.length !== 2 || blocked.has(edge)) continue;
      parent[find(edge.faces[0]!)] = find(edge.faces[1]!);
    }
    const sizes = new Map<number, number>();
    for (let face = 0; face < faceCount; face += 1) {
      const root = find(face);
      sizes.set(root, (sizes.get(root) ?? 0) + 1);
    }
    console.log(JSON.stringify({ label: `face-cut-largest-${count}-sharp-60-chains`, barrierEdges: blocked.size,
      regions: sizes.size, largest: [...sizes.values()].sort((a, b) => b - a).slice(0, 5) }));
  }
}

console.log(JSON.stringify({ label: 'mesh', vertices: mesh.positions.length / 3, faces: mesh.indices.length / 3, edges: edges.size,
  globalExtent: global, boundaryEdges: [...edges.values()].filter((edge) => edge.faces.length === 1).length,
  nonManifoldEdges: [...edges.values()].filter((edge) => edge.faces.length > 2).length }));
summarize('boundary', [...edges.values()].filter((edge) => edge.faces.length === 1));
for (const threshold of [10, 20, 30, 45, 60, 75]) {
  const limit = Math.cos(threshold * Math.PI / 180);
  const selected = [...edges.values()].filter((edge) => edge.faces.length === 2 && Math.abs(dot(normals[edge.faces[0]!]!, normals[edge.faces[1]!]!)) <= limit);
  summarize(`sharp-${threshold}`, selected);
  if (threshold === 60) summarizeFaceCuts(selected);
}
for (const threshold of [10, 20, 30, 45, 60]) summarizeSmoothPatches(threshold);
