import { describe, expect, it } from 'vitest';
import { contactToRemove } from './removal';

const at = (id: string, x: number) => ({ id, position: [x, 0, 0] });

describe('contactToRemove', () => {
  it('takes only the nearest contact within reach, not every one in range', () => {
    expect(contactToRemove([at('a', 0), at('b', 1), at('c', 3)], [0.8, 0, 0], 1.5)?.id).toBe('b');
  });
  it('takes nothing when no contact is within reach', () => {
    expect(contactToRemove([at('a', 0)], [5, 0, 0], 1.5)).toBeUndefined();
  });
});
