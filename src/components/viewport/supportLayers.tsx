import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { FULL_TIER_MAX } from '../../core/budget';
import type { SupportProblem } from '../../core/analysis/supportCheck';
import type { SupportPoint, TriangleMesh } from '../../core/analysis/types';
import type { GeneratedSupportMesh, SupportContact } from '../../core/supports/mesh';
import { warmZoneOverlay, zoneOverlay } from '../../core/supports/overlayMesh';
import { contactRadius, withShape } from '../../core/supports/settings';
import { buildVertexGrid, sameStamp, stampVertices, zonedVertices, type VertexGrid, type ZoneStamp } from '../../core/supports/zones';
import type { DentalRim } from '../../core/analysis/dental';
import { legacyBaselineVertices } from '../../dental/legacyArea';
import { dentalContactMask, isManualArea, type DentalAllowStamp, type DentalPolicy } from '../../core/analysis/dentalPolicy';
import { contactToRemove } from '../../editing/removal';
import { contactVertexRuns, selectionDelta } from '../../editing/selectionHighlight';
import type { PrintUnit } from '../../state/project';
import { resolveSettings } from '../../supports/unitSupports';
import { PREVIEW } from './style';
import { toGeometry } from './geometry';
import { dentalContourSegments, dentalFaceOverlay } from './dentalFaceOverlay';

export interface Hover {
  /** Unit-local point under the pointer and the surface normal there. */
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** The click would remove (Ctrl, or a support under the pointer). */
  remove: boolean;
}

/**
 * Support Edit Mode preview at the pointer: a ghost tip where a click adds a support, the
 * Remove radius ring with the contacts a click would remove highlighted, or (Drag over, zone
 * brush) the brush ring alone in its colour.
 */
export function EditPreview({ hover, unit, contacts, brush }: { hover: Hover; unit: PrintUnit; contacts: readonly SupportContact[]; brush?: { radius: number; color: string } }) {
  const settings = useMemo(() => resolveSettings(unit.settings), [unit.settings]);
  const points = useMemo(() => contacts.map((contact) => new THREE.Vector3(...contact.position)), [contacts]);
  const ringTurn = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hover.normal), [hover.normal]);
  const tipTurn = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hover.normal.clone().negate()), [hover.normal]);
  const radius = brush ? brush.radius : settings.eraseRadius;
  const hit = hover.remove && !brush ? contactToRemove(contacts, hover.point.toArray(), radius) : undefined;
  const doomed = hit ? [points[contacts.indexOf(hit)]!] : [];
  const length = settings.neckLength;
  const color = brush ? brush.color : hover.remove ? PREVIEW.remove : PREVIEW.ring;
  return <group>
    <mesh position={hover.point} quaternion={ringTurn} renderOrder={20}>
      <torusGeometry args={[radius, Math.max(0.03, radius * 0.025), 6, 48]} />
      <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.85} />
    </mesh>
    {!hover.remove && !brush && <mesh position={hover.point.clone().addScaledVector(hover.normal, length / 2)} quaternion={tipTurn} renderOrder={19}>
      <coneGeometry args={[settings.pillarDiameter / 2, length, 16]} />
      <meshBasicMaterial color={PREVIEW.add} transparent opacity={0.55} depthWrite={false} />
    </mesh>}
    {doomed.map((contact, index) => <mesh key={index} position={contact} renderOrder={21}>
      <sphereGeometry args={[Math.max(0.25, settings.pillarDiameter * 0.45), 12, 8]} />
      <meshBasicMaterial color={PREVIEW.remove} depthTest={false} transparent opacity={0.9} />
    </mesh>)}
  </group>;
}

/**
 * Paints the whole body (tip, pillar, foot) of the supports of the given contacts over the
 * supports themselves in `color` (red by default): solid at `opacity` 1, see-through below it. Shares the support
 * geometry's vertices.
 */
