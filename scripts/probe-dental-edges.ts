/** Read-only edge-network diagnosis for a neutral dental STL; never writes mesh data. */
import { readFileSync } from 'node:fs';
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
  }
}

console.log(JSON.stringify({ label: 'mesh', vertices: mesh.positions.length / 3, faces: mesh.indices.length / 3, edges: edges.size,
  globalExtent: global, boundaryEdges: [...edges.values()].filter((edge) => edge.faces.length === 1).length,
  nonManifoldEdges: [...edges.values()].filter((edge) => edge.faces.length > 2).length }));
summarize('boundary', [...edges.values()].filter((edge) => edge.faces.length === 1));
for (const threshold of [10, 20, 30, 45, 60, 75]) {
  const limit = Math.cos(threshold * Math.PI / 180);
  summarize(`sharp-${threshold}`, [...edges.values()].filter((edge) => edge.faces.length === 2 && Math.abs(dot(normals[edge.faces[0]!]!, normals[edge.faces[1]!]!)) <= limit));
}
