import { describe, expect, it } from 'vitest';
import type { SupportContact } from '../core/supports/mesh';
import type { DentalProposal } from '../core/analysis/dental';
import { gesture } from './gesture';
import { FIX_TOOL_EVENTS, acceptsDentalDrop, initialSession, reduceSession, startsEditing, type EditSession, type SessionEvent } from './session';

const contact = (id: string) => ({ id, position: [0, 0, 0], normal: [0, -1, 0] }) as unknown as SupportContact;
const run = (state: EditSession, ...events: SessionEvent[]) => events.reduce(reduceSession, state);
/** Unit u1 active, nothing else changed. */
const withActive = run(initialSession, { type: 'activeUnitChanged', id: 'u1' });
const editing = run(withActive, { type: 'enterEdit' });
const selected = run(editing, { type: 'setTool', tool: 'select' }, { type: 'toggleContact', id: 'a' }, { type: 'toggleContact', id: 'b' });
const proposal: Extract<DentalProposal, { kind: 'proposal' }> = { kind: 'proposal', rim: {} as Extract<DentalProposal, { kind: 'proposal' }>['rim'], diagnostics: { confidence: 0.9, terminalAreaRatio: 0.9, axialVarianceRatio: 0.1 } };

describe('reduceSession: modes', () => {
  it('starts outside the modes with the default tools', () => {
    expect(initialSession).toMatchObject({
      mode: 'off', tool: 'add', selectStyle: 'click', brushMode: 'select',
      brushRadius: 24, zoneKind: 'paint', zoneRadius: 2,
    });
    expect(initialSession.selection.size).toBe(0);
  });

  it('Support Edit Mode opens only with an active object, and exit leaves it', () => {
    expect(reduceSession(initialSession, { type: 'enterEdit' })).toBe(initialSession);
    expect(editing.mode).toBe('edit');
    expect(reduceSession(editing, { type: 'exit' }).mode).toBe('off');
  });

  it('a heavy active object takes no hand edits: neither mode opens on it', () => {
    const heavy = run(initialSession, { type: 'activeUnitChanged', id: 'u1', heavy: 1_600_000 });
    expect(heavy).toMatchObject({ activeUnitId: 'u1', heavy: 1_600_000 });
    expect(reduceSession(heavy, { type: 'enterEdit' })).toBe(heavy);
    expect(reduceSession(heavy, { type: 'enterZones' })).toBe(heavy);
    // Another object that is not heavy takes edits again.
    expect(run(heavy, { type: 'activeUnitChanged', id: 'u2' }, { type: 'enterEdit' })).toMatchObject({ mode: 'edit', heavy: undefined });
    // The same object reported again keeps the session.
    expect(reduceSession(heavy, { type: 'activeUnitChanged', id: 'u1', heavy: 1_600_000 })).toBe(heavy);
  });

  it('the modes never switch directly: entering one needs the other exited first', () => {
    const zones = reduceSession(withActive, { type: 'enterZones' });
    expect(reduceSession(zones, { type: 'enterEdit' })).toBe(zones);
    expect(reduceSession(editing, { type: 'enterZones' })).toBe(editing);
  });

  it('zones mode needs an active object and exit always returns to setup', () => {
    expect(reduceSession(initialSession, { type: 'enterZones' })).toBe(initialSession);
    const zones = reduceSession(withActive, { type: 'enterZones' });
    expect(zones.mode).toBe('zones');
    expect(reduceSession(zones, { type: 'exit' }).mode).toBe('off');
  });

  it('the dental flow runs Step 0, Step 1 (drop, orient), Step 2, Step 3 and backs out', () => {
    const entered = reduceSession(initialSession, { type: 'enterDental' });
    // Entry needs no object: the dimmed flow starts at the type cards.
    expect(entered).toMatchObject({ mode: 'dental', dentalStage: 'type', dentalRadius: 2 });
    expect(gesture(entered)).toMatchObject({ kind: 'dental-type' });
    const aligner = reduceSession(entered, { type: 'chooseDentalProfile', id: 'reference-aligner' });
    expect(gesture(aligner)).toMatchObject({ kind: 'dental-aligner', phase: 'prompt', profile: 'reference-aligner' });
    // Next is not reachable before an aligner was read and oriented.
    expect(reduceSession(aligner, { type: 'acceptDentalOrientation' })).toBe(aligner);
    const loading = reduceSession(aligner, { type: 'dentalLoading' });
    expect(gesture(loading)).toMatchObject({ kind: 'dental-aligner', phase: 'loading' });
    const ready = reduceSession(loading, { type: 'dentalOriented', proposal, notices: [] });
    expect(gesture(ready)).toMatchObject({ kind: 'dental-aligner', phase: 'ready', proposal });
    const area = reduceSession(ready, { type: 'acceptDentalOrientation' });
    expect(area).toMatchObject({ mode: 'dental', dentalStage: 'area' });
    expect(gesture(area)).toMatchObject({ kind: 'dental-area', brush: { kind: 'allow', radius: 2 } });
    const review = reduceSession(area, { type: 'acceptDentalArea' });
    expect(gesture(review)).toMatchObject({ kind: 'dental-review' });
    expect(reduceSession(review, { type: 'backDental' }).dentalStage).toBe('area');
    expect(reduceSession(review, { type: 'exit' }).mode).toBe('off');
  });

  it('Back goes 2 to 1 (keeping the oriented aligner) and 1 to 0; Step 0 has no Back', () => {
    const ready = run(initialSession, { type: 'enterDental' }, { type: 'chooseDentalProfile', id: 'p' }, { type: 'dentalLoading' }, { type: 'dentalOriented', proposal, notices: [] });
    const area = reduceSession(ready, { type: 'acceptDentalOrientation' });
    const back1 = reduceSession(area, { type: 'backDental' });
    expect(back1).toMatchObject({ dentalStage: 'aligner', dentalAligner: 'ready', dentalProposal: proposal });
    const back0 = reduceSession(back1, { type: 'backDental' });
    expect(back0).toMatchObject({ dentalStage: 'type', dentalProfile: 'p', dentalProposal: undefined });
    expect(reduceSession(back0, { type: 'backDental' })).toBe(back0);
    expect(reduceSession(initialSession, { type: 'backDental' })).toBe(initialSession);
  });

  it('Exit leaves the dental mode from every step, and the last type choice is remembered', () => {
    for (const events of [[], [{ type: 'chooseDentalProfile', id: 'p' }], [{ type: 'chooseDentalProfile', id: 'p' }, { type: 'dentalLoading' }]] as SessionEvent[][]) {
      const left = run(initialSession, { type: 'enterDental' }, ...events, { type: 'exit' });
      expect(left.mode).toBe('off');
    }
    const again = run(initialSession, { type: 'enterDental' }, { type: 'chooseDentalProfile', id: 'p' }, { type: 'exit' }, { type: 'enterDental' });
    expect(again).toMatchObject({ dentalStage: 'type', dentalProfile: 'p' });
  });

  it('a bad file keeps Step 1 on its prompt with the message; a new drop clears it', () => {
    const aligner = run(initialSession, { type: 'enterDental' }, { type: 'chooseDentalProfile', id: 'p' }, { type: 'dentalLoading' });
    const message = { key: 'x' };
    const bad = reduceSession(aligner, { type: 'dentalBadFile', message });
    expect(bad).toMatchObject({ dentalStage: 'aligner', dentalAligner: 'prompt', dentalNotices: [{ kind: 'bad-file', message }] });
    expect(acceptsDentalDrop(bad)).toBe(true);
    expect(acceptsDentalDrop(aligner)).toBe(false);
    expect(reduceSession(bad, { type: 'dentalLoading' }).dentalNotices).toEqual([]);
    // Outside Step 1 nothing changes.
    expect(reduceSession(initialSession, { type: 'dentalBadFile', message })).toBe(initialSession);
  });

  it('a failed orientation keeps Step 1 ready with its message and no proposal', () => {
    const loading = run(initialSession, { type: 'enterDental' }, { type: 'chooseDentalProfile', id: 'p' }, { type: 'dentalLoading' });
    const failed = reduceSession(loading, { type: 'dentalOrientFailed', notices: [{ kind: 'failed' }] });
    expect(failed).toMatchObject({ dentalStage: 'aligner', dentalAligner: 'ready', dentalProposal: undefined, dentalNotices: [{ kind: 'failed' }] });
    // A late result of a replaced read is ignored.
    expect(reduceSession(failed, { type: 'dentalOriented', proposal, notices: [] })).toBe(failed);
  });

  it('a type mismatch is a notice that Keep dismisses and Switch re-runs with the other profile', () => {
    const loading = run(initialSession, { type: 'enterDental' }, { type: 'chooseDentalProfile', id: 'a' }, { type: 'dentalLoading' });
    const ready = reduceSession(loading, { type: 'dentalOriented', proposal, notices: [{ kind: 'mismatch' }, { kind: 'holes' }] });
    expect(reduceSession(ready, { type: 'dismissDentalNotice', kind: 'mismatch' }).dentalNotices).toEqual([{ kind: 'holes' }]);
    expect(reduceSession(ready, { type: 'switchDentalProfile', id: 'b' })).toMatchObject({ dentalProfile: 'b', dentalAligner: 'loading', dentalNotices: [] });
  });

  it('no support area: Step 2 opens with its message; leaving Step 2 clears it', () => {
    const ready = run(initialSession, { type: 'enterDental' }, { type: 'chooseDentalProfile', id: 'p' }, { type: 'dentalLoading' }, { type: 'dentalOriented', proposal, notices: [] });
    const area = reduceSession(ready, { type: 'acceptDentalOrientation', noArea: true });
    expect(gesture(area)).toMatchObject({ kind: 'dental-area', notices: [{ kind: 'no-area' }] });
    expect(reduceSession(area, { type: 'backDental' }).dentalNotices).toEqual([]);
  });

  it('exit outside the modes changes nothing', () => {
    expect(reduceSession(withActive, { type: 'exit' })).toBe(withActive);
  });

  it('leave ends either mode', () => {
    expect(reduceSession(editing, { type: 'leave' }).mode).toBe('off');
    const zones = reduceSession(withActive, { type: 'enterZones' });
    expect(reduceSession(zones, { type: 'leave' }).mode).toBe('off');
    expect(reduceSession(initialSession, { type: 'leave' })).toBe(initialSession);
  });

  it('a mode ends when its object goes (delete, undo)', () => {
    expect(reduceSession(editing, { type: 'activeUnitChanged', id: undefined }).mode).toBe('off');
    const zones = reduceSession(withActive, { type: 'enterZones' });
    expect(reduceSession(zones, { type: 'activeUnitChanged', id: undefined }).mode).toBe('off');
  });

  it('the undo floor is set on entering a mode from outside, not on leaving one', () => {
    expect(startsEditing(withActive, editing)).toBe(true);
    const zones = reduceSession(withActive, { type: 'enterZones' });
    expect(startsEditing(withActive, zones)).toBe(true);
    expect(startsEditing(zones, reduceSession(zones, { type: 'exit' }))).toBe(false);
    expect(startsEditing(editing, reduceSession(editing, { type: 'exit' }))).toBe(false);
  });
});

