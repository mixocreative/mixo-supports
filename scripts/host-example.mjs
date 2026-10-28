// Host example: drives the geometry engine (the browser package's ABI, here its Node build) on an
// aligner STL with no React and no import from src/. Each step names the ABI call it makes.
//   node scripts/host-example.mjs <aligner.stl> <out-dir>
// Writes <out-dir>/supported.stl (aligner in its print pose plus all supports) and <out-dir>/summary.json.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , stlArg, outArg] = process.argv;
if (!stlArg || !outArg) {
  process.stderr.write('Usage: node scripts/host-example.mjs <aligner.stl> <out-dir>\n');
  process.exit(2);
}
const packageFile = fileURLToPath(new URL('../crates/geometry-wasm/pkg-node/mixo_geometry_wasm.js', import.meta.url));
assert.ok(existsSync(packageFile), 'Build the Node WASM package first: npm run wasm:build');
const engine = createRequire(import.meta.url)(packageFile);

const PROFILE = 'reference-aligner';
// The profile's area defaults: [position mm, strip width mm, density] (the tuning array of region and policy).
const TUNING = Float64Array.of(0.25, 0.5, 1);
// The profile's Step 3 support settings (Tree off, Brace on: D21), named as engine.support_settings_layout() lists them.
const SETTINGS = {
  contactShape: 'NONE', pointDiameter: 0.45, pointDepth: 0.2, tipSection: 'ROUND', tipCrossWidth: 40, tipProfile: 'TAPERED',
  touchDiameter: 0.45, touchDepth: 0, neckDiameter: 0.3, neckLength: 2, maxNeckAngle: 45,
  pillarDiameter: 1.4, treeSectionIncrement: 20, baseDiameter: 3, baseHeight: 1.2,
  trussEnabled: true, trussDiameter: 1.4, trussAngle: 45, trussSpacing: 2, trussMinHeight: 3, trussTopSpacing: 0, trussDistanceLimit: 100,
  raftEnabled: true, raftExpandWidth: 3, raftFloorThickness: 1, raftWallHeight: 1.5, raftWallThickness: 0.5, raftWallAngle: 30, voxelResolution: 16,
  roofMode: 'OFF', roofGap: 5, cageSideGap: 4, cageTopGap: 5, cagePitch: 10, cageRingDiameter: 1, columnCount: 6, columnDiameter: 1.5,
  diagonalEnabled: false, diagonalDiameter: 1, braceConcentric: 3, braceThickness: 1, braceAngle: 40, storeyFloorThickness: 1.5, storeyEncloseCeiling: true,
  labelEnabled: true, labelSize: 5, labelHeight: 0.6, labelMargin: 0, labelOffsetX: 0, labelOffsetY: 0,
  previewMode: 'FULL', autoSnap: false, lowPolyMode: false, resolution: 12,
  scatterSpacing: 2, scatterAngle: 50, scatterSafeDistance: 0, scatterFacingDown: true, scatterIslands: true, scatterRidgeAngle: 45,
  scatterAutoTree: false, scatterMergeDistance: 2, scatterBranchDescent: 2, reinforceOverhangEdges: true,
  liftHeight: 3.5, eraseRadius: 1.5,
};
const ENUMS = { contactShape: ['NONE', 'SPHERE'], tipSection: ['ROUND', 'SQUARE', 'CROSS'], tipProfile: ['TAPERED', 'STRAIGHT'],
  roofMode: ['OFF', 'ROOF', 'CAGE'], previewMode: ['FULL', 'ONLY_TIP'] };
const flat = (value, key) => (typeof value === 'boolean' ? Number(value) : typeof value === 'string' ? ENUMS[key].indexOf(value) : value);
const settings = Float64Array.from(engine.support_settings_layout(), (key) => { assert.ok(key in SETTINGS, `setting ${key}`); return flat(SETTINGS[key], key); });

const seconds = {};
const timed = (name, run) => {
  const t = performance.now();
  const value = run();
  seconds[name] = +((performance.now() - t) / 1000).toFixed(2);
  return value;
};
const started = performance.now();

// 1. Read: BinaryStlSession / AsciiStlSession .finish() -> welded positions (Float32Array) and indices (Uint32Array).
const { positions, indices } = timed('read', () => {
  const bytes = readFileSync(resolve(stlArg));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const binary = bytes.length >= 84 && bytes.length === 84 + 50 * view.getUint32(80, true);
  const stream = binary ? new engine.BinaryStlSession(view.getUint32(80, true)) : new engine.AsciiStlSession(bytes.length);
  stream.push(bytes);
  const mesh = stream.finish();
  const result = { positions: mesh.take_positions(), indices: mesh.take_indices() };
  mesh.free();
  stream.free();
  return result;
});

