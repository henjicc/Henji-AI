import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeometryWorkerClient } from './workerClient';
class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { FakeWorker.latest = this; }
}
afterEach(() => { vi.unstubAllGlobals(); });
describe('尺寸 Worker 取消与释放', () => {
  it('取消立即终止实际工作者并拒绝等待；迟到结果不再回写', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new GeometryWorkerClient(), controller = new AbortController();
    const pending = client.run({ kind: 'linear', source: { width: 7680, height: 4320 } }, controller.signal);
    const worker = FakeWorker.latest; controller.abort();
    await expect(pending).rejects.toThrow('CANCELLED'); expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull(); client.dispose();
  });
  it('进度回调失败不会留下挂起请求；正常结果与串行约束保持', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new GeometryWorkerClient(), signal = new AbortController().signal;
    const pending = client.run({ kind: 'linear', source: { width: 1, height: 1 } }, signal, () => { throw new Error('progress failure'); });
    await expect(client.run({ kind: 'linear', source: { width: 1, height: 1 } }, signal)).rejects.toThrow('串行');
    FakeWorker.latest.onmessage!({ data: { kind: 'progress', completed: 1, total: 2 } } as MessageEvent);
    await expect(pending).rejects.toThrow('progress failure');
    const next = client.run({ kind: 'bounds', source: { width: 1, height: 1 }, output: { width: 1, height: 1 }, region: { x: 0, y: 0, width: 1, height: 1 } }, signal);
    FakeWorker.latest.onmessage!({ data: { kind: 'result', value: { x: 0, y: 0, width: 1, height: 1 } } } as MessageEvent);
    await expect(next).resolves.toEqual({ x: 0, y: 0, width: 1, height: 1 }); client.dispose();
  });
});
