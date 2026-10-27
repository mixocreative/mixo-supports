import './test-support/useNodeEngine';
/** Edge-network diagnosis for a neutral dental STL; optional SVG/GLB debug exports never alter the source mesh. */
import { readFileSync, writeFileSync } from 'node:fs';
import { proposeDentalOrientation } from '../src/core/analysis/dental';
import { placementMatrix, transformPositions } from './test-support/matrix';
import { cross, dot, normalize, subtract, type Vector } from '../src/core/vec3';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { parseStl } from './test-support/rustImport';
import { REFERENCE_PROFILE } from './test-support/referenceProfile';

const file = process.env.DENTAL_PROBE_FIXTURE;
if (!file) throw new Error('DENTAL_PROBE_FIXTURE is required');
const bytes = readFileSync(file);
let mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
if (process.env.DENTAL_PROBE_ROTATION) {
  const angles = process.env.DENTAL_PROBE_ROTATION.split(',').map(Number);
  if (angles.length !== 3 || angles.some((angle) => !Number.isFinite(angle))) throw new Error('DENTAL_PROBE_ROTATION must be 3 comma-separated radians');
  mesh = { ...mesh, positions: transformPositions(mesh.positions, placementMatrix({ position: [0, 0, 0], rotation: angles as [number, number, number] })) };
}
const proposal = proposeDentalOrientation(mesh, REFERENCE_PROFILE);
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
  return components;
}

