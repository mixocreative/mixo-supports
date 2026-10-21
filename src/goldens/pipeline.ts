import { checkSupports, type SupportProblem } from '../analysis/supportCheck';
import { generatePlacement } from '../analysis/placement';
import type { SupportPoint, TriangleMesh } from '../analysis/types';
import { placeImportedUnits } from '../state/import';
import { emptyScene, type PrintUnit, type SupportSettings } from '../state/project';
import { applyTransform, inverseTransformDirection, inverseTransformPoint, transformPoint, type ModelTransform } from '../state/transform';
import { encodeStl, planExport } from '../supports/export';
import { contactAtTriangle, meshBounds, type GeneratedSupportMesh } from '../supports/mesh';
import { defaultSupportSettings, setRoofMode, toPlacementSettings, updateSetting, type LiveSupportSettings } from '../supports/settings';
import { unitContacts, unitSupportMesh } from '../supports/unitSupports';
import type { GoldenFixture, GoldenVariant } from './fixtures';

/**
 * Golden snapshots: the whole support pipeline (placement, support mesh, export, check) run the
 * way the app runs it on fixed models, reduced to exact JSON. Later refactors must reproduce it.
 */

/** Triangles sampled for `contactAtTriangle`. */
const PICK_SAMPLES = 20;

function variantSettings(variant: GoldenVariant): LiveSupportSettings {
  const base: LiveSupportSettings = { ...defaultSupportSettings, roofSeededModes: [] };
  if (variant === 'tree') return updateSetting(base, 'scatterAutoTree', true);
  if (variant === 'roof') return setRoofMode(base, 'ROOF');
  if (variant === 'low-poly') return updateSetting(base, 'lowPolyMode', true);
  if (variant === 'ridge-30') return updateSetting(base, 'scatterRidgeAngle', 30);
  if (variant === 'ridge-60') return updateSetting(base, 'scatterRidgeAngle', 60);
  return base;
}

/** Points to 1e-6 mm (and -0 as 0) so float noise below that never shows. */
function round(value: number, step = 1e6): number {
  return Math.round(value * step) / step + 0;
}
const roundVector = (vector: readonly number[]) => vector.map((value) => round(value));

/** 32-bit FNV-1a, fed 32-bit little-endian words. */
class Fnv1a {
  private hash = 0x811c9dc5;
  word(value: number): void {
    for (let shift = 0; shift < 32; shift += 8) this.byte((value >>> shift) & 0xff);
  }
  byte(value: number): void {
    this.hash = Math.imul(this.hash ^ value, 0x01000193) >>> 0;
  }
  hex(): string {
    return this.hash.toString(16).padStart(8, '0');
  }
}

/** Hash of a mesh: positions rounded to 1e-5 mm, then indices. */
export function meshHash(mesh: TriangleMesh): string {
  const fnv = new Fnv1a();
  for (const value of mesh.positions) fnv.word(Math.round(value * 1e5) | 0);
  for (const index of mesh.indices) fnv.word(index);
  return fnv.hex();
}

function bytesHash(buffer: ArrayBuffer): string {
  const fnv = new Fnv1a();
  for (const value of new Uint8Array(buffer)) fnv.byte(value);
  return fnv.hex();
}

/** Deterministic PRNG (mulberry32) for the sampled triangles. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stringSeed(text: string): number {
  const fnv = new Fnv1a();
  for (const char of text) fnv.byte(char.charCodeAt(0) & 0xff);
  return parseInt(fnv.hex(), 16);
}

/** The unit as import creates it, with the fixture's rotation (App: importFiles). */
function importedUnit(fixture: GoldenFixture, settings: LiveSupportSettings): PrintUnit {
  const [unit] = placeImportedUnits([{ name: fixture.name, mesh: fixture.mesh }], [], { lift: settings.liftHeight, createId: () => `unit-${fixture.name}` });
  return { ...unit!, transform: { ...unit!.transform, rotation: [...fixture.rotation] }, settings: settings as SupportSettings };
}

/** Automatic placement and the supported unit (App: generate). */
function generate(unit: PrintUnit, settings: LiveSupportSettings) {
  const lowest = meshBounds(applyTransform(unit.source, unit.transform)).min[1];
  const transform: ModelTransform = {
    position: [unit.transform.position[0], unit.transform.position[1] + settings.liftHeight - lowest, unit.transform.position[2]],
    rotation: [...unit.transform.rotation],
  };
  const orientation: ModelTransform = { position: [0, 0, 0], rotation: [...unit.transform.rotation] };
  const result = generatePlacement(applyTransform(unit.source, orientation), toPlacementSettings(settings));
  const points = result.points.map((point): SupportPoint => ({
    ...point,
    position: inverseTransformPoint(orientation, point.position),
    normal: inverseTransformDirection(orientation, point.normal),
  }));
  const supported: PrintUnit = {
    ...unit,
    transform,
    placement: {
      points,
      regions: result.regions,
      contactPositions: new Float32Array(points.flatMap((point) => point.position)),
      contactNormals: new Float32Array(points.flatMap((point) => point.normal)),
    },
    supports: { kind: 'live', data: { transform: { position: [...transform.position], rotation: [...transform.rotation] } } },
  };
  return { result, supported, orientation };
}