export function SupportBodies({ supports, geometry, ids, opacity, color = PREVIEW.remove }: { supports: GeneratedSupportMesh; geometry: THREE.BufferGeometry; ids: readonly string[]; opacity: number; color?: string }) {
  const key = ids.join(',');
  // Built in the effect, not memoised: the cleanup strips the shared attributes, so a geometry
  // must never outlive its effect (StrictMode runs mount, cleanup, mount on the same render).
  const [bodies, setBodies] = useState<THREE.BufferGeometry>();
  useEffect(() => {
    const wanted = new Set(ids);
    const parts = supports.components.filter((component) => component.contactId && wanted.has(component.contactId));
    if (parts.length === 0) {
      setBodies(undefined);
      return;
    }
    const index = new Uint32Array(parts.reduce((total, part) => total + part.count, 0));
    let offset = 0;
    for (const part of parts) {
      index.set(supports.indices.subarray(part.start, part.start + part.count), offset);
      offset += part.count;
    }
    const sub = new THREE.BufferGeometry();
    sub.setAttribute('position', geometry.getAttribute('position'));
    sub.setAttribute('normal', geometry.getAttribute('normal'));
    sub.setIndex(new THREE.BufferAttribute(index, 1));
    setBodies(sub);
    return () => {
      // Disposing frees the GPU buffers of every attribute still attached: keep the shared ones.
      sub.deleteAttribute('position');
      sub.deleteAttribute('normal');
      sub.dispose();
    };
  }, [key, supports, geometry]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!bodies) return null;
  const seeThrough = opacity < 1;
  // Drawn over the support it covers (polygon offset) and never pickable.
  return <mesh geometry={bodies} raycast={() => undefined} renderOrder={seeThrough ? 18 : 17}>
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} metalness={0} roughness={0.8} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} transparent={seeThrough} opacity={opacity} depthWrite={!seeThrough} />
  </mesh>;
}

/** Overlay refinement: edges up to 1 mm so a 2 mm brush dab shows on coarse faces, within a triangle budget. */
const OVERLAY_MAX_EDGE = 1;
const OVERLAY_MAX_TRIANGLES = 1_500_000;
/** Vertex grid cell size (mm), about a brush size. */
const ZONE_GRID_CELL = 2;

/** The zone layer's refined mesh and vertex grid for a model (cached per mesh, see `zoneOverlay`). */
const overlayOf = (mesh: TriangleMesh) => zoneOverlay(mesh, mesh.indices.length / 3 >= FULL_TIER_MAX ? Infinity : OVERLAY_MAX_EDGE, OVERLAY_MAX_TRIANGLES, ZONE_GRID_CELL);

/** Main-thread work per idle slice while warming the overlay (ms), well under a long task. */
const WARM_SLICE_MS = 12;

/** Works the zone layer's overlay out in idle slices once `ready` (the supports are built), so the first zone stroke finds it cached and no long task blocks the page. */
export function useWarmZoneOverlay(mesh: TriangleMesh | undefined, ready: boolean): void {
  useEffect(() => {
    if (!mesh || !ready) return;
    const infinite = mesh.indices.length / 3 >= FULL_TIER_MAX;
    const step = warmZoneOverlay(mesh, infinite ? Infinity : OVERLAY_MAX_EDGE, OVERLAY_MAX_TRIANGLES, ZONE_GRID_CELL, WARM_SLICE_MS);
    let cancel = () => {};
    const next = () => {
      const idle = typeof requestIdleCallback === 'function';
      const handle = idle ? requestIdleCallback(slice, { timeout: 2000 }) : setTimeout(slice, 20);
      cancel = () => (idle ? cancelIdleCallback(handle as number) : clearTimeout(handle as ReturnType<typeof setTimeout>));
    };
    const slice = () => {
      if (step()) next();
    };
    next();
    return () => cancel();
  }, [mesh, ready]);
}

/**
 * The no-support zones on the model surface, see-through blue over the model it covers. Drawn on
 * a finer copy of the model when its faces are too coarse for a brush dab (else it shares the
 * model's vertices); its own colour attribute carries alpha 1 on zoned vertices, 0 elsewhere.
 * A `zones` list that starts with the stamps already laid (a stroke in progress, or the stroke
 * just committed as saved copies) lays just the new stamps; any other change (undo, erase all, a
 * new model) recomputes every vertex. A vertex grid kept per model keeps both cheap.
 */
