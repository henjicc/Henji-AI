// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MaskEditorDocument } from '@/features/maskEditor/types';
import { useLocalRedrawMaskAutosave } from './useLocalRedrawMaskAutosave';

const {
  persistImageSourceTracked,
  releaseManagedGenerationMedia,
  exportMaskDocumentToPng,
} = vi.hoisted(() => ({
  persistImageSourceTracked: vi.fn(async () => ({
    imagePath: '/managed/mask-latest.png',
    createdFilePaths: ['/managed/mask-latest.png'],
  })),
  releaseManagedGenerationMedia: vi.fn(async () => undefined),
  exportMaskDocumentToPng: vi.fn(() => 'data:image/png;base64,bWFzaw=='),
}));

vi.mock('@/commands/image', () => ({ persistImageSourceTracked }));
vi.mock('@/features/maskEditor/maskExport', () => ({ exportMaskDocumentToPng }));
vi.mock('@/platform/runtime', () => ({
  getPlatform: () => ({ image: { releaseManagedGenerationMedia } }),
  isDesktopRuntime: () => false,
}));

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function documentWith(strokeIds: readonly string[]): MaskEditorDocument {
  return {
    version: 1,
    sourceRef: '/managed/source.png',
    width: 640,
    height: 480,
    strokes: strokeIds.map((id, index) => ({
      id,
      kind: 'stroke',
      mode: 'paint',
      size: 24,
      points: [{ x: 80 + index * 20, y: 90 + index * 20 }],
    })),
  };
}

function StrictModeWrapper({ children }: PropsWithChildren): JSX.Element {
  return <StrictMode>{children}</StrictMode>;
}

