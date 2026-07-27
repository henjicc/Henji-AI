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
      { 'data-testid': 'mark-editor', 'data-source': props.sourceImageUrl },
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

function createPreviewResult(
  frame: string,
  document: ImageEditDocument,
  revision: number
): ImageEditPreviewExecutionResult {
  return {
    kind: 'preview-frame',
    frame,
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
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    pending.length = 0;
    executionMock.execute.mockReset();
    executionMock.execute.mockImplementation(() => {
      const deferred = createDeferred<ImageEditPreviewExecutionResult>();
      pending.push(deferred);
      return deferred.promise;
    });
    revokeObjectUrl.mockReset();
    vi.stubGlobal('URL', {
      ...URL,
      revokeObjectURL: revokeObjectUrl,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('参数变化期间保留上一帧，等新帧完成后再替换', async () => {
    const initialDocument = createDocument();
    const rendered = render(
      <ImageEditor sourceImageUrl="source.png" initialDocument={initialDocument} />
    );

    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0].resolve(createPreviewResult('blob:preview-1', initialDocument, 1));
      await pending[0].promise;
    });
    expect(rendered.getByTestId('mark-editor').getAttribute('data-source'))
      .toBe('blob:preview-1');

    fireEvent.click(rendered.getByRole('button', { name: '调整发光强度' }));
    await waitFor(() => expect(pending).toHaveLength(2));

    expect(rendered.getByTestId('mark-editor').getAttribute('data-source'))
      .toBe('blob:preview-1');
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    await act(async () => {
      pending[1].resolve(createPreviewResult('blob:preview-2', initialDocument, 2));
      await pending[1].promise;
    });
    expect(rendered.getByTestId('mark-editor').getAttribute('data-source'))
      .toBe('blob:preview-2');
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:preview-1');
  });
});