async function exportEdgeCandidates(output: string, selected: readonly Edge[], components: ReturnType<typeof summarize>,
  connectors: readonly number[][] = [], regionFaces?: readonly number[][], openingEdges: readonly Edge[] = [], reviewMode = false) {
  const scene = new THREE.Group();
  scene.name = 'Geometric edge candidates — not certified support boundaries';
  const addSurface = (indices: Uint32Array | number[], color: number, name: string, opacity = 1) => {
    const surface = new THREE.BufferGeometry();
    surface.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    surface.setIndex(new THREE.BufferAttribute(indices instanceof Uint32Array ? indices : new Uint32Array(indices), 1));
    surface.computeVertexNormals();
    const visual = new THREE.Mesh(surface, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide,
      transparent: opacity < 1, opacity }));
    visual.name = name;
    scene.add(visual);
  };
  if (regionFaces) regionFaces.forEach((indices, at) => addSurface(indices,
    reviewMode ? (at === 0 ? 0x1aa998 : 0xeceae5) : (at === 0 ? 0x27a69a : 0xea8c6b),
    reviewMode ? (at === 0 ? 'TEAL: proposed support-contact faces — awaiting owner approval' : 'NEUTRAL: all other faces, no proposed contacts')
      : `${at === 0 ? 'TEAL' : 'CORAL'}: topological face region ${at + 1} — unclassified`));
  else addSurface(mesh.indices, 0xf3efe7, 'Neutral reference aligner', 0.72);

  const cylinder = (items: readonly Edge[]) => {
    const positions: number[] = [];
    const indices: number[] = [];
    const radius = reviewMode ? 0.23 : 0.16;
    const sides = 6;
    for (const edge of items) {
      const a = new THREE.Vector3(...vertex(edge.a));
      const b = new THREE.Vector3(...vertex(edge.b));
      const axis = b.clone().sub(a).normalize();
      if (!Number.isFinite(axis.x)) continue;
      const across = new THREE.Vector3(0, 0, 1);
      if (Math.abs(axis.dot(across)) > 0.9) across.set(0, 1, 0);
      const u = new THREE.Vector3().crossVectors(axis, across).normalize();
      const v = new THREE.Vector3().crossVectors(axis, u).normalize();
      const base = positions.length / 3;
      for (const centre of [a, b]) for (let side = 0; side < sides; side += 1) {
        const angle = side * Math.PI * 2 / sides;
        const point = centre.clone().addScaledVector(u, Math.cos(angle) * radius).addScaledVector(v, Math.sin(angle) * radius);
        positions.push(point.x, point.y, point.z);
      }
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides;
        indices.push(base + side, base + next, base + sides + side,
          base + next, base + sides + next, base + sides + side);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };
  const groups = [
    { component: components[0], color: 0x007ed3, name: 'BLUE: large open full-arch sharp edge candidate' },
    { component: components[1], color: reviewMode ? 0xffd000 : 0xff9a00,
      name: `${reviewMode ? 'YELLOW' : 'ORANGE'}: smaller open partial sharp edge candidate` },
  ];
  for (const group of groups) {
    if (!group.component) continue;
    const members = new Set(group.component.members);
    const items = selected.filter((edge) => members.has(edge.a) && members.has(edge.b));
    const visual = new THREE.Mesh(cylinder(items), new THREE.MeshBasicMaterial({ color: group.color, side: THREE.DoubleSide }));
    visual.name = group.name;
    scene.add(visual);
  }
  const smallClosed = components.filter((component) => component.allDegreeTwo && component.vertices >= 6 && component.vertices < 100);
  if (smallClosed.length && !reviewMode) {
    const members = new Set(smallClosed.flatMap((component) => component.members));
    const visual = new THREE.Mesh(cylinder(selected.filter((edge) => members.has(edge.a) && members.has(edge.b))),
      new THREE.MeshBasicMaterial({ color: 0xd72cc1, side: THREE.DoubleSide }));
    visual.name = 'MAGENTA: tiny closed loops — false rim candidates';
    scene.add(visual);
  }
  for (const [at, path] of connectors.entries()) {
    if (path.length < 2) continue;
    const items = path.slice(1).map((index, step) => edges.get(path[step]! < index ? `${path[step]}:${index}` : `${index}:${path[step]}`)!);
    const visual = new THREE.Mesh(cylinder(items), new THREE.MeshBasicMaterial({ color: at === 0 ? 0x39c000 : 0x00ad70, side: THREE.DoubleSide }));
    visual.name = `GREEN ${at + 1}: 20-degree shortest sharp-network connector candidate, unverified`;
    scene.add(visual);
  }
  if (openingEdges.length) {
    const visual = new THREE.Mesh(cylinder(openingEdges), new THREE.MeshBasicMaterial({ color: 0xee1938, side: THREE.DoubleSide }));
    visual.name = 'RED: central projected opening silhouette loop candidate';
    scene.add(visual);
  }

  // GLTFExporter uses FileReader for its binary Blob even when no texture is present.
  class NodeFileReader {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    async readAsArrayBuffer(blob: Blob) {
      this.result = await blob.arrayBuffer();
      this.onloadend?.();
    }
  }
  (globalThis as unknown as { FileReader: typeof FileReader }).FileReader = NodeFileReader as unknown as typeof FileReader;
  const binary = await new GLTFExporter().parseAsync(scene, { binary: true });
  if (!(binary instanceof ArrayBuffer)) throw new Error('Expected binary GLB');
  writeFileSync(output, Buffer.from(binary));
  console.log(JSON.stringify({ label: 'edge-glb', output, bytes: binary.byteLength,
    largeChainEdges: components[0]?.vertices ? components[0].vertices - 1 : 0,
    partialChainEdges: components[1]?.vertices ? components[1].vertices - 1 : 0,
    smallClosedLoops: smallClosed.length }));
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
let outerCandidate: Set<Edge> | null = null;
let innerCandidate: Set<Edge> | null = null;
let connectorPathsForExport: number[][] = [];
const sharpComponents = new Map<number, ReturnType<typeof summarize>>();
const sharpEdges = new Map<number, Edge[]>();
for (const threshold of [10, 20, 30, 45, 60, 75]) {
  const limit = Math.cos(threshold * Math.PI / 180);
  const selected = [...edges.values()].filter((edge) => edge.faces.length === 2 && Math.abs(dot(normals[edge.faces[0]!]!, normals[edge.faces[1]!]!)) <= limit);
  const components = summarize(`sharp-${threshold}`, selected);
  if (process.env.DENTAL_PROBE_TRACK_CHAINS || process.env.DENTAL_PROBE_CONNECTORS) {
    sharpComponents.set(threshold, components);
    sharpEdges.set(threshold, selected);
  }
  if (threshold === 60) summarizeFaceCuts(selected);
  if (threshold === 60 && process.env.DENTAL_PROBE_GLB && !process.env.DENTAL_PROBE_CONNECTORS) await exportEdgeCandidates(process.env.DENTAL_PROBE_GLB, selected, components);
}
if (process.env.DENTAL_PROBE_CONNECTORS) {
  const baselines = sharpComponents.get(60)?.slice(0, 2) ?? [];
  const baselineEdges = sharpEdges.get(60) ?? [];
  const degree = new Map<number, number>();
  for (const component of baselines) {
    const members = new Set(component.members);
    for (const edge of baselineEdges) if (members.has(edge.a) && members.has(edge.b)) {
      degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
      degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
    }
  }
  const ends = baselines.map((component) => component.members.filter((index) => degree.get(index) === 1));
  const baselineMembers = baselines.map((component) => new Set(component.members));
  const excluded = new Set(baselineEdges.filter((edge) => baselineMembers.some((members) => members.has(edge.a) && members.has(edge.b))));
  const graph = new Map<number, { next: number; length: number }[]>();
  for (const edge of sharpEdges.get(20) ?? []) {
    if (excluded.has(edge)) continue;
    const a = vertex(edge.a), b = vertex(edge.b);
    const length = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    for (const [from, to] of [[edge.a, edge.b], [edge.b, edge.a]]) {
      const neighbors = graph.get(from) ?? [];
      neighbors.push({ next: to, length });
      graph.set(from, neighbors);
    }
  }
  const shortest = (start: number, end: number) => {
    const distance = new Map<number, number>([[start, 0]]);
    const previous = new Map<number, number>();
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
      if (cost !== distance.get(index)) continue;
      if (index === end) break;
      for (const { next, length } of graph.get(index) ?? []) {
        const candidate = cost + length;
        if (candidate >= (distance.get(next) ?? Infinity)) continue;
        distance.set(next, candidate);
        previous.set(next, index);
        push({ index: next, cost: candidate });
      }
    }
    const path = [end];
    if (!distance.has(end)) return { length: null, path: [] as number[] };
    while (path[0] !== start) path.unshift(previous.get(path[0]!)!);
    return { length: distance.get(end)!, path };
  };
  const first = ends[0] ?? [], second = ends[1] ?? [];
  const connectorPaths: number[][] = [];
  for (let pair = 0; pair < 2; pair += 1) {
    const a = first[pair]!, b = second[pair]!, alternate = second[1 - pair]!;
    if (a === undefined || b === undefined) continue;
    const direct = shortest(a, b), crossed = shortest(a, alternate);
    if (crossed.path.length) connectorPaths.push(crossed.path);
    for (const [label, result] of [['matched', direct], ['crossed', crossed]] as const) {
      const axial = result.path.map((index) => coordinates[index]![2]);
      console.log(JSON.stringify({ label: `connector-${pair}-${label}`, from: coordinates[a], to: coordinates[label === 'matched' ? b : alternate],
        length: result.length, vertices: result.path.length,
        axialDepth: axial.length ? [Math.min(...axial), Math.max(...axial)] : null,
        samples: Array.from({ length: result.path.length ? 7 : 0 }, (_, at) => coordinates[result.path[Math.round((result.path.length - 1) * at / 6)]!]!.map((value) => Math.round(value * 100) / 100)) }));
    }
  }
  connectorPathsForExport = connectorPaths;
  const proposed = new Set<Edge>(excluded);
  for (const path of connectorPaths) for (let step = 1; step < path.length; step += 1) {
    const a = path[step - 1]!, b = path[step]!;
    proposed.add(edges.get(a < b ? `${a}:${b}` : `${b}:${a}`)!);
  }
  outerCandidate = proposed;
  const proposedDegree = new Map<number, number>();
  for (const edge of proposed) for (const index of [edge.a, edge.b]) proposedDegree.set(index, (proposedDegree.get(index) ?? 0) + 1);
  const faceParent = Int32Array.from({ length: mesh.indices.length / 3 }, (_, index) => index);
  const findFace = (start: number): number => {
    let root = start;
    while (faceParent[root] !== root) root = faceParent[root]!;
    while (start !== root) { const next = faceParent[start]!; faceParent[start] = root; start = next; }
    return root;
  };
  for (const edge of edges.values()) if (edge.faces.length === 2 && !proposed.has(edge)) {
    faceParent[findFace(edge.faces[0]!)] = findFace(edge.faces[1]!);
  }
  const regionSizes = new Map<number, number>();
  for (let face = 0; face < faceParent.length; face += 1) {
    const root = findFace(face);
    regionSizes.set(root, (regionSizes.get(root) ?? 0) + 1);
  }
  console.log(JSON.stringify({ label: 'candidate-outer-loop-topology', blockedEdges: proposed.size,
    vertices: proposedDegree.size, nonDegreeTwo: [...proposedDegree.values()].filter((count) => count !== 2).length,
    faceRegions: regionSizes.size, largestRegions: [...regionSizes.values()].sort((a, b) => b - a).slice(0, 5) }));
  if (process.env.DENTAL_PROBE_GLB) await exportEdgeCandidates(process.env.DENTAL_PROBE_GLB, baselineEdges, baselines, connectorPaths);
}
if (process.env.DENTAL_PROBE_TRACK_CHAINS) {
  const baseline = sharpComponents.get(60)?.slice(0, 2) ?? [];
  for (const threshold of [45, 30, 20, 10]) {
    const components = sharpComponents.get(threshold) ?? [];
    console.log(JSON.stringify({ label: `sharp-${threshold}-tracks-sharp-60`, chains: baseline.map((chain) => {
      const anchor = chain.members[0];
      const host = components.find((component) => component.members.includes(anchor!));
      const memberSet = new Set(host?.members ?? []);
      return { baselineVertices: chain.vertices, hostVertices: host?.vertices ?? 0,
        overlap: chain.members.filter((member) => memberSet.has(member)).length,
        hostDepthExtent: host?.extent[2] ?? 0 };
    }) }));
  }
}
if (process.env.DENTAL_PROBE_OPENING) {
  const measureProjection = (size: number) => {
    const low = [Infinity, Infinity], high = [-Infinity, -Infinity];
    for (const point of coordinates) for (let axis = 0; axis < 2; axis += 1) {
      low[axis] = Math.min(low[axis]!, point[axis]!);
      high[axis] = Math.max(high[axis]!, point[axis]!);
    }
    const scale = (size - 4) / Math.max(high[0]! - low[0]!, high[1]! - low[1]!);
    const projected = coordinates.map((point) => [(point[0] - low[0]!) * scale + 2, (point[1] - low[1]!) * scale + 2] as const);
    const occupied = new Uint8Array(size * size);
    for (let face = 0; face < mesh.indices.length / 3; face += 1) {
      const a = projected[mesh.indices[face * 3]!]!, b = projected[mesh.indices[face * 3 + 1]!]!, c = projected[mesh.indices[face * 3 + 2]!]!;
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-8) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
        const px = x + 0.5, py = y + 0.5;
        const u = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const v = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const w = 1 - u - v;
        if (u >= -1e-8 && v >= -1e-8 && w >= -1e-8) occupied[y * size + x] = 1;
      }
    }
    const labels = new Int32Array(size * size);
    let label = 0;
    const holes: { id: number; pixels: number; perimeterPixels: number; low: number[]; high: number[]; centroid: number[] }[] = [];
    for (let start = 0; start < labels.length; start += 1) {
      if (occupied[start] || labels[start]) continue;
      label += 1;
      const queue = [start]; labels[start] = label;
      let exterior = false, perimeterPixels = 0, sumX = 0, sumY = 0;
      const bounds = { low: [Infinity, Infinity], high: [-Infinity, -Infinity] };
      for (let head = 0; head < queue.length; head += 1) {
        const current = queue[head]!, x = current % size, y = Math.floor(current / size);
        if (x === 0 || y === 0 || x === size - 1 || y === size - 1) exterior = true;
        sumX += x; sumY += y;
        bounds.low[0] = Math.min(bounds.low[0]!, x); bounds.low[1] = Math.min(bounds.low[1]!, y);
        bounds.high[0] = Math.max(bounds.high[0]!, x); bounds.high[1] = Math.max(bounds.high[1]!, y);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const next = ny * size + nx;
          if (occupied[next]) { perimeterPixels += 1; continue; }
          if (!labels[next]) { labels[next] = label; queue.push(next); }
        }
      }
      if (!exterior) holes.push({ id: label, pixels: queue.length, perimeterPixels,
        low: bounds.low.map((value, axis) => low[axis]! + (value - 2) / scale),
        high: bounds.high.map((value, axis) => low[axis]! + (value - 2) / scale),
        centroid: [low[0]! + (sumX / queue.length - 2) / scale, low[1]! + (sumY / queue.length - 2) / scale] });
    }
    holes.sort((a, b) => b.pixels - a.pixels);
    if (holes[0]) {
      const holeId = holes[0].id;
      const candidate: Edge[] = [];
      for (const edge of edges.values()) {
        if (edge.faces.length !== 2) continue;
        const axialA = dot(normals[edge.faces[0]!]!, rim.openingDirection);
        const axialB = dot(normals[edge.faces[1]!]!, rim.openingDirection);
        if (axialA * axialB > 0) continue;
        const a = projected[edge.a]!, b = projected[edge.b]!;
        const x = Math.round((a[0] + b[0]) / 2), y = Math.round((a[1] + b[1]) / 2);
        let nearHole = false;
        for (let dy = -2; dy <= 2 && !nearHole; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < size && ny >= 0 && ny < size && labels[ny * size + nx] === holeId) { nearHole = true; break; }
        }
        if (nearHole) candidate.push(edge);
      }
      summarize(`projected-inner-silhouette-edges-${size}`, candidate);
      const adjacency = new Map<number, number[]>();
      for (const edge of candidate) for (const [from, to] of [[edge.a, edge.b], [edge.b, edge.a]]) {
        const next = adjacency.get(from) ?? [];
        next.push(to);
        adjacency.set(from, next);
      }
      const degreeHistogram = new Map<number, number>();
      for (const next of adjacency.values()) degreeHistogram.set(next.length, (degreeHistogram.get(next.length) ?? 0) + 1);
      const branch = [...adjacency.keys()].find((index) => adjacency.get(index)!.length > 2);
      const visited = new Set<string>();
      const loops: number[][] = [];
      if (branch !== undefined) for (const neighbor of adjacency.get(branch)!) {
        const firstKey = branch < neighbor ? `${branch}:${neighbor}` : `${neighbor}:${branch}`;
        if (visited.has(firstKey)) continue;
        const loop = [branch, neighbor];
        visited.add(firstKey);
        while (loop.at(-1) !== branch && loop.length <= adjacency.size) {
          const current = loop.at(-1)!, prior = loop.at(-2)!;
          const next = adjacency.get(current)!.find((index) => index !== prior);
          if (next === undefined) break;
          const key = current < next ? `${current}:${next}` : `${next}:${current}`;
          if (visited.has(key)) break;
          visited.add(key);
          loop.push(next);
        }
        if (loop.at(-1) === branch) loops.push(loop);
      }
      console.log(JSON.stringify({ label: `projected-inner-silhouette-cycles-${size}`, degreeHistogram: [...degreeHistogram],
        loops: loops.map((loop) => {
          const points = loop.map((index) => coordinates[index]!);
          return { edges: loop.length - 1, extent: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]!)) - Math.min(...points.map((point) => point[axis]!))),
            projectedCentroid: [0, 1].map((axis) => points.reduce((sum, point) => sum + point[axis]!, 0) / points.length) };
        }) }));
      const mainLoop = loops.sort((a, b) => b.length - a.length)[0];
      if (size === 512 && mainLoop && mainLoop.length > 50) {
        innerCandidate = new Set(mainLoop.slice(1).map((index, step) => {
          const prior = mainLoop[step]!;
          return edges.get(prior < index ? `${prior}:${index}` : `${index}:${prior}`)!;
        }));
      }
    }
    return { size, occupiedPixels: occupied.reduce((sum, value) => sum + value, 0),
      holes: holes.length, largest: holes.slice(0, 4).map(({ id: _id, ...hole }) => hole) };
  };
  for (const size of [256, 384, 512]) console.log(JSON.stringify({ label: 'projected-opening', ...measureProjection(size) }));
}
if (outerCandidate && innerCandidate) {
  const blocked = new Set<Edge>([...outerCandidate, ...innerCandidate]);
  const faceParent = Int32Array.from({ length: mesh.indices.length / 3 }, (_, index) => index);
  const findFace = (start: number): number => {
    let root = start;
    while (faceParent[root] !== root) root = faceParent[root]!;
    while (start !== root) { const next = faceParent[start]!; faceParent[start] = root; start = next; }
    return root;
  };
  for (const edge of edges.values()) if (edge.faces.length === 2 && !blocked.has(edge)) faceParent[findFace(edge.faces[0]!)] = findFace(edge.faces[1]!);
  const regions = new Map<number, { faces: number; openingDot: number; positiveFacing: number }>();
  for (let face = 0; face < faceParent.length; face += 1) {
    const root = findFace(face);
    const region = regions.get(root) ?? { faces: 0, openingDot: 0, positiveFacing: 0 };
    const axial = dot(normals[face]!, rim.openingDirection);
    region.faces += 1;
    region.openingDot += axial;
    if (axial > 0.5) region.positiveFacing += 1;
    regions.set(root, region);
  }
  console.log(JSON.stringify({ label: 'two-contour-face-cut', blockedEdges: blocked.size, regions: regions.size,
    largest: [...regions.values()].sort((a, b) => b.faces - a.faces).slice(0, 6).map((region) => ({ faces: region.faces,
      meanOpeningDot: region.openingDot / region.faces, positiveFacingFraction: region.positiveFacing / region.faces })) }));
  if (process.env.DENTAL_PROBE_REGION_GLB) {
    const roots = [...regions.entries()].sort((a, b) => b[1].faces - a[1].faces).map(([root]) => root);
    const regionIndices = roots.map(() => [] as number[]);
    for (let face = 0; face < faceParent.length; face += 1) {
      const at = roots.indexOf(findFace(face));
      if (at < 0) continue;
      regionIndices[at]!.push(mesh.indices[face * 3]!, mesh.indices[face * 3 + 1]!, mesh.indices[face * 3 + 2]!);
    }
    await exportEdgeCandidates(process.env.DENTAL_PROBE_REGION_GLB, sharpEdges.get(60) ?? [], sharpComponents.get(60) ?? [],
      connectorPathsForExport, regionIndices, [...innerCandidate]);
  }
  if (process.env.DENTAL_PROBE_REVIEW_GLB) {
    if (regions.size !== 2) throw new Error('Review GLB requires exactly two bounded face regions');
    const roots = [...regions.entries()].sort((a, b) => b[1].faces - a[1].faces);
    if (!(roots[0]![1].openingDot > 0 && roots[1]![1].openingDot < 0)) throw new Error('Review GLB region signs are ambiguous');
    const regionIndices = roots.map(() => [] as number[]);
    const rootIndex = new Map(roots.map(([root], index) => [root, index]));
    for (let face = 0; face < faceParent.length; face += 1) {
      const at = rootIndex.get(findFace(face));
      if (at === undefined) continue;
      regionIndices[at]!.push(mesh.indices[face * 3]!, mesh.indices[face * 3 + 1]!, mesh.indices[face * 3 + 2]!);
    }
    await exportEdgeCandidates(process.env.DENTAL_PROBE_REVIEW_GLB, sharpEdges.get(60) ?? [], sharpComponents.get(60) ?? [],
      connectorPathsForExport, regionIndices, [...innerCandidate], true);
  }
}
for (const threshold of [10, 20, 30, 45, 60]) summarizeSmoothPatches(threshold);