export function SurfaceStampLayer({ mesh, geometry, stamps, filledKind, color, opacity, baseline }: {
  mesh: TriangleMesh;
  geometry: THREE.BufferGeometry;
  stamps: readonly (ZoneStamp | DentalAllowStamp)[];
  filledKind: ZoneStamp['kind'] | DentalAllowStamp['kind'];
  color: string;
  opacity: number;
  /** An optional domain-owned baseline, applied before ordered brush stamps. */
  baseline?: Uint8Array;
}) {
  // The overlay engine needs only last-stamp-wins booleans; domain policy stays with its caller.
  const zones = useMemo(() => stamps.map((stamp): ZoneStamp => ({ ...stamp, kind: stamp.kind === filledKind ? 'paint' : 'erase' })), [stamps, filledKind]);
  // Built in the effect for the same reason as `SupportBodies`: the cleanup strips shared attributes.
  const [layer, setLayer] = useState<{ geometry: THREE.BufferGeometry; colors: THREE.BufferAttribute; zoned: Uint8Array; baseline: Uint8Array; grid: VertexGrid | undefined; applied: readonly ZoneStamp[] }>();
  useEffect(() => {
    // The refinement and grid are cached per model mesh; only the GPU copy is made per mount.
    // A large model (heavy-mesh tier "large") is not refined: its faces are fine enough, and the copy would cost too much.
    const { mesh: refined, grid } = overlayOf(mesh);
    const shared = refined === mesh;
    const sub = shared ? new THREE.BufferGeometry() : toGeometry(refined);
    if (shared) {
      sub.setAttribute('position', geometry.getAttribute('position'));
      sub.setAttribute('normal', geometry.getAttribute('normal'));
      sub.setIndex(geometry.getIndex());
    }
    const count = sub.getAttribute('position').count;
    // White RGB (the material sets the blue); alpha per vertex.
    const colors = new THREE.BufferAttribute(new Uint8Array(count * 4).fill(255), 4, true);
    sub.setAttribute('color', colors);
    const zoned = baseline?.slice() ?? new Uint8Array(count);
    setLayer({ geometry: sub, colors, zoned, baseline: zoned.slice(), grid, applied: [] });
    return () => {
      if (shared) {
        sub.deleteAttribute('position');
        sub.deleteAttribute('normal');
        sub.setIndex(null);
      }
      sub.dispose();
    };
  }, [mesh, geometry, baseline]);
  useEffect(() => {
    // A new model can run this once on the old layer (its shared attributes already stripped) before the rebuilt one arrives: skip it.
    if (!layer?.geometry.getAttribute('position')) return;
    const positions = layer.geometry.getAttribute('position').array as Float32Array;
    const normals = layer.geometry.getAttribute('normal').array as Float32Array;
    const done = layer.applied;
    if (done.length <= zones.length && done.every((stamp, index) => sameStamp(zones[index]!, stamp))) {
      for (let index = done.length; index < zones.length; index++) stampVertices(zones[index]!, positions, normals, layer.zoned, layer.grid);
    } else {
      layer.zoned.set(layer.baseline);
      for (const stamp of zones) stampVertices(stamp, positions, normals, layer.zoned, layer.grid);
    }
    layer.applied = zones;
    const rgba = layer.colors.array as Uint8Array;
    for (let v = 0; v < layer.zoned.length; v++) rgba[v * 4 + 3] = layer.zoned[v] ? 255 : 0;
    layer.colors.needsUpdate = true;
  }, [layer, zones]);
  if (!layer) return null;
  // Drawn over the model (polygon offset), never pickable.
  return <mesh geometry={layer.geometry} raycast={() => undefined} renderOrder={16}>
    <meshBasicMaterial color={color} vertexColors transparent opacity={opacity} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
  </mesh>;
}

