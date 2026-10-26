import { describe, expect, it } from 'vitest';
import { dentalPrimarySourceFace } from './dentalPrimaryFace';

const contact = { position: [1, 2, 3] as [number, number, number], normal: [0, -1, 0] as [number, number, number] };
const candidate = { face: 7, position: [1, 2, 3] as [number, number, number],
  normal: [0, -1, 0] as [number, number, number], distanceAlongContour: 1, distanceFromContour: 0.5 };

describe('dentalPrimarySourceFace', () => {
  it('returns the exact face of one matching accepted contour sample', () => {
    expect(dentalPrimarySourceFace(contact, [candidate])).toBe(7);
  });

  it('abstains when the same contact could match two different source faces', () => {
    expect(dentalPrimarySourceFace(contact, [candidate, { ...candidate, face: 8 }])).toBeUndefined();
  });

  it('does not assign a distant or reversed sample face', () => {
    expect(dentalPrimarySourceFace(contact, [{ ...candidate, position: [1.1, 2, 3] }])).toBeUndefined();
    expect(dentalPrimarySourceFace(contact, [{ ...candidate, normal: [0, 1, 0] }])).toBeUndefined();
  });
});
