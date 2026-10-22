import { describe, expect, it } from 'vitest';
import { UNDO_TOAST_MS, toastAlive, undoToast } from './toast';

describe('undoToast', () => {
  it('lasts 6 s', () => {
    expect(UNDO_TOAST_MS).toBe(6000);
  });

  it('says what was cleared', () => {
    expect(undoToast(1, { kind: 'clearZones', hidden: 0 }).message).toEqual({ key: 'No-support zones cleared.' });
    expect(undoToast(1, { kind: 'clearZones', hidden: 3 }).message).toMatchObject({ vars: { n: 3 }, other: 'No-support zones cleared; {n} hidden supports come back.' });
    expect(undoToast(2, { kind: 'clearManual', added: 2, removed: 1, customised: 3 }).message).toEqual({ key: 'Cleared {a} added, {r} removed, {c} customised.', vars: { a: 2, r: 1, c: 3 } });
    expect(undoToast(3, { kind: 'resetCustomised', count: 4 }).message).toMatchObject({ other: 'Reset {n} supports to the defaults.', vars: { n: 4 } });
    expect(undoToast(3, { kind: 'removeSupports', count: 1 }).message).toMatchObject({ key: 'Removed the supports of 1 object; the model and manual edits are kept.', vars: { n: 1 } });
    expect(undoToast(3, { kind: 'deleteObjects', count: 2 }).message).toMatchObject({ other: 'Deleted {n} objects.', vars: { n: 2 } });
    expect(undoToast(3, { kind: 'clearSelection', ids: ['a', 'b'], unitId: 'u1' }).message).toEqual({
      key: 'Selection of 1 support cleared.', other: 'Selection of {n} supports cleared.', vars: { n: 2 },
    });
  });
});

describe('toastAlive', () => {
  const scene = {};
  const now = { scene, mode: 'edit' as const, activeUnitId: 'u1', selectionSize: 0 };

  it('a history clear stays undoable while the scene is the one it left', () => {
    const toast = undoToast(1, { kind: 'clearZones', hidden: 0 });
    // Before the first render after the clear the scene is not known yet.
    expect(toastAlive(toast, now)).toBe(true);
    expect(toastAlive({ ...toast, scene }, now)).toBe(true);
    // Any other step (an edit, undo, redo) makes its Undo something else: the toast goes.
    expect(toastAlive({ ...toast, scene: {} }, now)).toBe(false);
  });

  it('a cleared selection stays restorable while the same object is in Support Edit Mode', () => {
    const toast = undoToast(1, { kind: 'clearSelection', ids: ['a'], unitId: 'u1' });
    expect(toastAlive(toast, now)).toBe(true);
    expect(toastAlive(toast, { ...now, mode: 'off' })).toBe(false);
    expect(toastAlive(toast, { ...now, mode: 'zones' })).toBe(false);
    expect(toastAlive(toast, { ...now, activeUnitId: 'u2' })).toBe(false);
    // A new selection since: Undo would replace it, so the toast goes.
    expect(toastAlive(toast, { ...now, selectionSize: 1 })).toBe(false);
  });
});