describe('reduceSession: tools', () => {
  it('sets each tool setting and keeps the state when it is unchanged', () => {
    const changed = run(editing,
      { type: 'setTool', tool: 'select' },
      { type: 'setSelectStyle', style: 'brush' },
      { type: 'setBrushMode', mode: 'unselect' },
      { type: 'setBrushRadius', radius: 40 },
      { type: 'setBrushSizing', sizing: true },
      { type: 'setZoneKind', kind: 'erase' },
      { type: 'setZoneRadius', radius: 7 });
    expect(changed).toMatchObject({ tool: 'select', selectStyle: 'brush', brushMode: 'unselect', brushRadius: 40, brushSizing: true, zoneKind: 'erase', zoneRadius: 7 });
    expect(reduceSession(changed, { type: 'setTool', tool: 'select' })).toBe(changed);
  });

  it('tools keep their setting across modes and objects (view state of the session)', () => {
    const changed = run(editing, { type: 'setTool', tool: 'select' }, { type: 'setZoneRadius', radius: 5 });
    const later = run(changed, { type: 'exit' }, { type: 'activeUnitChanged', id: 'u2' }, { type: 'enterEdit' });
    expect(later).toMatchObject({ mode: 'edit', tool: 'select', zoneRadius: 5 });
  });

  it('a tool change keeps the selection', () => {
    expect(reduceSession(selected, { type: 'setTool', tool: 'add' }).selection).toBe(selected.selection);
  });
});

