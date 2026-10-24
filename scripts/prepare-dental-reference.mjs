import { readFileSync, writeFileSync } from 'node:fs';

const source = process.env.DENTAL_REFERENCE_SOURCE;
const destination = process.argv[2];
if (!source || !destination) throw new Error('Provide DENTAL_REFERENCE_SOURCE and destination path');

const original = readFileSync(source);
if (original.length < 84 || (original.length - 84) % 50 !== 0) throw new Error('Expected a complete binary STL');
const copy = Buffer.from(original);
copy.fill(32, 0, 80);
copy.write('Mixo Supports dental reference - neutral header', 0, 'ascii');
if (!copy.subarray(80).equals(original.subarray(80))) throw new Error('Triangle records changed');
writeFileSync(destination, copy, { flag: 'wx' });
const onDisk = readFileSync(destination);
if (!onDisk.subarray(80).equals(original.subarray(80))) throw new Error('Stored triangle records differ');
console.log(JSON.stringify({ bytes: onDisk.length, faces: onDisk.readUInt32LE(80), headerNeutral: !onDisk.subarray(0, 80).includes(0) }));
