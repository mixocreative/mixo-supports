import { describe, expect, it } from 'vitest';
import { checkStatus, coverRadius, exportStatus, joinRun, runToken, tallyChecks, uncovered } from './check';

const CLEAN = 'No unsupported spots found.';

describe('support check tally', () => {
  it('counts a unit whose check was replaced or did not finish as incomplete, never as clean', () => {
    expect(tallyChecks([{ spots: 2, inZone: 1 }, undefined, { spots: 0, inZone: 0 }])).toEqual({ spots: 2, inZone: 1, incomplete: 1 });
    expect(tallyChecks([])).toEqual({ spots: 0, inZone: 0, incomplete: 0 });
  });

  it('says the check did not finish instead of "No unsupported spots found."', () => {
    expect(checkStatus({ spots: 0, inZone: 0, incomplete: 1 }).key).not.toBe(CLEAN);
    expect(checkStatus({ spots: 0, inZone: 0, incomplete: 2 })).toEqual({ key: 'The check did not finish for 1 object: run it again.', other: 'The check did not finish for {n} objects: run it again.', vars: { n: 2 } });
    expect(checkStatus({ spots: 3, inZone: 0, incomplete: 1 }).key).toBe('The check did not finish for 1 object: run it again.');
  });

  it('reports spots, or clean only when every unit was checked', () => {
    expect(checkStatus({ spots: 0, inZone: 0, incomplete: 0 })).toEqual({ key: CLEAN });
    expect(checkStatus({ spots: 2, inZone: 1, incomplete: 0 })).toMatchObject({ vars: { n: 3 } });
  });

  it('an export never reads as checked when its check did not finish', () => {
    expect(exportStatus('a.stl', { spots: 0, inZone: 0, incomplete: 1 })).toEqual({
      key: 'Exported {files}, but the support check did not finish for 1 object: run Check supports.',
      other: 'Exported {files}, but the support check did not finish for {n} objects: run Check supports.',
      vars: { files: 'a.stl', n: 1 },
    });
    expect(exportStatus('a.stl', { spots: 0, inZone: 0, incomplete: 0 })).toEqual({ key: 'Exported {files}.', vars: { files: 'a.stl' } });
    expect(exportStatus('a.stl', { spots: 2, inZone: 0, incomplete: 0 }).vars).toEqual({ files: 'a.stl', n: 2 });
    expect(exportStatus('a.stl', { spots: 1, inZone: 4, incomplete: 0 }).vars).toEqual({ files: 'a.stl', n: 1, m: 4 });
    expect(exportStatus('a.stl', { spots: 0, inZone: 4, incomplete: 0 }).vars).toEqual({ files: 'a.stl', n: 4 });
  });
});

describe('joinRun', () => {
  it('a second caller for the same unit version joins the running job instead of replacing it', async () => {
    const running = new Map<string, { token: object; promise: Promise<number> }>();
    const version = {};
    let started = 0;
    let finish!: (value: number) => void;
    const start = () => { started += 1; return new Promise<number>((resolve) => { finish = resolve; }); };
    const first = joinRun(running, 'u1', version, start);
    const second = joinRun(running, 'u1', version, start);
    expect(second).toBe(first);
    expect(started).toBe(1);
    finish(7);
    await expect(second).resolves.toBe(7);
    expect(running.size).toBe(0);
  });

  it('a newer version starts its own job, and a failure clears the entry', async () => {
    const running = new Map<string, { token: object; promise: Promise<number> }>();
    const first = joinRun(running, 'u1', {}, () => Promise.reject(new Error('crashed')));
    const second = joinRun(running, 'u1', {}, () => Promise.resolve(2));
    expect(second).not.toBe(first);
    await expect(first).rejects.toThrow('crashed');
    await expect(second).resolves.toBe(2);
    expect(running.size).toBe(0);
  });
});

describe('runToken', () => {
  it('is one token per unit version and build', () => {
    const unit = {};
    const oldBuild = {};
    expect(runToken(unit, oldBuild)).toBe(runToken(unit, oldBuild));
    expect(runToken(unit, undefined)).toBe(runToken(unit, undefined));
    expect(runToken(unit, {})).not.toBe(runToken(unit, oldBuild));
    expect(runToken({}, oldBuild)).not.toBe(runToken(unit, oldBuild));
  });

  it('a recheck after the new build lands runs its own check instead of joining the one against the old build', async () => {
    const running = new Map<string, { token: object; promise: Promise<string> }>();
    const unit = {};
    const oldBuild = {};
    const newBuild = {};
    let finishOld!: (value: string) => void;
    // Checked while the unit's old build was current; still running when the new build lands.
    const first = joinRun(running, 'u1', runToken(unit, oldBuild), () => new Promise<string>((resolve) => { finishOld = resolve; }));
    const recheck = joinRun(running, 'u1', runToken(unit, newBuild), () => Promise.resolve('contacts of the new build'));
    finishOld('contacts of the old build');
    expect(await first).toBe('contacts of the old build');
    expect(await recheck).toBe('contacts of the new build');
  });
});

describe('findings of an out of date check', () => {
  const findings = [{ position: [0, 0, 0] as [number, number, number], area: 1 }, { position: [20, 0, 0] as [number, number, number], area: 100 }];

  it('covers a spot within the support spacing, or the finding size when that is larger', () => {
    expect(coverRadius(3, 1)).toBe(3);
    expect(coverRadius(3, 100)).toBe(10);
  });

  it('drops a finding once a support lands on its spot and keeps the others', () => {
    expect(uncovered(findings, [], 3)).toEqual(findings);
    expect(uncovered(findings, [{ position: [1, 1, 0] }], 3)).toEqual([findings[1]]);
    // The larger finding is covered from further away.
    expect(uncovered(findings, [{ position: [29, 0, 0] }], 3)).toEqual([findings[0]]);
    expect(uncovered(findings, [{ position: [1, 0, 0] }, { position: [25, 0, 0] }], 3)).toEqual([]);
  });
});
