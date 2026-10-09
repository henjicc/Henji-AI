import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaskRegionRasterizer } from './regionWorkerClient';
import { createEmptyMaskDocument } from './maskDocument';
import type { MaskRegionWorkerRequest, MaskRegionWorkerResponse } from './region.worker';

class TestWorker {
  static current: TestWorker;
  onmessage: ((event: MessageEvent<MaskRegionWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  requests: MaskRegionWorkerRequest[] = [];
  terminate = vi.fn();
  constructor() { TestWorker.current = this; }
  postMessage(request: MaskRegionWorkerRequest): void { this.requests.push(request); }
  respond(response: MaskRegionWorkerResponse): void { this.onmessage?.({ data: response } as MessageEvent<MaskRegionWorkerResponse>); }
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('参数蒙版区域 Worker 生命周期', () => {
  it('按会话编译一次、顺序读取块，传输浮点结果，释放时拒绝挂起读取', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const client = new MaskRegionRasterizer(createEmptyMaskDocument('source', 4, 4));
    const roi = { x: 0, y: 0, width: 2, height: 2 };
    const request = client.read(roi, { width: 4, height: 4 });
    expect(TestWorker.current.requests).toMatchObject([{ kind: 'document' }, { kind: 'read', id: 1, region: roi }]);
    const data = new Float32Array([0.1, 0.4, 0.5, 1]);
    TestWorker.current.respond({ id: 1, data });
    expect(await request).toBe(data);
    const pending = client.read(roi, { width: 4, height: 4 });
    const rejected = expect(pending).rejects.toThrow('已取消');
    client.dispose(); await rejected;
    expect(TestWorker.current.terminate).toHaveBeenCalled();
    await expect(client.read(roi, { width: 4, height: 4 })).rejects.toThrow('已关闭');
  });
  it('Worker 失败不会吞错或让确认永久等待', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const client = new MaskRegionRasterizer(createEmptyMaskDocument('source', 4, 4));
    const pending = client.read({ x: 0, y: 0, width: 2, height: 2 }, { width: 4, height: 4 });
    const rejected = expect(pending).rejects.toThrow('求值失败');
    TestWorker.current.onerror?.();
    await rejected;
  });
  it('连续手势只提交正在求值和最后一次预览，不积累未用快照', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const document = createEmptyMaskDocument('source', 4, 4);
    const client = new MaskRegionRasterizer(document);
    const roi = { x: 0, y: 0, width: 2, height: 2 };
    const first = client.readLatest(document, roi, document);
    const replaced = client.readLatest(document, roi, document);
    const rejected = expect(replaced).rejects.toThrow('新手势');
    const latest = client.readLatest(document, roi, document);
    await rejected;
    expect(TestWorker.current.requests.filter(request => request.kind === 'read')).toHaveLength(1);
    TestWorker.current.respond({ id: 1, data: new Float32Array(4) });
    await first;
    await Promise.resolve();
    expect(TestWorker.current.requests.filter(request => request.kind === 'read')).toHaveLength(2);
    TestWorker.current.respond({ id: 2, data: new Float32Array(4).fill(0.5) });
    expect([...(await latest)]).toEqual([0.5, 0.5, 0.5, 0.5]);
    client.dispose();
  });
});
