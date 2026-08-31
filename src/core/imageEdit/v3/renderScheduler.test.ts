import { describe, expect, it, vi } from 'vitest';
import {
  ImageEditRenderScheduler,
  ImageEditTaskCancelledError,
  ImageEditTaskSupersededError,
} from './renderScheduler';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('图片编辑 V3 调度器', () => {
  it('每会话只保留一个运行中预览和一个最新待处理版本', async () => {
    const scheduler = new ImageEditRenderScheduler();
    const gate = deferred<void>();
    const first = scheduler.schedule({
      id: 'p1', sessionId: 's', revision: 1, kind: 'preview', lane: 'gpu', priority: 400,
      run: async () => { await gate.promise; return 1; },
    });
    const second = scheduler.schedule({
      id: 'p2', sessionId: 's', revision: 2, kind: 'preview', lane: 'gpu', priority: 400,
      run: async () => 2,
    });
    const third = scheduler.schedule({
      id: 'p3', sessionId: 's', revision: 3, kind: 'preview', lane: 'gpu', priority: 500,
      run: async () => 3,
    });
    await expect(second).rejects.toBeInstanceOf(ImageEditTaskSupersededError);
    expect(scheduler.snapshot()).toMatchObject({
      runningGpu: 1,
      pendingPreviewSessions: 1,
      activePreviewSessions: 1,
    });
    gate.resolve();
    await expect(first).rejects.toBeInstanceOf(ImageEditTaskSupersededError);
    await expect(third).resolves.toBe(3);
  });

  it('GPU 串行、CPU 按限制并行并按优先级取待处理任务', async () => {
    const scheduler = new ImageEditRenderScheduler({ cpuConcurrency: 2 });
    const gate = deferred<void>();
    const order: string[] = [];
    const run = (id: string, wait = false) => async () => {
      order.push(id);
      if (wait) await gate.promise;
      return id;
    };
    const a = scheduler.schedule({ id: 'a', sessionId: 'a', revision: 1, kind: 'export', lane: 'gpu', priority: 200, run: run('a', true) });
    const b = scheduler.schedule({ id: 'b', sessionId: 'b', revision: 1, kind: 'prefetch', lane: 'gpu', priority: 100, run: run('b') });
    const c = scheduler.schedule({ id: 'c', sessionId: 'c', revision: 1, kind: 'preview', lane: 'gpu', priority: 500, run: run('c') });
    expect(order).toEqual(['a']);
    gate.resolve();
    await Promise.all([a, b, c]);
    expect(order).toEqual(['a', 'c', 'b']);
  });

  it('多个导出只占一个 CPU 槽，保留一个交互解码槽', async () => {
    const scheduler = new ImageEditRenderScheduler({ cpuConcurrency: 2 });
    const gate = deferred<void>();
    const order: string[] = [];
    const firstExport = scheduler.schedule({
      id: 'cpu-export-1', sessionId: 'export-1', revision: 1, kind: 'export', lane: 'cpu', priority: 200,
      run: async () => { order.push('export-1'); await gate.promise; },
    });
    const secondExport = scheduler.schedule({
      id: 'cpu-export-2', sessionId: 'export-2', revision: 1, kind: 'export', lane: 'cpu', priority: 200,
      run: async () => { order.push('export-2'); },
    });
    const interactiveDecode = scheduler.schedule({
      id: 'cpu-preview-decode', sessionId: 'preview', revision: 1, kind: 'preview', lane: 'cpu', priority: 500,
      run: async () => { order.push('preview-decode'); },
    });
    await interactiveDecode;
    await Promise.resolve();
    expect(order).toEqual(['export-1', 'preview-decode']);
    expect(scheduler.snapshot()).toMatchObject({ runningCpu: 1, pendingOtherTasks: 1 });
    gate.resolve();
    await Promise.all([firstExport, secondExport]);
    expect(order).toEqual(['export-1', 'preview-decode', 'export-2']);
  });

  it('取消立即清空待处理任务，并以协作式 signal 通知运行任务', async () => {
    const scheduler = new ImageEditRenderScheduler();
    const aborted = vi.fn();
    const gate = deferred<void>();
    const active = scheduler.schedule({
      id: 'active', sessionId: 's', revision: 1, kind: 'preview', lane: 'gpu', priority: 500,
      run: async ({ signal }) => {
        signal.addEventListener('abort', aborted);
        await gate.promise;
        return 'done';
      },
    });
    const pending = scheduler.schedule({
      id: 'pending', sessionId: 's', revision: 2, kind: 'export', lane: 'gpu', priority: 200,
      run: async () => 'pending',
    });
    scheduler.cancelSession('s');
    await expect(pending).rejects.toBeInstanceOf(ImageEditTaskCancelledError);
    expect(aborted).toHaveBeenCalledOnce();
    gate.resolve();
    await expect(active).rejects.toBeInstanceOf(ImageEditTaskCancelledError);
  });

  it('同 revision 的新预览也取代旧 PreviewOverride，旧帧不会成功返回', async () => {
    const scheduler = new ImageEditRenderScheduler();
    const gate = deferred<void>();
    const oldFrame = scheduler.schedule({
      id: 'same-old', sessionId: 'same', revision: 4, kind: 'preview', lane: 'gpu', priority: 500,
      run: async () => { await gate.promise; return 'old'; },
    });
    const newFrame = scheduler.schedule({
      id: 'same-new', sessionId: 'same', revision: 4, kind: 'preview', lane: 'gpu', priority: 500,
      run: async () => 'new',
    });
    gate.resolve();

    await expect(oldFrame).rejects.toBeInstanceOf(ImageEditTaskSupersededError);
    await expect(newFrame).resolves.toBe('new');
  });

  it('同一会话的不同合并流互不取消，取消会话仍会一起停止', async () => {
    const scheduler = new ImageEditRenderScheduler({ cpuConcurrency: 2 });
    const gate = deferred<void>();
    const display = scheduler.schedule({
      id: 'display', sessionId: 'shared', coalescingKey: 'display', revision: 1,
      kind: 'preview', purpose: 'display', lane: 'cpu', priority: 500,
      run: async () => { await gate.promise; return 'display'; },
    });
    const auxiliary = scheduler.schedule({
      id: 'auxiliary', sessionId: 'shared', coalescingKey: 'auxiliary', revision: 1,
      kind: 'preview', purpose: 'display', lane: 'cpu', priority: 400,
      run: async () => { await gate.promise; return 'auxiliary'; },
    });

    expect(scheduler.snapshot()).toMatchObject({
      runningCpu: 2,
      activePreviewSessions: 2,
    });
    scheduler.cancelSession('shared');
    gate.resolve();
    await expect(display).rejects.toBeInstanceOf(ImageEditTaskCancelledError);
    await expect(auxiliary).rejects.toBeInstanceOf(ImageEditTaskCancelledError);
  });

  it('可按任务 ID 取消待处理或运行中的原子任务', async () => {
    const scheduler = new ImageEditRenderScheduler({ cpuConcurrency: 1 });
    const gate = deferred<void>();
    const active = scheduler.schedule({
      id: 'active-id', sessionId: 'active-session', revision: 1, kind: 'export', lane: 'cpu', priority: 200,
      run: async ({ signal }) => {
        await gate.promise;
        if (signal.aborted) throw signal.reason;
        return 'active';
      },
    });
    const pending = scheduler.schedule({
      id: 'pending-id', sessionId: 'pending-session', revision: 1, kind: 'export', lane: 'cpu', priority: 200,
      run: async () => 'pending',
    });
    scheduler.cancelTask('pending-id');
    await expect(pending).rejects.toBeInstanceOf(ImageEditTaskCancelledError);
    scheduler.cancelTask('active-id');
    gate.resolve();
    await expect(active).rejects.toBeInstanceOf(ImageEditTaskCancelledError);
    expect(scheduler.snapshot()).toMatchObject({ runningCpu: 0, pendingOtherTasks: 0 });
  });

  it('拒绝倒退 revision 和未结束的重复任务 ID', async () => {
    const scheduler = new ImageEditRenderScheduler();
    const gate = deferred<void>();
    const latest = scheduler.schedule({
      id: 'unique', sessionId: 'revision', revision: 5, kind: 'preview', lane: 'gpu', priority: 500,
      run: async () => { await gate.promise; return 5; },
    });
    await expect(scheduler.schedule({
      id: 'unique', sessionId: 'other', revision: 1, kind: 'export', lane: 'cpu', priority: 200,
      run: async () => 1,
    })).rejects.toThrow('ID 重复');
    await expect(scheduler.schedule({
      id: 'stale', sessionId: 'revision', revision: 4, kind: 'preview', lane: 'gpu', priority: 500,
      run: async () => 4,
    })).rejects.toBeInstanceOf(ImageEditTaskSupersededError);
    gate.resolve();
    await expect(latest).resolves.toBe(5);
  });
});