describe('reduceSession: selection', () => {
  it('toggles one support in Support Edit Mode only', () => {
    expect([...selected.selection]).toEqual(['a', 'b']);
    expect([...reduceSession(selected, { type: 'toggleContact', id: 'a' }).selection]).toEqual(['b']);
    expect(reduceSession(withActive, { type: 'toggleContact', id: 'a' })).toBe(withActive);
  });

  it('paints and unpaints with Drag over, keeping the state when nothing changes', () => {
    const painted = reduceSession(editing, { type: 'paint', ids: ['a', 'b'], mode: 'select' });
    expect([...painted.selection]).toEqual(['a', 'b']);
    expect(reduceSession(painted, { type: 'paint', ids: ['a'], mode: 'select' })).toBe(painted);
    expect([...reduceSession(painted, { type: 'paint', ids: ['a', 'c'], mode: 'unselect' }).selection]).toEqual(['b']);
    expect(reduceSession(withActive, { type: 'paint', ids: ['a'], mode: 'select' })).toBe(withActive);
  });

  it('clears on request, and an empty selection stays the same state', () => {
    expect(reduceSession(selected, { type: 'clearSelection' }).selection.size).toBe(0);
    expect(reduceSession(editing, { type: 'clearSelection' })).toBe(editing);
  });

  it('puts a cleared selection back exactly (Undo on the toast), in Support Edit Mode only', () => {
    const cleared = reduceSession(selected, { type: 'clearSelection' });
    const restored = reduceSession(cleared, { type: 'restoreSelection', ids: ['a', 'b'] });
    expect([...restored.selection]).toEqual(['a', 'b']);
    expect(reduceSession(withActive, { type: 'restoreSelection', ids: ['a'] })).toBe(withActive);
  });

  it('clears on every mode change', () => {
    expect(reduceSession(selected, { type: 'exit' }).selection.size).toBe(0);
    expect(reduceSession(selected, { type: 'leave' }).selection.size).toBe(0);
  });

  it('clears when the active object changes', () => {
    const other = reduceSession(selected, { type: 'activeUnitChanged', id: 'u2' });
    expect(other).toMatchObject({ mode: 'edit', activeUnitId: 'u2' });
    expect(other.selection.size).toBe(0);
    expect(reduceSession(selected, { type: 'activeUnitChanged', id: 'u1' })).toBe(selected);
  });

  it('prunes ids whose contact is gone, keeping identity when all remain', () => {
    const pruned = reduceSession(selected, { type: 'contactsChanged', contacts: [contact('b'), contact('c')] });
    expect([...pruned.selection]).toEqual(['b']);
    expect(reduceSession(selected, { type: 'contactsChanged', contacts: [contact('a'), contact('b')] })).toBe(selected);
  });
});

