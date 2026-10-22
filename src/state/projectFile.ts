import { refusalLimit } from '../core/budget';
import { ProjectFileError, ProjectTooLarge } from '../editing/project';
import { normalizeScene, sceneJsonReplacer, sceneJsonReviver, type PrintScene, type PrintUnit } from './project';

/** The project file: the scene's own JSON (project.ts) under a header that names the app and the format version. */
export const PROJECT_APP = 'mixo-supports';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.mixosupports';

export const isProjectFile = (name: string) => name.toLowerCase().endsWith(PROJECT_EXTENSION);

export function encodeProject(scene: PrintScene): string {
  return JSON.stringify({ app: PROJECT_APP, version: PROJECT_VERSION, scene: normalizeScene(scene) }, sceneJsonReplacer);
}

/** The scene a project file holds; throws a ProjectFileError for anything that is not a readable file of this version or older. */
export function decodeProject(text: string): PrintScene {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, sceneJsonReviver);
  } catch {
    throw new ProjectFileError('not-project', 'Not JSON');
  }
  const file = parsed as { app?: unknown; version?: unknown; scene?: unknown } | null;
  if (typeof file !== 'object' || file === null || file.app !== PROJECT_APP) throw new ProjectFileError('not-project', 'No Mixo Supports header');
  if (typeof file.version !== 'number' || !Number.isInteger(file.version) || file.version < 1) throw new ProjectFileError('damaged', 'Bad version field');
  if (file.version > PROJECT_VERSION) throw new ProjectFileError('newer', `Version ${file.version}`, { v: file.version, max: PROJECT_VERSION });
  const scene = file.scene as { units?: unknown } | null;
  if (typeof scene !== 'object' || scene === null || !Array.isArray(scene.units)) throw new ProjectFileError('damaged', 'No scene');
  assertSoundMeshes(scene.units);
  try {
    return normalizeScene(file.scene as PrintScene);
  } catch (error) {
    throw new ProjectFileError('damaged', error instanceof Error ? error.message : String(error));
  }
}

/** A mesh a file can hold: whole triangles, finite coordinates, every index naming a vertex. Anything else would reach the viewport and the support builders as garbage. */
function assertSoundMeshes(units: unknown[]): void {
  const damaged = (what: string) => new ProjectFileError('damaged', `Mesh data is damaged (${what})`);
  for (const unit of units) {
    const mesh = (unit as { source?: { positions?: unknown; indices?: unknown } } | null)?.source;
    if (!mesh || !(mesh.positions instanceof Float32Array) || !(mesh.indices instanceof Uint32Array)) throw damaged('no mesh arrays');
    const { positions, indices } = mesh;
    if (positions.length % 3 !== 0 || indices.length % 3 !== 0) throw damaged('not whole triangles');
    for (let i = 0; i < positions.length; i += 1) if (!Number.isFinite(positions[i])) throw damaged('a coordinate is not a number');
    const vertices = positions.length / 3;
    for (let i = 0; i < indices.length; i += 1) if (indices[i]! >= vertices) throw damaged('an index is past the last vertex');
  }
}

const GZIP_MAGIC = [0x1f, 0x8b];
const canGzip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** The project as file bytes: gzip where the browser can, else plain JSON (`unpackProject` reads both). */
export async function packProject(scene: PrintScene): Promise<Blob> {
  const json = new Blob([encodeProject(scene)]);
  if (!canGzip) return json;
  return new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

/** Plain JSON a triangle may take in a project file (its mesh, supports and edits), with room to spare; the byte cap before parsing is the triangle limit times this. */
export const PROJECT_BYTES_PER_TRIANGLE = 100;

/** The gunzipped text of a file, refused as too large once it passes `maxBytes` (the rest is never inflated). */
async function inflate(file: Blob, maxBytes: number, triangleLimit: number): Promise<string> {
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) break;
      chunks.push(value);
    }
  } catch {
    throw new ProjectFileError('damaged', 'Compressed data is damaged');
  }
  if (total > maxBytes) {
    await reader.cancel().catch(() => undefined);
    throw new ProjectTooLarge(Math.ceil(total / PROJECT_BYTES_PER_TRIANGLE), triangleLimit);
  }
  return new Blob(chunks as BlobPart[]).text();
}

/** The scene a project file holds. A file that would hold more than `triangleLimit` triangles is refused by its size before it is parsed. */
export async function unpackProject(file: Blob, triangleLimit: number = refusalLimit('web')): Promise<PrintScene> {
  const maxBytes = triangleLimit * PROJECT_BYTES_PER_TRIANGLE;
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzipped = head.length === 2 && head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1];
  if (!gzipped) {
    if (file.size > maxBytes) throw new ProjectTooLarge(Math.ceil(file.size / PROJECT_BYTES_PER_TRIANGLE), triangleLimit);
    return decodeProject(await file.text());
  }
  if (!canGzip) throw new ProjectFileError('damaged', 'This browser cannot read compressed files');
  return decodeProject(await inflate(file, maxBytes, triangleLimit));
}

/** Every buffer of the scene's typed arrays, to transfer. */
export function sceneBuffers(scene: PrintScene): Transferable[] {
  return scene.units.flatMap(({ source, placement }) => [
    source.positions.buffer, source.indices.buffer,
    ...(placement ? [placement.contactPositions.buffer, placement.contactNormals.buffer] : []),
  ]);
}

/** Triangles in every object of the scene. */
export const triangleCountOf = (scene: PrintScene): number => scene.units.reduce((sum, unit) => sum + unit.source.indices.length / 3, 0);

/** Whether two scenes hold the same work: every unit is the same object (selection and the active object do not count). */
export function sameUnits(a: PrintScene, b: PrintScene): boolean {
  return a.units.length === b.units.length && a.units.every((unit: PrintUnit, index) => unit === b.units[index]);
}

/** `<first object name or "project">.mixosupports`, with characters a file name cannot hold replaced. */
export function projectFileName(scene: PrintScene): string {
  const base = (scene.units[0]?.name ?? '').replace(/\.(stl|glb|gltf)$/i, '').replace(/[\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return `${base || 'project'}${PROJECT_EXTENSION}`;
}
