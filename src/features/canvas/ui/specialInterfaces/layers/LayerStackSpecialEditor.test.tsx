// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CanvasSpecialEditorSession } from '@/features/canvas/application/specialEditorController';
import { createStableLayerId, createStableLayerResourceId, createStableLayerStackId, type LayerStackDocumentV1 } from '@/features/canvas/domain/layerStack';

import LayerStackSpecialEditor from './LayerStackSpecialEditor';

const recomposeLayerStackDocument = vi.fn(async (
  document: LayerStackDocumentV1,
  _compose?: undefined,
  _requestId?: string,
  _onCreatedFilePaths?: (filePaths: readonly string[]) => void,
) => document);
const platformMocks = vi.hoisted(() => ({
  cancelLayerStackComposition: vi.fn(async () => undefined),
  releaseLayerStackResources: vi.fn(async () => undefined),
}));

vi.mock('@/features/canvas/application/layerStackApplicationService', () => ({
  recomposeLayerStackDocument: (
    document: LayerStackDocumentV1,
    compose: undefined,
    requestId?: string,
    onCreatedFilePaths?: (filePaths: readonly string[]) => void,
  ) => recomposeLayerStackDocument(document, compose, requestId, onCreatedFilePaths),
}));

vi.mock('@/platform/runtime', () => ({
  isDesktopRuntime: () => false,
  getPlatform: () => ({
    image: {
      saveImageSourceToDownloads: vi.fn(async () => '/downloads/layer.png'),
      cancelLayerStackComposition: platformMocks.cancelLayerStackComposition,
      releaseLayerStackResources: platformMocks.releaseLayerStackResources,
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function document(): LayerStackDocumentV1 {
  const completionId = 'layer-editor-completion';
  const stackId = createStableLayerStackId(completionId);
  return {
    version: 1,
    stackId,
    status: 'ready',
    source: { capabilityId: 'image.layer-separation', sourceNodeId: 'source', inputResourceId: 'input', providerId: 'volcengine', modelId: 'seedream', completionId },
    canvas: { width: 512, height: 512, colorSpace: 'srgb', alphaMode: 'straight', compositeOperation: 'source-over', clipPolicy: 'canvas-bounds' },
    compositeResourceId: `${stackId}:composite`,
    thumbnailResourceId: `${stackId}:thumbnail`,
    layers: [
      { version: 1, layerId: createStableLayerId(stackId, 0), sourceOutputIndex: 0, providerZIndex: 0, order: 0, role: 'base', name: '底图', resourceId: createStableLayerResourceId(stackId, 0), placement: { x: 0, y: 0, width: 512, height: 512 }, opacity: 1, visible: true, blendMode: 'normal', alpha: 'opaque' },
      { version: 1, layerId: createStableLayerId(stackId, 1), sourceOutputIndex: 1, providerZIndex: 1, order: 1, role: 'content', name: '标题', resourceId: createStableLayerResourceId(stackId, 1), placement: { x: 20, y: 30, width: 100, height: 40 }, opacity: 1, visible: true, blendMode: 'normal', alpha: 'straight' },
    ],
    resources: [
      { version: 1, resourceId: createStableLayerResourceId(stackId, 0), status: 'ready', filePath: '/managed/base.jpg', mimeType: 'image/jpeg', width: 512, height: 512, hasAlpha: false, byteLength: 100, sha256: 'base' },
      { version: 1, resourceId: createStableLayerResourceId(stackId, 1), status: 'ready', filePath: '/managed/title.png', mimeType: 'image/png', width: 100, height: 40, hasAlpha: true, byteLength: 50, sha256: 'title' },
      { version: 1, resourceId: `${stackId}:composite`, status: 'ready', filePath: '/managed/composite.png', mimeType: 'image/png', width: 512, height: 512, hasAlpha: true, byteLength: 120, sha256: 'composite' },
      { version: 1, resourceId: `${stackId}:thumbnail`, status: 'ready', filePath: '/managed/thumb.webp', mimeType: 'image/webp', width: 256, height: 256, hasAlpha: false, byteLength: 40, sha256: 'thumbnail' },
    ],
  };
}

function session(): CanvasSpecialEditorSession {
  const state = { layerStackDocument: document(), imageUrl: '/managed/composite.png', previewImageUrl: '/managed/thumb.webp' };
  return {
    sessionId: 'layer-editor-session',
    projectId: 'project-1',
    nodeId: 'layer-stack-node',
    editorKey: 'layers',
    initialState: state,
    draftState: state,
    isDirty: false,
    discardConfirmationRequested: false,
  };
}

describe('图层栈专用编辑器', () => {
  it('显隐草稿只在主进程重新合成成功后一次确认', async () => {
    const onDraftChange = vi.fn();
    const onConfirm = vi.fn();
    render(<LayerStackSpecialEditor session={session()} onDraftChange={onDraftChange} onConfirm={onConfirm} onCancel={vi.fn(() => 'closed')} onKeepEditing={vi.fn()} onDiscard={vi.fn()} />);

    fireEvent.click(screen.getAllByRole('button', { name: '隐藏图层' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '应用并合成' }));

    await waitFor(() => expect(recomposeLayerStackDocument).toHaveBeenCalledOnce());
    const submitted = recomposeLayerStackDocument.mock.calls[0][0];
    expect(submitted.layers.find((layer) => layer.role === 'content')?.visible).toBe(false);
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ layerStackDocument: submitted }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('取消不合成也不污染节点草稿', () => {
    const onDraftChange = vi.fn();
    const onCancel = vi.fn(() => 'closed' as const);
    render(<LayerStackSpecialEditor session={session()} onDraftChange={onDraftChange} onConfirm={vi.fn()} onCancel={onCancel} onKeepEditing={vi.fn()} onDiscard={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(recomposeLayerStackDocument).not.toHaveBeenCalled();
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('重新合成进行中关闭编辑器会通知主进程取消且忽略迟到结果', async () => {
    recomposeLayerStackDocument.mockImplementationOnce(() => new Promise(() => undefined));
    const onDraftChange = vi.fn();
    render(<LayerStackSpecialEditor session={session()} onDraftChange={onDraftChange} onConfirm={vi.fn()} onCancel={vi.fn(() => 'closed')} onKeepEditing={vi.fn()} onDiscard={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '应用并合成' }));
    await waitFor(() => expect(recomposeLayerStackDocument).toHaveBeenCalledOnce());
    const requestId = recomposeLayerStackDocument.mock.calls[0][2];
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(platformMocks.cancelLayerStackComposition).toHaveBeenCalledWith(requestId);
    expect(onDraftChange).not.toHaveBeenCalled();
  });
});
