import { describe, expect, it } from 'vitest';
import { TriangleGate } from './jobGate';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TriangleGate (heavy jobs run only while their triangles fit)', () => {
  it('starts jobs while running triangles plus their own stay within the limit', async () => {
    const gate = new TriangleGate(6_000_000);
    const a = await gate.acquire(2_000_000);
    const b = await gate.acquire(4_000_000);
    expect(gate.running).toBe(6_000_000);
    let started = false;
    const c = gate.acquire(1).then((release) => { started = true; return release; });
    await tick();
    expect(started).toBe(false);
    a();
    await tick();
    expect(started).toBe(true);
    b();
    (await c)();
    expect(gate.running).toBe(0);
  });

  it('lets a job over the limit start alone, so nothing waits forever', async () => {
    const gate = new TriangleGate(6_000_000);
    const huge = await gate.acquire(9_000_000);
    let small = false;
    void gate.acquire(10).then(() => { small = true; });
    await tick();
    expect(small).toBe(false);
    huge();
    await tick();
    expect(small).toBe(true);
  });

  it('is first in, first out: a small job does not overtake a waiting big one', async () => {
    const gate = new TriangleGate(10);
    const first = await gate.acquire(6);
    const order: string[] = [];
    void gate.acquire(8).then((release) => { order.push('big'); release(); });
    void gate.acquire(1).then((release) => { order.push('small'); release(); });
    await tick();
    expect(order).toEqual([]);
    first();
    await tick();
    expect(order).toEqual(['big', 'small']);
  });

  it('drops a waiting job when its signal aborts, and a release counts once', async () => {
    const gate = new TriangleGate(10);
    const held = await gate.acquire(10);
    const controller = new AbortController();
    const waiting = gate.acquire(5, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toSatisfy((error) => (error as Error).name === 'AbortError');
    held();
    held();
    expect(gate.running).toBe(0);
    expect(gate.waiting).toBe(0);
  });
});