/** Support check problems (App: runCheck), in the checked frame. */
function check(unit: PrintUnit, settings: LiveSupportSettings, orientation: ModelTransform, keep: (index: number) => boolean) {
  const contacts = unitContacts(unit).filter((_, index) => keep(index)).map((contact) => transformPoint(orientation, contact.position));
  const problems = checkSupports(applyTransform(unit.source, orientation), contacts, { overhangAngleDegrees: settings.scatterAngle, spacing: settings.scatterSpacing });
  return problems.map((problem: SupportProblem) => ({ kind: problem.kind, position: roundVector(problem.position), area: round(problem.area) }));
}

function meshSummary(mesh: GeneratedSupportMesh) {
  return { vertices: mesh.positions.length / 3, triangles: mesh.indices.length / 3, hash: meshHash(mesh) };
}

/** Everything a golden records for one fixture and settings variant. */
export function goldenSnapshot(fixture: GoldenFixture, variant: GoldenVariant) {
  const settings = variantSettings(variant);
  const { result, supported, orientation } = generate(importedUnit(fixture, settings), settings);
  const preview = unitSupportMesh(supported, 0, 'preview');
  const exported = unitSupportMesh(supported, 0, 'export');

  // Export: the active unit's printable file, assembled the way the mesh worker does.
  const [file] = planExport({ ...emptyScene, units: [supported], selectedUnitIds: [supported.id], activeUnitId: supported.id }, 'active-printable');
  const stl = encodeStl(file!.parts
    .map((part) => ({ mesh: part.content === 'model' ? supported.source : exported, transform: supported.transform }))
    .filter((part) => part.mesh.indices.length > 0));

  const random = seeded(stringSeed(goldenName(fixture, variant)));
  const triangles = preview.indices.length / 3;
  const picks = Array.from({ length: triangles === 0 ? 0 : PICK_SAMPLES }, () => {
    const triangle = Math.floor(random() * triangles);
    return [triangle, contactAtTriangle(preview, triangle) ?? null];
  });

  return {
    fixture: fixture.name,
    variant,
    model: { vertices: fixture.mesh.positions.length / 3, triangles: fixture.mesh.indices.length / 3, hash: meshHash(fixture.mesh) },
    placement: {
      regions: result.regions.length,
      points: result.points.map((point) => ({ id: point.id, position: roundVector(point.position), normal: roundVector(point.normal), source: point.source })),
    },
    supportMesh: {
      ...meshSummary(preview),
      parts: preview.parts,
      components: preview.components.map((component) => [component.part, component.contactId ?? null, component.start, component.count]),
    },
    exportMesh: meshSummary(exported),
    stl: { bytes: stl.byteLength, hash: bytesHash(stl) },
    check: {
      allContacts: check(supported, settings, orientation, () => true),
      everyOtherContact: check(supported, settings, orientation, (index) => index % 2 === 0),
    },
    contactAtTriangle: picks,
  };
}

export type GoldenSnapshot = ReturnType<typeof goldenSnapshot>;

export function goldenName(fixture: GoldenFixture, variant: GoldenVariant): string {
  return `${fixture.name}.${variant}`;
}

/**
 * Throws on any number that JSON cannot hold (NaN, Infinity), which `JSON.stringify` would
 * otherwise turn into null and so compare equal to a stored null.
 */
export function assertFinite(value: unknown, path = '$'): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} is ${value}`);
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertFinite(item, `${path}.${key}`);
  }
}

/**
 * JSON with arrays of plain values on one line, so a snapshot stays readable and a diff points
 * at the component or point that changed.
 */
export function formatGolden(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== 'object')) return JSON.stringify(value);
    if (value.length === 0) return '[]';
    const inner = indent + '  ';
    return `[\n${value.map((item) => inner + formatGolden(item, inner)).join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const inner = indent + '  ';
    return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${formatGolden(item, inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** Paths where `actual` differs from `expected`, with both values, at most `limit` of them. */
export function goldenDiff(expected: unknown, actual: unknown, limit = 15): string[] {
  const found: string[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (found.length >= limit) return;
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) found.push(`${path}: length ${a.length} -> ${b.length}`);
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) found.push(`${path}: expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`);
  };
  walk(expected, actual, '$');
  return found;
}
