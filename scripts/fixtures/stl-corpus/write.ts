/** Writes the odd-STL corpus next to this file: npx vite-node scripts/fixtures/stl-corpus/write.ts */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpus } from './generate';

const dir = dirname(fileURLToPath(import.meta.url));
const files = corpus();
for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
console.log(`wrote ${Object.keys(files).length} files to ${dir}`);