describe('Fix on a check finding', () => {
  it('leaves the Add tool adding, whatever the tool and click action were', () => {
    const removing = run(editing, { type: 'setAddAction', action: 'remove' });
    expect(run(removing, ...FIX_TOOL_EVENTS)).toMatchObject({ tool: 'add', addAction: 'add' });
    expect(run(selected, ...FIX_TOOL_EVENTS)).toMatchObject({ tool: 'add', addAction: 'add' });
  });
});

describe('Drag over: Select | Unselect and Shift', () => {
  const dragging = run(editing, { type: 'setTool', tool: 'select' }, { type: 'setSelectStyle', style: 'brush' }, { type: 'toggleContact', id: 'a' });
  const effective = (state: EditSession) => gesture(state).kind === 'drag' ? (gesture(state) as { brush: { mode: string } }).brush.mode : undefined;

  it('Unselect stays chosen for the session, also across leaving and entering the mode', () => {
    const unselecting = run(dragging, { type: 'setBrushMode', mode: 'unselect' });
    expect(effective(unselecting)).toBe('unselect');
    expect(run(unselecting, { type: 'exit' }, { type: 'enterEdit' }, { type: 'setTool', tool: 'select' }, { type: 'setSelectStyle', style: 'brush' }).brushMode).toBe('unselect');
  });

  it('holding Shift flips the effective action either way and releasing restores it, without touching the switch', () => {
    const held = run(dragging, { type: 'shift', held: true });
    expect(effective(held)).toBe('unselect');
    expect(held.brushMode).toBe('select');
    expect(effective(run(held, { type: 'shift', held: false }))).toBe('select');
    const unselecting = run(dragging, { type: 'setBrushMode', mode: 'unselect' }, { type: 'shift', held: true });
    expect(effective(unselecting)).toBe('select');
    expect(effective(run(unselecting, { type: 'shift', held: false }))).toBe('unselect');
  });

  it('a press on the switch while Shift is down changes the switch only, and the flip stays on top of it', () => {
    const clicked = run(dragging, { type: 'shift', held: true }, { type: 'setBrushMode', mode: 'unselect' });
    expect(clicked).toMatchObject({ brushMode: 'unselect', shiftHeld: true });
    expect(effective(clicked)).toBe('select');
    expect(run(clicked, { type: 'shift', held: false })).toMatchObject({ brushMode: 'unselect', shiftHeld: false });
  });

  it('the drag gesture carries the switch and the flip apart, so the viewport can add the pointer own Shift', () => {
    const held = gesture(run(dragging, { type: 'shift', held: true }));
    expect(held).toMatchObject({ kind: 'drag', base: 'select', flipped: true, brush: { mode: 'unselect' } });
    expect(gesture(dragging)).toMatchObject({ base: 'select', flipped: false, brush: { mode: 'select' } });
  });

  it('leaving the mode lets go of Shift, and Shift outside Support Edit Mode is ignored', () => {
    expect(run(dragging, { type: 'shift', held: true }, { type: 'exit' }).shiftHeld).toBe(false);
    expect(reduceSession(withActive, { type: 'shift', held: true })).toBe(withActive);
  });

  it('a stroke painted while Shift is held takes the supports out of the selection', () => {
    const held = run(dragging, { type: 'shift', held: true });
    expect(run(held, { type: 'paint', ids: ['a', 'x'], mode: effective(held) as 'unselect' }).selection.has('a')).toBe(false);
    expect(run(dragging, { type: 'paint', ids: ['x'], mode: 'select' }).selection.has('x')).toBe(true);
  });
});

