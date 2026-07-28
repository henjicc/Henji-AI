/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultDiffusionOperationParams,
  createEmptyImageEditDocument,
  createImageEditOperation,
  IMAGE_EDIT_OPERATION_IDS,
  upsertImageEditOperation,
  type DiffusionOperationParams,
  type ImageEditDocument,
  type ImageEditExecutionCapabilities,
  type ImageEditPreviewExecutionResult,
} from '@/core/imageEdit';
import { ImageEditor } from './ImageEditor';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const executionMock = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('../execution/imageEditExecution', () => ({
  imageEditExecutionPort: executionMock,
}));

vi.mock('@/features/imageMark/editor/MarkEditor', async () => {
  const React = await import('react');
  return {
    MarkEditor: (props: Record<string, unknown>) => React.createElement(
      'div',
      {
        'data-testid': 'mark-editor',
        // 预览走 sourceFrame（画好的 canvas），只有没有帧时才回落到 URL。
        'data-source': (props.sourceFrame as HTMLCanvasElement | null)?.dataset.previewId
          ?? props.sourceImageUrl,
      },
      props.rightPanel as React.ReactNode
    ),
  };
});

vi.mock('./ImageToolPanel', async () => {
  const React = await import('react');
  const { useImageEditorDocumentController } = await import('./ImageEditorDocumentContext');
  return {
    ImageToolPanel: () => {
      const controller = useImageEditorDocumentController();
      return React.createElement('button', {
        type: 'button',
        onClick: () => controller.updateOperation<DiffusionOperationParams>(
          IMAGE_EDIT_OPERATION_IDS.diffusion,
          (params) => ({ ...params, strength: params.strength + 0.1 })
        ),
      }, '调整发光强度');
    },
  };
});

const capabilities: ImageEditExecutionCapabilities = {
  executorId: 'image-edit-unified',
  backends: ['webgpu-worker'],
  supportedOperationIds: [IMAGE_EDIT_OPERATION_IDS.diffusion],
  purposes: ['preview'],
  qualities: ['realtime'],
  exportFormats: ['image/png'],
  hardCancellationSupported: true,
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      if (!resolvePromise) throw new Error('异步预览尚未初始化');
      resolvePromise(value);
    },
  };
}

function createDocument(): ImageEditDocument {
  return upsertImageEditOperation(
    createEmptyImageEditDocument(),
    createImageEditOperation(
      IMAGE_EDIT_OPERATION_IDS.diffusion,
      createDefaultDiffusionOperationParams(),
      'diffusion-test'
    )
  );
}

interface FakeBitmap {
  id: string;
  width: number;
  height: number;
  close: () => void;
}

/**
 * WebGPU 与 Sharp 两条路都交回 ImageBitmap（见 imageEditExecution 的 preview 分支），
 * 所以这里也用位图而不是 URL。jsdom 没有 ImageBitmap 与 canvas 2d 上下文，
 * 用带 id 的替身让断言能认出到底是哪一帧落在了画布上。
 */
function createFakeBitmap(id: string): FakeBitmap {
  return { id, width: 1280, height: 720, close: vi.fn() };
}

function createPreviewResult(
  frame: FakeBitmap,
  document: ImageEditDocument,
  revision: number
): ImageEditPreviewExecutionResult {
  return {
    kind: 'preview-frame',
    frame: frame as unknown as ImageBitmap,
    document,
    executorId: 'image-edit-unified',
    backend: 'webgpu-worker',
    width: 1280,
    height: 720,
    revision,
    capabilities,
  };
}

describe('ImageEditor 发光预览', () => {
  const pending: Deferred<ImageEditPreviewExecutionResult>[] = [];
  let originalGetContext: HTMLCanvasElement['getContext'];

  beforeEach(() => {
    pending.length = 0;
    executionMock.execute.mockReset();
    executionMock.execute.mockImplementation(() => {
      const deferred = createDeferred<ImageEditPreviewExecutionResult>();
      pending.push(deferred);
      return deferred.promise;
    });
    // jsdom 没有 2d 上下文。这里把画上去的那一帧的 id 记在 canvas 上，
    // 断言就能直接看出显示的是哪一帧。
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function stubGetContext(
      this: HTMLCanvasElement
    ): unknown {
      return {
        drawImage: (source: FakeBitmap): void => {
          this.dataset.previewId = source.id;
        },
      };
    } as unknown as HTMLCanvasElement['getContext'];
  });

  afterEach(() => {
    cleanup();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.unstubAllGlobals();
  });

  it('参数变化期间保留上一帧，等新帧完成后再替换', async () => {
    const initialDocument = createDocument();
    const first = createFakeBitmap('preview-1');
    const second = createFakeBitmap('preview-2');
    const rendered = render(
      <ImageEditor sourceImageUrl="source.png" initialDocument={initialDocument} />
    );

    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0].resolve(createPreviewResult(first, initialDocument, 1));
      await pending[0].promise;
    });
    expect(rendered.getByTestId('mark-editor').getAttribute('data-source'))
      .toBe('preview-1');

    fireEvent.click(rendered.getByRole('button', { name: '调整发光强度' }));
    await waitFor(() => expect(pending).toHaveLength(2));

    expect(rendered.getByTestId('mark-editor').getAttribute('data-source'))
      .toBe('preview-1');

    await act(async () => {
      pending[1].resolve(createPreviewResult(second, initialDocument, 2));
      await pending[1].promise;
    });
    expect(rendered.getByTestId('mark-editor').getAttribute('data-source'))
      .toBe('preview-2');
  });

  /**
   * 位图必须在落到 canvas 后当场释放。留给 React 生命周期去猜什么时候该关，
   * 拖滑块时每秒几十张 2 百万像素的位图会一直攒着不放。
   */
  it('每帧落到画布后立刻释放位图', async () => {
    const initialDocument = createDocument();
    const frame = createFakeBitmap('preview-1');
    render(<ImageEditor sourceImageUrl="source.png" initialDocument={initialDocument} />);

    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0].resolve(createPreviewResult(frame, initialDocument, 1));
      await pending[0].promise;
    });

    expect(frame.close).toHaveBeenCalledTimes(1);
  });
});