// 2. Centre: center_positions_in_place moves the vertices to their bounding-box centre (as the import does).
timed('centre', () => engine.center_positions_in_place(positions));

// All later calls work on the mesh loaded once in a session (GeometrySession.load_mesh -> handle).
const session = new engine.GeometrySession(0x30000000);
const model = session.load_mesh(positions, indices);

// 3. Orient: orient_dental(model, profile) -> the cavity opening (status 0 = found) the region is cut around.
const orientation = timed('orient', () => {
  const result = session.orient_dental(model, PROFILE);
  const found = { status: result.status(), reason: result.reason() };
  result.free();
  return found;
});
assert.equal(orientation.status, 0, `orientation failed: ${orientation.reason}`);

// 4. Region: propose_dental_region(model, tuning, profile) -> allowed faces, outer and opening edges, contact strip.
const region = timed('region', () => {
  const result = session.propose_dental_region(model, TUNING, PROFILE);
  assert.ok(result.ok(), `region failed: ${result.reason()}`);
  const parts = { allowed: result.take_allowed_faces(), contact: result.take_contact_faces(), outer: result.take_outer_edges(), opening: result.take_opening_edges() };
  result.free();
  return parts;
});

// 5. Print angle: dental_tilt_scan(model, profile, neck, pillar, lift, braced) -> rows (12 numbers each), pick order, stable band.
const angle = timed('tilt-scan', () => {
  const result = session.dental_tilt_scan(model, PROFILE, SETTINGS.neckLength, SETTINGS.pillarDiameter, SETTINGS.liftHeight, true);
  assert.ok(result.ok(), `tilt scan failed: ${result.reason()}`);
  const rows = result.rows();
  const pick = result.order()[0];
  const band = result.band();
  const tilt = (row) => Math.round(rows[row * 12] * 10) / 10;
  const value = {
    tiltDeg: tilt(pick),
    rotation: Float64Array.from(rows.subarray(pick * 12 + 9, pick * 12 + 12)), // Euler XYZ radians into the print pose
    band: band.length === 2 ? [tilt(band[0]), tilt(band[1])] : null,
  };
  result.free();
  return value;
});

// 6. Frame: placement_matrix(position, rotation) + transformed_min_y(positions, matrix) stand the aligner on the lift height.
const lowest = engine.transformed_min_y(positions, engine.placement_matrix(new Float64Array(3), angle.rotation));
const frame = Float64Array.of(0, SETTINGS.liftHeight - lowest, 0, ...angle.rotation);

// 7. Policy: dental_policy(model, profile, 2 = two-contour, tuning, stamps, region..., [tree, brace], frame, manual)
//    -> a PolicyHandle: the suggested tips (ids, then point and normal each, in the plate frame) and the structures to build.
const makePolicy = (at) => session.dental_policy(model, PROFILE, 2, TUNING, new Float64Array(),
  region.allowed, region.contact, region.outer, region.opening, Uint8Array.of(0, 1), at, new Float64Array());
//    The tips are asked for in the rotated frame (no lift); position_ids names each by its place on a 0.01 mm grid, a repeat counts once.
const suggested = timed('policy', () => {
  const handle = makePolicy(Float64Array.of(0, 0, 0, ...angle.rotation));
  const found = handle.candidate_points();
  handle.free();
  return found;
});
const spots = Array.from({ length: suggested.length / 6 }, (_, k) => suggested.subarray(k * 6, k * 6 + 6));
const names = engine.position_ids(Float64Array.from(spots.flatMap((s) => [s[0], s[1], s[2]])));
const unique = [];
spots.forEach((s, k) => { if (!unique.some((u) => u.name === names[k])) unique.push({ name: names[k], s }); });
assert.ok(unique.length > 0, 'the policy suggested no tips');
//    generic_policy_contacts(...) composes the final contacts (deletions and hand-placed tips would go through it) and
//    sets each contact's kind: ids, positions, normals, origins, kinds. Here every tip is automatic, none deleted.
//    The tips are first taken back to the aligner's own frame (invert_matrix + transform_vectors), as the app stores them, then
//    onto the plate (placement_matrix(frame)); direction = true turns the normals without moving them.
const turn = engine.placement_matrix(new Float64Array(3), angle.rotation);
const plate = engine.placement_matrix(frame.subarray(0, 3), frame.subarray(3, 6));
const local = (values, direction) => engine.transform_vectors(values, engine.invert_matrix(turn), direction);
const toPlate = (values, direction) => engine.transform_vectors(values, plate, direction);
const here = Float64Array.from(unique.flatMap((u) => [u.s[0], u.s[1], u.s[2]]));
const facing = Float64Array.from(unique.flatMap((u) => [u.s[3], u.s[4], u.s[5]]));
const composed = engine.generic_policy_contacts(0, settings, unique.map((u) => u.name),
  toPlate(local(here, false), false), toPlate(local(facing, true), true),
  new Uint8Array(unique.length), [], new Float64Array(), new Float64Array(), new Uint8Array(), [], new Float64Array());