describe('reduceSession: dental Step 3 and finishing', () => {
  const step3 = run(initialSession, { type: 'enterDental' }, { type: 'chooseDentalProfile', id: 'p' }, { type: 'dentalLoading', unitId: 'u1' },
    { type: 'dentalOriented', proposal, notices: [] }, { type: 'acceptDentalOrientation' }, { type: 'acceptDentalArea' });

  it('Step 3 reuses the Support Edit Mode tools: selecting works, the canvas gets the edit gesture', () => {
    expect(step3).toMatchObject({ mode: 'dental', dentalStage: 'review', tool: 'add', addAction: 'add', selectStyle: 'click', dentalUnitId: 'u1' });
    expect(gesture(step3)).toMatchObject({ kind: 'dental-review', edit: { kind: 'add', remove: false } });
    const selecting = run(step3, { type: 'setTool', tool: 'select' });
    expect(gesture(selecting)).toMatchObject({ kind: 'dental-review', edit: { kind: 'pick' } });
    const picked = run(selecting, { type: 'toggleContact', id: 'a' }, { type: 'toggleContact', id: 'b' });
    expect([...picked.selection]).toEqual(['a', 'b']);
    expect(gesture(run(step3, { type: 'setTool', tool: 'add' }))).toMatchObject({ kind: 'dental-review', edit: { kind: 'add', remove: false } });
    // Step 1 takes no tip picks (Step 2 does, under Select).
    const aligner = run(step3, { type: 'backDental' }, { type: 'backDental' });
    expect(aligner.dentalStage).toBe('aligner');
    expect(reduceSession(aligner, { type: 'toggleContact', id: 'a' })).toBe(aligner);
  });

  it('Back from Step 3 drops the selection', () => {
    expect(run(step3, { type: 'toggleContact', id: 'a' }, { type: 'backDental' }).selection.size).toBe(0);
  });

  it('Add another aligner finishes this one and returns to Step 1 with the same type, ready for a drop', () => {
    const again = run(step3, { type: 'addAnotherDental', unitId: 'u1' });
    expect(again).toMatchObject({ mode: 'dental', dentalStage: 'aligner', dentalAligner: 'prompt', dentalProfile: 'p', dentalFinished: ['u1'], dentalUnitId: undefined, dentalProposal: undefined });
    expect(acceptsDentalDrop(again)).toBe(true);
    // The loop: the second aligner goes through the steps and finishes too.
    const second = run(again, { type: 'dentalLoading', unitId: 'u2' }, { type: 'dentalOriented', proposal, notices: [] }, { type: 'acceptDentalOrientation' }, { type: 'acceptDentalArea' });
    expect(second).toMatchObject({ dentalStage: 'review', dentalUnitId: 'u2', dentalFinished: ['u1'] });
    const done = run(second, { type: 'finishDental', unitId: 'u2' });
    expect(done).toMatchObject({ mode: 'off', dentalFinished: ['u1', 'u2'] });
    // Finishing the same aligner twice lists it once.
    expect(run(step3, { type: 'addAnotherDental', unitId: 'u1' }, { type: 'dentalLoading', unitId: 'u1' }).dentalFinished).toEqual(['u1']);
  });

  it('OK and Add another only work inside Step 3', () => {
    const area = run(step3, { type: 'backDental' });
    expect(reduceSession(area, { type: 'finishDental', unitId: 'u1' })).toBe(area);
    expect(reduceSession(area, { type: 'addAnotherDental', unitId: 'u1' })).toBe(area);
  });

  it('a new visit to the flow forgets the finished list', () => {
    const done = run(step3, { type: 'finishDental', unitId: 'u1' });
    expect(run(done, { type: 'enterDental' }).dentalFinished).toEqual([]);
  });
});