export function ZoneLayer({ mesh, geometry, zones, opacity }: { mesh: TriangleMesh; geometry: THREE.BufferGeometry; zones: readonly ZoneStamp[]; opacity: number }) {
  return <SurfaceStampLayer mesh={mesh} geometry={geometry} stamps={zones} filledKind="paint" color={PREVIEW.zone} opacity={opacity} />;
}

export function DentalStampLayer({ mesh, geometry, policy, opacity }: { mesh: TriangleMesh; geometry: THREE.BufferGeometry; policy: DentalPolicy; opacity: number }) {
  // The baseline (the footprint the opening sees, from Rust) is computed off the render pass;
  // brush edits stay visible immediately and the generic layer composes them with this mask when it arrives.
  const [baseline, setBaseline] = useState<Uint8Array>();
  useEffect(() => {
    let cancelled = false;
    setBaseline(undefined);
    const timer = setTimeout(() => { if (!cancelled) setBaseline(legacyBaselineVertices(mesh, policy)); }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mesh, policy.rim, isManualArea(policy)]);
  return <SurfaceStampLayer mesh={mesh} geometry={geometry} stamps={policy.stamps} filledKind="allow" color={PREVIEW.dental} opacity={opacity} baseline={baseline} />;
}

/** The exact approved triangles only: shared vertices cannot bleed colour onto tooth faces. */
export function DentalFaceLayer({ mesh, policy, opacity }: { mesh: TriangleMesh; policy: Extract<DentalPolicy, { kind: 'two-contour' }>; opacity: number }) {
  const [layer, setLayer] = useState<{ geometry: THREE.BufferGeometry; colors: THREE.BufferAttribute;
    positions: Float32Array; normals: Float32Array; mask: Uint8Array; grid: VertexGrid | undefined;
    applied: readonly DentalAllowStamp[] }>();
  useEffect(() => {
    const { positions, normals } = dentalFaceOverlay(mesh, dentalContactMask(policy, mesh.indices.length / 3));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    const colors = new THREE.BufferAttribute(new Uint8Array(positions.length / 3 * 4).fill(255), 4, true);
    geometry.setAttribute('color', colors);
    setLayer({ geometry, colors, positions, normals, mask: new Uint8Array(positions.length / 3).fill(1),
      grid: buildVertexGrid(positions), applied: [] });
    return () => geometry.dispose();
  }, [mesh, policy.region]);
  useEffect(() => {
    if (!layer) return;
    const stamps = policy.stamps;
    const incremental = layer.applied.length <= stamps.length && layer.applied.every((stamp, at) => {
      const next = stamps[at]!;
      return stamp.kind === next.kind && sameStamp({ ...stamp, kind: 'paint' }, { ...next, kind: 'paint' });
    });
    if (!incremental) layer.mask.fill(1);
    for (let at = incremental ? layer.applied.length : 0; at < stamps.length; at += 1) {
      const stamp = stamps[at]!;
      stampVertices({ ...stamp, kind: stamp.kind === 'allow' ? 'paint' : 'erase' },
        layer.positions, layer.normals, layer.mask, layer.grid);
    }
    layer.applied = stamps;
    const rgba = layer.colors.array as Uint8Array;
    for (let vertex = 0; vertex < layer.mask.length; vertex += 1) rgba[vertex * 4 + 3] = layer.mask[vertex] ? 255 : 0;
    layer.colors.needsUpdate = true;
  }, [layer, policy.stamps]);
  if (!layer) return null;
  return <mesh geometry={layer.geometry} raycast={() => undefined} renderOrder={16}>
    <meshBasicMaterial color={PREVIEW.dental} vertexColors side={THREE.DoubleSide} transparent opacity={opacity}
      depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
  </mesh>;
}

/** Exact mesh edges, not a planar proxy for the non-planar dental trim. */
export function DentalRegionLines({ mesh, policy }: { mesh: TriangleMesh; policy: Extract<DentalPolicy, { kind: 'two-contour' }> }) {
  const lines = useMemo(() => [policy.region.outerEdges, policy.region.openingEdges].map((pairs) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(dentalContourSegments(mesh, pairs), 3));
    return geometry;
  }), [mesh, policy.region]);
  useEffect(() => () => lines.forEach((line) => line.dispose()), [lines]);
  return <group raycast={() => undefined} renderOrder={17}>
    <lineSegments geometry={lines[0]} raycast={() => undefined}><lineBasicMaterial color="#007ed3" depthTest={false} depthWrite={false} /></lineSegments>
    <lineSegments geometry={lines[1]} raycast={() => undefined}><lineBasicMaterial color="#ee1938" depthTest={false} depthWrite={false} /></lineSegments>
  </group>;
}