beforeEach(() => {
  persistImageSourceTracked.mockReset();
  persistImageSourceTracked.mockResolvedValue({
    imagePath: '/managed/mask-latest.png',
    createdFilePaths: ['/managed/mask-latest.png'],
  });
  releaseManagedGenerationMedia.mockReset();
  releaseManagedGenerationMedia.mockResolvedValue(undefined);
  exportMaskDocumentToPng.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('局部重绘遮罩自动保存', () => {
  it('跳过初始载入，并把连续修改合并为最后一版自动保存', async () => {
    const onPersist = vi.fn();
    const initialDocument = documentWith([]);
    const rendered = renderHook(
      ({ document }) => useLocalRedrawMaskAutosave({ document, ready: true, onPersist }),
      { initialProps: { document: initialDocument }, wrapper: StrictModeWrapper },
    );

    expect(onPersist).not.toHaveBeenCalled();

    rendered.rerender({ document: documentWith(['stroke-1']) });
    rendered.rerender({ document: documentWith(['stroke-1', 'stroke-2']) });

    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1));
    expect(persistImageSourceTracked).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenCalledWith({
      maskSource: '/managed/mask-latest.png',
      document: expect.objectContaining({
        strokes: [expect.objectContaining({ id: 'stroke-1' }), expect.objectContaining({ id: 'stroke-2' })],
      }),
    });
    expect(releaseManagedGenerationMedia).not.toHaveBeenCalled();
  });

  it('回收从未转移的陈旧版本，但保留所有已经成功转移给节点的版本', async () => {
    const first = deferred<{ imagePath: string; createdFilePaths: string[] }>();
    persistImageSourceTracked
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        imagePath: '/managed/mask-2.png',
        createdFilePaths: ['/managed/mask-2.png'],
      })
      .mockResolvedValueOnce({
        imagePath: '/managed/mask-3.png',
        createdFilePaths: ['/managed/mask-3.png'],
      });
    const onPersist = vi.fn();
    const rendered = renderHook(
      ({ document }) => useLocalRedrawMaskAutosave({ document, ready: true, onPersist }),
      { initialProps: { document: documentWith([]) } },
    );

    rendered.rerender({ document: documentWith(['stroke-1']) });
    await waitFor(() => expect(persistImageSourceTracked).toHaveBeenCalledTimes(1));
    rendered.rerender({ document: documentWith(['stroke-1', 'stroke-2']) });
    await act(async () => {
      first.resolve({
        imagePath: '/managed/mask-1.png',
        createdFilePaths: ['/managed/mask-1.png'],
      });
      await first.promise;
    });

    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1));
    expect(onPersist).toHaveBeenLastCalledWith(expect.objectContaining({ maskSource: '/managed/mask-2.png' }));
    expect(releaseManagedGenerationMedia).toHaveBeenCalledWith(['/managed/mask-1.png']);

    rendered.rerender({ document: documentWith(['stroke-1', 'stroke-2', 'stroke-3']) });
    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(2));
    expect(onPersist).toHaveBeenLastCalledWith(expect.objectContaining({ maskSource: '/managed/mask-3.png' }));
    expect(releaseManagedGenerationMedia).toHaveBeenCalledTimes(1);
    expect(releaseManagedGenerationMedia).not.toHaveBeenCalledWith(['/managed/mask-2.png']);
    expect(releaseManagedGenerationMedia).not.toHaveBeenCalledWith(['/managed/mask-3.png']);
  });

  it('组件卸载后回收仍在保存中的结果且不再转移给节点', async () => {
    const saving = deferred<{ imagePath: string; createdFilePaths: string[] }>();
    persistImageSourceTracked.mockReturnValueOnce(saving.promise);
    const onPersist = vi.fn();
    const rendered = renderHook(
      ({ document }) => useLocalRedrawMaskAutosave({ document, ready: true, onPersist }),
      { initialProps: { document: documentWith([]) } },
    );

    rendered.rerender({ document: documentWith(['stroke-1']) });
    await waitFor(() => expect(persistImageSourceTracked).toHaveBeenCalledTimes(1));
    rendered.unmount();
    await act(async () => {
      saving.resolve({
        imagePath: '/managed/unmounted.png',
        createdFilePaths: ['/managed/unmounted.png'],
      });
      await saving.promise;
    });

    await waitFor(() => {
      expect(releaseManagedGenerationMedia).toHaveBeenCalledWith(['/managed/unmounted.png']);
    });
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('节点回调抛错时回收尚未成功转移的保存结果', async () => {
    const onPersist = vi.fn(() => {
      throw new Error('node update failed');
    });
    const rendered = renderHook(
      ({ document }) => useLocalRedrawMaskAutosave({ document, ready: true, onPersist }),
      { initialProps: { document: documentWith([]) } },
    );

    rendered.rerender({ document: documentWith(['stroke-1']) });

    await waitFor(() => expect(rendered.result.current).toEqual({
      status: 'failed',
      message: 'node update failed',
    }));
    expect(releaseManagedGenerationMedia).toHaveBeenCalledWith(['/managed/mask-latest.png']);
  });

  it('清空遮罩立即保存空文档，不再生成无意义图片文件', async () => {
    const onPersist = vi.fn();
    const paintedDocument = documentWith(['stroke-1']);
    const rendered = renderHook(
      ({ document }) => useLocalRedrawMaskAutosave({ document, ready: true, onPersist }),
      { initialProps: { document: paintedDocument } },
    );

    await act(async () => {
      rendered.rerender({ document: documentWith([]) });
    });

    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1));
    expect(persistImageSourceTracked).not.toHaveBeenCalled();
    expect(onPersist).toHaveBeenCalledWith({
      maskSource: null,
      document: expect.objectContaining({ strokes: [] }),
    });
  });

  it('持久化失败后保留最新版任务并自动重试', async () => {
    persistImageSourceTracked
      .mockRejectedValueOnce(new Error('temporary persist failure'))
      .mockResolvedValueOnce({
        imagePath: '/managed/retried.png',
        createdFilePaths: ['/managed/retried.png'],
      });
    const onPersist = vi.fn();
    const rendered = renderHook(
      ({ document }) => useLocalRedrawMaskAutosave({ document, ready: true, onPersist }),
      { initialProps: { document: documentWith([]) } },
    );

    rendered.rerender({ document: documentWith(['stroke-1']) });

    await waitFor(() => expect(persistImageSourceTracked).toHaveBeenCalledTimes(2), { timeout: 2500 });
    await waitFor(() => expect(onPersist).toHaveBeenCalledWith(expect.objectContaining({
      maskSource: '/managed/retried.png',
    })));
    expect(rendered.result.current).toEqual({ status: 'saved' });
  });

  it('启动前既有文件没有可释放 lease，卸载时不会误删', async () => {
    const saving = deferred<{ imagePath: string; createdFilePaths: string[] }>();
    persistImageSourceTracked.mockReturnValueOnce(saving.promise);
    const onPersist = vi.fn();
    const rendered = renderHook(
      ({ document }) => useLocalRedrawMaskAutosave({ document, ready: true, onPersist }),
      { initialProps: { document: documentWith([]) } },
    );

    rendered.rerender({ document: documentWith(['stroke-1']) });
    await waitFor(() => expect(persistImageSourceTracked).toHaveBeenCalledTimes(1));
    rendered.unmount();
    await act(async () => {
      saving.resolve({
        imagePath: '/managed/preexisting.png',
        createdFilePaths: [],
      });
      await saving.promise;
    });

    expect(releaseManagedGenerationMedia).not.toHaveBeenCalled();
    expect(onPersist).not.toHaveBeenCalled();
  });
});
