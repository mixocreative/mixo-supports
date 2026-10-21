import { describe, expect, it } from 'vitest';
import { PlateLedger } from './plateLedger';

const LIMIT = 6_000_000;
const refuse = (plate: number) => {
  if (plate > LIMIT) throw new Error(`plate-full ${plate}`);
};
const scene = (triangles = 0, ...ids: string[]) => ({ triangles, ids: new Set(ids) });

describe('PlateLedger (plate guard across imports that run at once)', () => {
  it('a second import started while the first is still reading sees the first one\'s triangles', () => {
    const ledger = new PlateLedger();
    const first = ledger.open();
    const second = ledger.open();
    first.hold(5_000_000, scene(), refuse);
    expect(() => second.hold(2_000_000, scene(), refuse)).toThrow('plate-full 7000000');
    // A refused hold reserves nothing.
    expect(ledger.reserved(scene())).toBe(5_000_000);
  });

  it('counts the scene, and a hold replaces the import\'s earlier hold (estimate, then what was read)', () => {
    const ledger = new PlateLedger();
    const reservation = ledger.open();
    reservation.hold(3_000_000, scene(1_000_000), refuse);
    reservation.hold(2_500_000, scene(1_000_000), refuse);
    expect(ledger.reserved(scene())).toBe(2_500_000);
    expect(() => reservation.hold(5_500_000, scene(1_000_000), refuse)).toThrow('plate-full 6500000');
    expect(ledger.reserved(scene())).toBe(2_500_000);
  });

  it('a failed or cancelled import releases its hold', () => {
    const ledger = new PlateLedger();
    const failed = ledger.open();
    failed.hold(5_000_000, scene(), refuse);
    failed.release();
    expect(ledger.reserved(scene())).toBe(0);
    expect(() => ledger.open().hold(5_000_000, scene(), refuse)).not.toThrow();
  });

  it('a finished import holds until the scene shows its units, then is counted once', () => {
    const ledger = new PlateLedger();
    const done = ledger.open();
    done.hold(4_000_000, scene(), refuse);
    done.commit(['a', 'b']);
    // Dispatched but not rendered yet: still held.
    expect(ledger.reserved(scene(0, 'a'))).toBe(4_000_000);
    expect(() => ledger.open().hold(3_000_000, scene(0, 'a'), refuse)).toThrow();
    // In the scene now: the scene counts them, the hold goes.
    ledger.settle(new Set(['a', 'b']));
    expect(ledger.reserved(scene(4_000_000, 'a', 'b'))).toBe(0);
    expect(() => ledger.open().hold(2_000_000, scene(4_000_000, 'a', 'b'), refuse)).not.toThrow();
  });
});
