import { describe, expect, it } from 'vitest';
import type { SupportPoint } from './analysis/types';
import { jobContacts, type ContactInputs } from './jobs';

const point = (id: string, x: number, source: SupportPoint['source'] = 'interior'): SupportPoint => ({ id, regionId: 0, position: [x, 0, 0], normal: [0, -1, 0], source });
const inputs = (overrides: Partial<ContactInputs> = {}): ContactInputs => ({ points: [point('auto-0', 0), point('auto-1', 10, 'island')], manual: [point('manual-a', 20)], deleted: [], zones: [], contactSettings: {}, ...overrides });

describe('jobContacts', () => {
  it('lists automatic then manual contacts with their SLASG class; manual ones never join trees', () => {
    expect(jobContacts(inputs())).toEqual([
      { id: 'auto-0', position: [0, 0, 0], normal: [0, -1, 0], kind: 'face', origin: 'auto' },
      { id: 'auto-1', position: [10, 0, 0], normal: [0, -1, 0], kind: 'vertical', origin: 'auto' },
      { id: 'manual-a', position: [20, 0, 0], normal: [0, -1, 0], kind: 'face', origin: 'manual' },
    ]);
  });

  it('carries the own settings of a support on its contact, and none on the others', () => {
    const contacts = jobContacts(inputs({ contactSettings: { 'auto-1': { neckLength: 4 }, 'manual-a': { pointDiameter: 0.6 } } }));
    expect(contacts.map((contact) => contact.shape)).toEqual([undefined, { neckLength: 4 }, { pointDiameter: 0.6 }]);
    expect('shape' in contacts[0]!).toBe(false);
  });

  it('drops deleted contacts and automatic ones inside a no-support zone, never manual ones', () => {
    const zones = [{ center: [10, 0, 0] as [number, number, number], radius: 1, normal: [0, -1, 0] as [number, number, number], kind: 'paint' as const }, { center: [20, 0, 0] as [number, number, number], radius: 1, normal: [0, -1, 0] as [number, number, number], kind: 'paint' as const }];
    expect(jobContacts(inputs({ deleted: ['auto-0'], zones })).map((contact) => contact.id)).toEqual(['manual-a']);
  });
});
