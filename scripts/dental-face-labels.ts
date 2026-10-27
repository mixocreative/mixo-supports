// Regenerates docs/dental-reference/face-labels.json from the production (Rust) detector:
//   npx vite-node scripts/dental-face-labels.ts
import { writeFileSync } from 'node:fs';
import { buildLabels } from './test-support/dentalFaceLabels';

writeFileSync('docs/dental-reference/face-labels.json', `${JSON.stringify(buildLabels())}
`);
console.log('wrote docs/dental-reference/face-labels.json');
