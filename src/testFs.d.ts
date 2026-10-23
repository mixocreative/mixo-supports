/** The one Node call a test makes (the project carries no Node types): reads a fixture file. */
declare module 'node:fs' {
  export function readFileSync(path: string): { buffer: ArrayBufferLike; byteOffset: number; byteLength: number };
}