const ids = composed.take_ids();
const pos = composed.take_positions();
const normals = composed.take_normals();
const kinds = composed.take_kinds();
composed.free();
// Per contact (17 numbers): position, normal, -1 (no face), 0 (auto), 8 zeros, -1, kind (0 none, 1 face, 2 edge, 3 vertical).
const contacts = Float64Array.from(ids.flatMap((_, k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2],
  -1, 0, 0, 0, 0, 0, 0, 0, 0, -1, kinds[k]]));
const policy = makePolicy(frame); // the policy `generate` permits against, in the plate frame

// 8. Generate: load_placed(model, frame) puts the aligner on the plate; generate(...) permits the tips, builds the supports,
//    checks them against the body, repairs within its budget and returns the mesh (plate frame) with its verdicts.
const generated = timed('generate', () => {
  const placed = session.load_placed(model, frame);
  const result = session.generate(placed, ids, contacts, new Float64Array(), settings, 1, 'A', new Float64Array(), policy,
    120000, 0, 0, frame);
  policy.free();
  return result;
});

// 9. Check: the verdict (0 clear, 1 blocked, 2 inconclusive), issues (5 numbers each, [3] = 1 when a support crosses the body),
//    the tips left out and the rim rings (5 numbers each: perimeter, retained, max gap, review gap, needs review).
const checked = timed('check', () => {
  const issues = generated.take_issues();
  const rings = generated.take_rings();
  const gaps = [];
  for (let k = 0; k < rings.length; k += 5) gaps.push({ maxGapMm: +rings[k + 2].toFixed(2), needsReview: rings[k + 4] === 1 });
  let crossings = 0;
  for (let k = 0; k < issues.length; k += 5) if (issues[k + 3] === 1) crossings += 1;
  return { verdict: ['clear', 'blocked', 'inconclusive'][generated.status()], reason: generated.reason(), crossings, dropped: generated.take_dropped(), gaps };
});

// 10. Output: transform_positions(positions, placement_matrix(frame)) gives the aligner in its print pose; the supports are
//     already in that frame. One binary STL holds both.
const body = engine.transform_positions(positions, plate, 0);
const supports = { positions: generated.take_positions(), indices: generated.take_indices() };
const triangles = (indices.length + supports.indices.length) / 3;
const stl = Buffer.alloc(84 + triangles * 50);
stl.write('host-example supported aligner', 0, 'ascii');
stl.writeUInt32LE(triangles, 80);
let at = 84;
for (const mesh of [{ positions: body, indices }, supports]) {
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const v = [0, 1, 2].map((c) => Array.from(p.subarray(mesh.indices[t + c] * 3, mesh.indices[t + c] * 3 + 3)));
    const e1 = v[1].map((x, i) => x - v[0][i]);
    const e2 = v[2].map((x, i) => x - v[0][i]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n) || 1;
    [...n.map((x) => x / len), ...v.flat()].forEach((x, i) => stl.writeFloatLE(x, at + i * 4));
    at += 50;
  }
}
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'supported.stl'), stl);

const summary = {
  engine_version: engine.engine_version(),
  profile: PROFILE,
  angle_deg: angle.tiltDeg,
  stable_band_deg: angle.band,
  verdict: checked.verdict,
  verdict_reason: checked.reason,
  tips_placed: ids.length - checked.dropped.length,
  tips_left_out: checked.dropped.length,
  crossings: checked.crossings,
  gaps: checked.gaps,
  supported_stl_bytes: stl.length,
  seconds,
  seconds_total: +((performance.now() - started) / 1000).toFixed(2),
};
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
generated.free();
session.free();
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
