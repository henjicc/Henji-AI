import { describe, expect, it, vi } from 'vitest';
import { runAdvancedSelectionWorker } from './workerClient';
import type { AdvancedSelectionWorkerMessage } from './protocol';

const request = { grid: { width: 4, height: 4 }, context: { sourceVersion: 'v1', time: { kind: 'static' } as const, referenceGrid: { width: 4, height: 4 }, quality: 'final' as const }, operation: { kind: 'solve' as const, algorithm: { kind: 'focus' as const, range: .5, noise: .1 } } };
function worker() {
  const instance = { onmessage: null as ((event: MessageEvent<AdvancedSelectionWorkerMessage>) => void) | null, onerror: null as ((event: ErrorEvent) => void) | null, postMessage: vi.fn(), terminate: vi.fn() };
  const send = (data: AdvancedSelectionWorkerMessage) => instance.onmessage?.({ data } as MessageEvent<AdvancedSelectionWorkerMessage>);
  return { instance, send, create: () => instance as unknown as Worker };
}
describe('高级选区 Worker 资源与取消', () => {
  it('请求读块、进度与 float32 结果，完成释放 Worker', async () => {
    const fake = worker(), abort = new AbortController(), progress = vi.fn();
    const data = new Float32Array(16).fill(.371234), region = { x: 0, y: 0, width: 4, height: 4 };
    const reader = { read: vi.fn(async () => ({ value: { ...region, data } })) };
    const pending = runAdvancedSelectionWorker(request, reader, abort.signal, progress, fake.create);
    fake.send({ kind: 'read', id: 1, region, pixels: false });
    await vi.waitFor(() => expect(fake.instance.postMessage).toHaveBeenCalledTimes(2));
    expect(reader.read).toHaveBeenCalledWith(region, false, abort.signal);
    expect(fake.instance.postMessage).toHaveBeenLastCalledWith({ kind: 'read-result', id: 1, value: { ...region, data } }, [data.buffer]);
    fake.send({ kind: 'progress', completed: 2, total: 3 }); expect(progress).toHaveBeenCalledWith(2, 3);
    const snapshot = { grid: request.grid, tileSize: 4, defaultValue: 0, inverted: false, tiles: new Map([['0/0', { ...region, data }]]) };
    fake.send({ kind: 'result', snapshot }); expect(await pending).toEqual(snapshot); expect(fake.instance.terminate).toHaveBeenCalledOnce();
  });
  it('取消终止任务，迟到读取不会 postMessage；失败返回具体原因', async () => {
    const fake = worker(), abort = new AbortController();
    let resolve!: (value: { value: { x: number; y: number; width: number; height: number; data: Float32Array } }) => void;
    const reader = { read: () => new Promise<Parameters<typeof resolve>[0]>(done => { resolve = done; }) };
    const pending = runAdvancedSelectionWorker(request, reader, abort.signal, undefined, fake.create);
    fake.send({ kind: 'read', id: 1, region: { x: 0, y: 0, width: 1, height: 1 }, pixels: true });
    abort.abort(); await expect(pending).rejects.toThrow('CANCELLED');
    resolve({ value: { x: 0, y: 0, width: 1, height: 1, data: new Float32Array(4) } }); await Promise.resolve();
    expect(fake.instance.postMessage).toHaveBeenCalledOnce(); expect(fake.instance.terminate).toHaveBeenCalledOnce();
    const failed = worker();
    const task = runAdvancedSelectionWorker(request, reader, new AbortController().signal, undefined, failed.create);
    failed.send({ kind: 'error', message: '取样点超出当前图层' }); await expect(task).rejects.toThrow('取样点超出');
  });
});
