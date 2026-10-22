import { ProjectFileError } from '../editing/project';
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
  try {
    return normalizeScene(file.scene as PrintScene);
  } catch (error) {
    throw new ProjectFileError('damaged', error instanceof Error ? error.message : String(error));
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

export async function unpackProject(file: Blob): Promise<PrintScene> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzipped = head.length === 2 && head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1];
  if (!gzipped) return decodeProject(await file.text());
  if (!canGzip) throw new ProjectFileError('damaged', 'This browser cannot read compressed files');
  let text: string;
  try {
    text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } catch {
    throw new ProjectFileError('damaged', 'Compressed data is damaged');
  }
  return decodeProject(text);
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
