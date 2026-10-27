// @ts-nocheck -- uses Node fs/url/path/process; the project carries no Node types (see src/testFs.d.ts)
/*
 * Recorded golden files (SHIP-PLAN U9). The TypeScript oracle that used to run beside Rust in tests is gone;
 * its outputs were recorded once into compact JSON under scripts/fixtures/golden/ and the tests compare the
 * Rust results against those files with the rule-7 tolerances: IDs, tags, indices, omitted counts and verdicts
 * identical; vertex positions within 1e-5 mm.
 *
 * A test builds a plain-data snapshot of what Rust produced and calls `expectGolden(name, snapshot)`.
 * Big arrays go into the snapshot through two helpers so the file stays small:
 *   exactArray(values, kind)   { count, hash }          IDs, indices, masks: compared exactly (FNV-1a of the bytes)
 *   approxArray(values, step)  { count, step, sample }  positions / normals: strided sample, compared within tolerance
 * Strings, booleans and short lists are stored as they are. Numbers are compared within `tolerance`
 * (default 1e-5), everything else exactly.
 *
 * REGEN (only after an INTENDED output change; review the diff of scripts/fixtures/golden/ in the commit):
 *   UPDATE_GOLDENS=1 npx vitest run <the parity test file>
 * rewrites that test's golden files from the current Rust output (the original recordings came from the TS
 * oracle, see the U9 commit). Without the variable a missing golden is an error and a mismatch fails.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const directory = new URL('../fixtures/golden/', import.meta.url);
const fileOf = (name: string): string => fileURLToPath(new URL(`${name}.json`, directory));

type Typed = 'f32' | 'u32' | 'u8' | 'f64';
type Numeric = ArrayLike<number>;

/** FNV-1a (32 bit) over the bytes of the values stored as `kind`. */
export function hashArray(values: Numeric, kind: Typed = 'u32'): string {
  const typed = kind === 'f32' ? Float32Array.from(values as ArrayLike<number>)
    : kind === 'f64' ? Float64Array.from(values as ArrayLike<number>)
      : kind === 'u32' ? Uint32Array.from(values as ArrayLike<number>) : Uint8Array.from(values as ArrayLike<number>);
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let hash = 0x811c9dc5;
  for (let at = 0; at < bytes.length; at += 1) hash = Math.imul(hash ^ bytes[at]!, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

/** Exact record of a big integer-like array (IDs, indices, masks). */
export const exactArray = (values: Numeric, kind: Typed = 'u32') => ({ count: values.length, hash: hashArray(values, kind) });

/** Strided sample of a float array (positions): compared within tolerance. */
export function approxArray(values: Numeric, step = 97) {
  const sample: number[] = [];
  for (let at = 0; at < values.length; at += step) sample.push(Math.round(values[at]! * 1e6) / 1e6);
  return { count: values.length, step, sample };
}

/** First difference between a snapshot and its golden (`path: detail`), or undefined when they match. */
export function diffGolden(actual: unknown, golden: unknown, tolerance = 1e-5, path = '$'): string | undefined {
  if (typeof golden === 'number' && typeof actual === 'number') {
    return Math.abs(actual - golden) <= tolerance || (Number.isNaN(actual) && Number.isNaN(golden)) ? undefined : `${path}: ${actual} vs ${golden}`;
  }
  if (Array.isArray(golden)) {
    if (!Array.isArray(actual) && !ArrayBuffer.isView(actual)) return `${path}: not an array`;
    const list = Array.from(actual as ArrayLike<unknown>);
    if (list.length !== golden.length) return `${path}: length ${list.length} vs ${golden.length}`;
    for (let at = 0; at < golden.length; at += 1) {
      const found = diffGolden(list[at], golden[at], tolerance, `${path}[${at}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (golden && typeof golden === 'object') {
    if (!actual || typeof actual !== 'object') return `${path}: not an object`;
    const keys = Object.keys(golden as object);
    const actualKeys = Object.keys(actual as object).filter((key) => (actual as Record<string, unknown>)[key] !== undefined);
    if (actualKeys.length !== keys.length) return `${path}: keys ${actualKeys.join(',')} vs ${keys.join(',')}`;
    for (const key of keys) {
      const found = diffGolden((actual as Record<string, unknown>)[key], (golden as Record<string, unknown>)[key], tolerance, `${path}.${key}`);
      if (found) return found;
    }
    return undefined;
  }
  return actual === golden ? undefined : `${path}: ${JSON.stringify(actual)} vs ${JSON.stringify(golden)}`;
}

/** Plain-data round trip so typed arrays, undefined and NaN compare like their JSON form. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, item) => (ArrayBuffer.isView(item) ? Array.from(item as unknown as ArrayLike<number>) : item)));

export function readGolden<T = unknown>(name: string): T {
  const file = fileOf(name);
  if (!existsSync(file)) throw new Error(`missing golden ${name}.json (see the header of scripts/test-support/golden.ts)`);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function writeGolden(name: string, value: unknown): void {
  const file = fileOf(name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(plain(value))}\n`);
}

/** Compares a snapshot with `scripts/fixtures/golden/<name>.json`; `UPDATE_GOLDENS=1` rewrites the file instead. */
export function expectGolden(name: string, actual: unknown, tolerance = 1e-5): void {
  if (process.env.UPDATE_GOLDENS) {
    writeGolden(name, actual);
    return;
  }
  const diff = diffGolden(plain(actual), readGolden(name), tolerance);
  if (diff) throw new Error(`golden ${name}: ${diff}`);
}
