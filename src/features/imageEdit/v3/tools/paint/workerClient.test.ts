import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaintWorkerClient } from './workerClient';
import { executePaintWorkerRequest, type PaintWorkerRequest, type PaintWorkerResponse } from './paint.worker';
import type { PaintSurface } from '@/core/imaging/paint';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<PaintWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request: PaintWorkerRequest | null = null;
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  postMessage(request: PaintWorkerRequest): void { this.request = structuredClone(request); }
  reply(): void { this.onmessage?.({ data: executePaintWorkerRequest(this.request!) } as MessageEvent<PaintWorkerResponse>); }
}
function surface(): PaintSurface { return { width: 1, height: 1, originX: 0, originY: 0, before: new Float32Array(1), output: new Float32Array(1), coverage: new Float32Array(1) }; }
afterEach(() => { vi.unstubAllGlobals(); FakeWorker.instances = []; });
describe('绘画Worker边界', () => {
  it('惰性启动，增量输出保留已绘制覆盖，完成后仍可下一批', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new PaintWorkerClient(), tile = surface(), signal = new AbortController().signal;
    const shape = { size: 4, hardness: 1, opacity: .5 };
    const dab = { x: .5, y: .5, radius: 2, flow: .5, angle: 0, roundness: 1, index: 0 };
    expect(FakeWorker.instances).toHaveLength(0);
    const first = client.rasterize(tile, [dab], shape, { kind: 'mask', value: 1 }, 'brush', signal);
    FakeWorker.instances[0].reply(); expect(await first).toBe(true); expect(tile.output[0]).toBe(.25);
    const second = client.rasterize(tile, [dab], shape, { kind: 'mask', value: 1 }, 'brush', signal);
    FakeWorker.instances[0].reply(); await second; expect(tile.output[0]).toBe(.375);
    const untouched = client.rasterize(tile, [], shape, { kind: 'mask', value: 1 }, 'brush', signal);
    FakeWorker.instances[0].reply(); expect(await untouched).toBe(false); expect(tile.output[0]).toBe(.375);
    client.dispose(); expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('取消终止Worker并拒绝在途任务，迟到消息不能改变输出', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new PaintWorkerClient(), abort = new AbortController(), tile = surface();
    const pending = client.fill(tile, { kind: 'solid', target: { kind: 'mask', value: 1 } }, 1, true, abort.signal);
    abort.abort(); await expect(pending).rejects.toThrow('取消');
    FakeWorker.instances[0].reply(); expect(tile.output[0]).toBe(0); expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});
