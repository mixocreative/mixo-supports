import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import type { TriangleMesh } from '../core/analysis/types';
import { canUndo, createSceneHistory, deserializeSceneHistory, HISTORY_LIMIT, redoScene, serializeSceneHistory, undoScene, withSceneCommand } from './history';
import { emptyScene, identityTransform, type PrintUnit } from './project';

const source: TriangleMesh = { positions: new Float32Array([0, 0, 0]), indices: new Uint32Array() };
const unit: PrintUnit = {
  id: 'unit-a', name: 'Unit A', source, transform: identityTransform, settings: {}, manual: [], deleted: [], zones: [], contactSettings: {},
};

describe('scene history', () => {
  it('stores scene snapshots and restores them through undo and redo', () => {
    const initial = createSceneHistory(emptyScene);
    const added = withSceneCommand(initial, { type: 'unit/add', unit });
    const selected = withSceneCommand(added, { type: 'selection/set', unitIds: ['unit-a'], activeUnitId: 'unit-a' });
    const undone = undoScene(selected);
    const redone = redoScene(undone);

    expect(selected.present.units).toHaveLength(1);
    expect(undone.present.selectedUnitIds).toEqual([]);
    expect(undone.future).toHaveLength(1);
    expect(redone.present.selectedUnitIds).toEqual(['unit-a']);
    expect(redone.past).toHaveLength(2);
  });

  it('drops redo snapshots when a new reducer action is applied after undo', () => {
    const added = withSceneCommand(createSceneHistory(emptyScene), { type: 'unit/add', unit });
    const selected = withSceneCommand(added, { type: 'selection/set', unitIds: ['unit-a'], activeUnitId: 'unit-a' });
    const branched = withSceneCommand(undoScene(selected), { type: 'transform/set', unitId: 'unit-a', transform: { position: [2, 0, 0], rotation: [0, 0, 0] } });

    expect(branched.future).toEqual([]);
    expect(branched.present.units[0].transform.position).toEqual([2, 0, 0]);
  });

  it('only stores JSON-safe scenes in history snapshots', () => {
    const unsafe = { ...unit, settings: { preview: new Object3D() as never } };

    expect(() => createSceneHistory({ ...emptyScene, units: [unsafe] })).toThrow('JSON-safe');

    const history = withSceneCommand(createSceneHistory(emptyScene), { type: 'unit/add', unit });
    expect(JSON.parse(JSON.stringify(history))).toBeTruthy();
  });

  it('faithfully round-trips populated history through JSON', () => {
    const history = withSceneCommand(
      withSceneCommand(createSceneHistory(emptyScene), { type: 'unit/add', unit }),
      { type: 'selection/set', unitIds: ['unit-a'], activeUnitId: 'unit-a' },
    );

    expect(deserializeSceneHistory(serializeSceneHistory(history))).toEqual(history);
  });

  it('owns source typed arrays in its snapshots', () => {
    const scene = { ...emptyScene, units: [unit] };
    const history = createSceneHistory(scene);

    scene.units[0].source.positions[0] = 99;
    expect(history.present.units[0].source.positions[0]).toBe(0);
  });

  it('undoes a batch as one step and caps retained history', () => {
    const previous = createSceneHistory(emptyScene);
    const batched = withSceneCommand(previous, { type: 'batch', commands: [
      { type: 'unit/add', unit },
      { type: 'supports/clear-manual', unitId: 'unit-a' },
    ] });
    expect(undoScene(batched).present).toEqual(previous.present);

    let history = withSceneCommand(previous, { type: 'unit/add', unit });
    for (let step = 0; step < HISTORY_LIMIT + 20; step += 1) {
      history = withSceneCommand(history, { type: 'transform/set', unitId: 'unit-a', transform: { position: [step, 0, 0], rotation: [0, 0, 0] } });
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });

  it('shares unchanged units between snapshots instead of copying their meshes', () => {
    const added = withSceneCommand(createSceneHistory(emptyScene), { type: 'unit/add', unit });
    const moved = withSceneCommand(added, { type: 'transform/set', unitId: 'unit-a', transform: { position: [1, 0, 0], rotation: [0, 0, 0] } });
    expect(moved.present.units[0]!.source).toBe(added.present.units[0]!.source);
  });

  describe('undo floor (a mode keeps undo at the scene it was entered with)', () => {
    const move = (history: ReturnType<typeof createSceneHistory>, x: number) => withSceneCommand(history, { type: 'transform/set', unitId: 'unit-a', transform: { position: [x, 0, 0], rotation: [0, 0, 0] } });

    it('stops at the entry scene and allows every step without a floor', () => {
      let history = move(withSceneCommand(createSceneHistory(emptyScene), { type: 'unit/add', unit }), 1);
      const floor = history.present;
      expect(canUndo(history, floor)).toBe(false);
      expect(canUndo(history)).toBe(true);
      history = move(move(history, 2), 3);
      expect(canUndo(history, floor)).toBe(true);
      history = undoScene(undoScene(history));
      expect(history.present).toBe(floor);
      expect(canUndo(history, floor)).toBe(false);
    });

    it('still undoes in the mode once the history is at its cap (the floor is not an index)', () => {
      let history = withSceneCommand(createSceneHistory(emptyScene), { type: 'unit/add', unit });
      for (let step = 0; step < HISTORY_LIMIT + 5; step += 1) history = move(history, step);
      expect(history.past).toHaveLength(HISTORY_LIMIT);
      const floor = history.present;
      history = move(history, 1000);
      expect(canUndo(history, floor)).toBe(true);
      history = undoScene(history);
      expect(history.present).toBe(floor);
      expect(canUndo(history, floor)).toBe(false);
    });

    it('allows the remaining steps once the cap has dropped the entry scene', () => {
      let history = withSceneCommand(createSceneHistory(emptyScene), { type: 'unit/add', unit });
      const floor = history.present;
      for (let step = 0; step < HISTORY_LIMIT + 5; step += 1) history = move(history, step);
      expect(history.past).not.toContain(floor);
      expect(canUndo(history, floor)).toBe(true);
    });

    it('nothing to undo is nothing to undo, floor or not', () => {
      const history = createSceneHistory(emptyScene);
      expect(canUndo(history)).toBe(false);
      expect(canUndo(history, history.present)).toBe(false);
    });
  });
});
