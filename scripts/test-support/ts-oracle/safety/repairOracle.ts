// TEST-ONLY ORACLE (SHIP-PLAN U7): the TypeScript repair flow `runSupportJob` ran for a dental policy
// (structure fallback, crossing automatic pillars left out, bounded rebuild, fail-safe), kept to
// compare the Rust `generate` against it. It drives the Rust builder (`buildSupportMesh`) with the
// TypeScript safety modules next to it. No production import.
import type { TriangleMesh } from '../../../../src/core/analysis/types';
import type { GeneratedSupportMesh, SupportContact } from '../../../../src/core/supports/mesh';
import type { LiveSupportSettings } from '../../../../src/core/supports/settings';
import type { ZoneStamp } from '../../../../src/core/supports/zones';
import { buildSupportMesh } from '../../../../src/supports/rustSupports';
import { crossingAutomaticBodyContactIds, crossingSupportStructureParts } from './dentalBodyClearance';
import { createModelCollisionIndex } from './modelCollisionIndex';

export interface OracleOptions {
  mode: 'preview' | 'export';
  /** The model in plate space. */
  model: TriangleMesh;
  labelText?: string;
  zones?: readonly ZoneStamp[];
  /** One 0/1 per source face: where a secondary landing may stand. */
  landingFaces?: Uint8Array;
}

export function oracleRepair(contacts: readonly SupportContact[], settings: LiveSupportSettings, options: OracleOptions): GeneratedSupportMesh {
  const { model } = options;
  const collisionIndex = createModelCollisionIndex(model);
  const buildOptions = {
    mode: options.mode, model, labelText: options.labelText ?? '', ...(options.zones ? { zones: options.zones } : {}),
    ...(options.landingFaces ? { landingFaces: options.landingFaces } : {}),
  };
  let effectiveSettings = settings;
  let mesh = buildSupportMesh(contacts, effectiveSettings, buildOptions);
  const structureFallback: Array<'tree' | 'brace'> = [];
  const hasAutomatic = contacts.some((contact) => contact.origin !== 'manual');
  if (effectiveSettings.scatterAutoTree && crossingSupportStructureParts(model, mesh, effectiveSettings, collisionIndex).some((part) => part.startsWith('tree-'))) {
    effectiveSettings = { ...effectiveSettings, scatterAutoTree: false };
    structureFallback.push('tree');
    mesh = buildSupportMesh(contacts, effectiveSettings, buildOptions);
  }
  if (effectiveSettings.trussEnabled && crossingSupportStructureParts(model, mesh, effectiveSettings, collisionIndex).includes('brace')) {
    effectiveSettings = { ...effectiveSettings, trussEnabled: false };
    structureFallback.push('brace');
    mesh = buildSupportMesh(contacts, effectiveSettings, buildOptions);
  }
  if (hasAutomatic) {
    const automaticIds = new Set(contacts.filter((contact) => contact.origin !== 'manual').map((contact) => contact.id));
    const crossing = crossingAutomaticBodyContactIds(model, mesh, automaticIds, collisionIndex);
    if (crossing.length > 0) {
      const blocked = new Set(crossing);
      const dropped = new Set(mesh.dropped);
      const safeContacts = contacts.filter((contact) => !blocked.has(contact.id));
      mesh = buildSupportMesh(safeContacts, effectiveSettings, buildOptions);
      for (const id of mesh.dropped) dropped.add(id);
      const remaining = crossingAutomaticBodyContactIds(model, mesh, new Set([...automaticIds].filter((id) => !blocked.has(id))), collisionIndex);
      if (remaining.length > 0) {
        for (const id of automaticIds) blocked.add(id);
        mesh = buildSupportMesh(safeContacts.filter((contact) => contact.origin === 'manual'), effectiveSettings, buildOptions);
      }
      mesh.dropped = [...new Set([...dropped, ...mesh.dropped, ...blocked])];
    }
  }
  if (crossingSupportStructureParts(model, mesh, effectiveSettings, collisionIndex).length > 0) {
    const omitted = new Set([...mesh.dropped, ...contacts.filter((contact) => contact.origin !== 'manual').map((contact) => contact.id)]);
    mesh = buildSupportMesh(contacts.filter((contact) => contact.origin === 'manual'),
      { ...effectiveSettings, scatterAutoTree: false, trussEnabled: false }, buildOptions);
    mesh.dropped = [...new Set([...mesh.dropped, ...omitted])];
    if (!structureFallback.includes('tree')) structureFallback.push('tree');
    if (!structureFallback.includes('brace')) structureFallback.push('brace');
  }
  if (structureFallback.length > 0) mesh.dentalStructureFallback = structureFallback;
  return mesh;
}