/** The proven lower-edge loop, held just above the model so the permitted area has a clear boundary. */
export function DentalRimLine({ rim }: { rim: DentalRim }) {
  const geometry = useMemo(() => {
    const line = new THREE.BufferGeometry();
    line.setAttribute('position', new THREE.BufferAttribute(rim.points.slice(), 3));
    return line;
  }, [rim.points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const offset = useMemo(() => new THREE.Vector3(...rim.openingDirection).multiplyScalar(0.035), [rim.openingDirection]);
  if (rim.boundaryKind !== 'lower-edge-loop') return null;
  return <group position={offset} raycast={() => undefined} renderOrder={17}>
    <lineLoop geometry={geometry} raycast={() => undefined}>
      <lineBasicMaterial color={PREVIEW.dental} transparent opacity={0.9} depthTest={false} depthWrite={false} />
    </lineLoop>
    <lineLoop geometry={geometry} scale={1.001} raycast={() => undefined}>
      <lineBasicMaterial color={PREVIEW.dental} transparent opacity={0.22} depthTest={false} depthWrite={false} />
    </lineLoop>
  </group>;
}

/** Step 2's actual reviewed contact set, drawn directly without building any support body. */
export function DentalTipMarkers({ points }: { points: readonly SupportPoint[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const size = new THREE.Vector3(0.42, 0.42, 0.42);
    points.forEach((point, index) => {
      position.set(...point.position).addScaledVector(new THREE.Vector3(...point.normal), 0.08);
      mesh.setMatrixAt(index, matrix.compose(position, new THREE.Quaternion(), size));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [points]);
  if (points.length === 0) return null;
  return <instancedMesh key={points.length} ref={ref} args={[undefined, undefined, points.length]} raycast={() => undefined} frustumCulled={false}>
    <sphereGeometry args={[1, 7, 5]} />
    <meshStandardMaterial color={PREVIEW.dental} roughness={0.65} />
  </instancedMesh>;
}

/** Contact ids a remove click at a unit-local point takes: the one nearest within Click reach. */
export function useDoomed(unit: PrintUnit, contacts: readonly SupportContact[], point: THREE.Vector3 | undefined): string[] {
  const eraseRadius = useMemo(() => resolveSettings(unit.settings).eraseRadius, [unit.settings]);
  if (!point) return [];
  const hit = contactToRemove(contacts, point.toArray(), eraseRadius);
  return hit ? [hit.id] : [];
}

/**
 * The altered mark (docs/design/ui-structure.md 11.2 rule 7): a small ring flat on the surface
 * around the tip of each support with settings of its own, in the ink grey. A shape and no new
 * hue, so it reads in grey scale and stays beside the selected red. One draw call for all of them.
 */
export function CustomisedMarks({ unit, contacts }: { unit: PrintUnit; contacts: readonly SupportContact[] }) {
  const settings = useMemo(() => resolveSettings(unit.settings), [unit.settings]);
  const marked = useMemo(() => contacts.filter((contact) => unit.contactSettings[contact.id] !== undefined), [contacts, unit.contactSettings]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const turn = new THREE.Quaternion();
    const matrix = new THREE.Matrix4();
    marked.forEach((contact, index) => {
      const radius = Math.max(0.7, contactRadius(withShape(settings, unit.contactSettings[contact.id])) * 3);
      turn.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...contact.normal).normalize());
      mesh.setMatrixAt(index, matrix.compose(new THREE.Vector3(...contact.position), turn, new THREE.Vector3(radius, radius, radius)));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [marked, settings, unit.contactSettings]);
  if (marked.length === 0) return null;
  // Keyed by count: an instanced mesh cannot grow. Drawn through the model like the check markers; never pickable.
  return <instancedMesh key={marked.length} ref={ref} args={[undefined, undefined, marked.length]} raycast={() => undefined} frustumCulled={false} renderOrder={22}>
    <torusGeometry args={[1, 0.09, 6, 28]} />
    <meshBasicMaterial color={PREVIEW.ring} depthTest={false} transparent opacity={0.9} />
  </instancedMesh>;
}

/** Support check findings, drawn through the model so hidden spots still show. */
export function ProblemMarkers({ problems }: { problems: readonly SupportProblem[] }) {
  return <group>
    {problems.map((problem, index) => <mesh key={index} position={problem.position} renderOrder={18}>
      <sphereGeometry args={[Math.min(2.5, 0.7 + Math.sqrt(problem.area) / 10), 16, 12]} />
      <meshBasicMaterial color={problem.kind === 'island' ? PREVIEW.island : PREVIEW.overhang} depthTest={false} transparent opacity={0.55} />
    </mesh>)}
  </group>;
}

/** Selected supports' colour in the vertex-colour highlight (stands in for red plus its glow). */
const SELECTED_COLOR = '#a8243c';
/** Above this many changed ranges a whole re-upload is cheaper than many small ones. */
const MAX_RANGES = 512;

/** Linear 8-bit RGB of a CSS colour (vertex colours are in the linear working space). */
function linearBytes(css: string): [number, number, number] {
  const color = new THREE.Color(css);
  return [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255)];
}

/**
 * The selection highlight as per-vertex colour on the support mesh itself: each change recolours
 * only the vertex ranges of supports that turned on or off (`selectionDelta`, `contactVertexRuns`)
 * and uploads just those ranges, instead of building a mesh of the selected bodies per paint.
 * Returns whether the mesh is coloured this way (Support Edit Mode, outside zones).
 */
export function useSelectionColors(geometry: THREE.BufferGeometry | undefined, supports: GeneratedSupportMesh | undefined, on: boolean, solid: ReadonlySet<string>, baseColor: string): boolean {
  const runs = useMemo(() => (on && supports ? contactVertexRuns(supports) : undefined), [on, supports]);
  const drawn = useRef<{ geometry?: THREE.BufferGeometry; base: string; ids: ReadonlySet<string> }>({ base: '', ids: new Set() });
  useLayoutEffect(() => {
    if (!geometry || !runs) return;
    const count = geometry.getAttribute('position').count;
    let colors = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    const fresh = !colors || colors.count !== count;
    if (!colors || fresh) {
      colors = new THREE.BufferAttribute(new Uint8Array(count * 3), 3, true);
      geometry.setAttribute('color', colors);
    }
    const array = colors.array as Uint8Array;
    const base = linearBytes(baseColor);
    const red = linearBytes(SELECTED_COLOR);
    const paint = (id: string, rgb: [number, number, number], ranges?: [number, number][]) => {
      for (const [start, end] of runs.get(id) ?? []) {
        for (let v = start; v < end; v++) array.set(rgb, v * 3);
        ranges?.push([start, end]);
      }
    };
    const last = drawn.current;
    const delta = fresh || last.geometry !== geometry || last.base !== baseColor ? undefined : selectionDelta(last.ids, solid);
    if (delta && delta.on.length === 0 && delta.off.length === 0) return;
    const ranges: [number, number][] = [];
    if (delta) {
      for (const id of delta.off) paint(id, base, ranges);
      for (const id of delta.on) paint(id, red, ranges);
    } else {
      for (let v = 0; v < count; v++) array.set(base, v * 3);
      for (const id of solid) paint(id, red);
    }
    colors.clearUpdateRanges();
    if (delta && ranges.length <= MAX_RANGES) for (const [start, end] of ranges) colors.addUpdateRange(start * 3, (end - start) * 3);
    colors.needsUpdate = true;
    drawn.current = { geometry, base: baseColor, ids: solid };
  }, [geometry, runs, solid, baseColor]);
  return Boolean(geometry && runs);
}
