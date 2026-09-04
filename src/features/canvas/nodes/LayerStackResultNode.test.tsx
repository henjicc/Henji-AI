/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayerStackResultNodeData } from '@/features/canvas/domain/canvasNodes'
import {
  createStableLayerId,
  createStableLayerResourceId,
  createStableLayerStackId,
  type LayerStackDocumentV1,
} from '@/features/canvas/domain/layerStack'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { LayerStackResultNode } from './LayerStackResultNode'

const nodeMocks = vi.hoisted(() => ({
  openMultiLayerDocumentNodeEditor: vi.fn(async () => ({ status: 'opened' })),
}))

vi.mock('@/features/canvas/application/multiLayerDocumentNodeEditorApplicationService', () => ({
  openMultiLayerDocumentNodeEditor: nodeMocks.openMultiLayerDocumentNodeEditor,
}))

const imageUrl = 'henji-media://multi-layer/composite.png'

function legacyDocument(): LayerStackDocumentV1 {
  const completionId = 'legacy-completion'
  const stackId = createStableLayerStackId(completionId)
  const layerResourceId = createStableLayerResourceId(stackId, 0)
  return {
    version: 1,
    stackId,
    status: 'ready',
    source: {
      capabilityId: 'image.layer-separation',
      sourceNodeId: 'source-node',
      inputResourceId: 'input-resource',
      providerId: 'volcengine',
      modelId: 'seedream-5-0-pro',
      completionId,
    },
    canvas: {
      width: 512,
      height: 512,
      colorSpace: 'srgb',
      alphaMode: 'straight',
      compositeOperation: 'source-over',
      clipPolicy: 'canvas-bounds',
    },
    compositeResourceId: `${stackId}:composite`,
    thumbnailResourceId: `${stackId}:thumbnail`,
    layers: [{
      version: 1,
      layerId: createStableLayerId(stackId, 0),
      sourceOutputIndex: 0,
      providerZIndex: 0,
      order: 0,
      role: 'base',
      name: '底图',
      resourceId: layerResourceId,
      placement: { x: 0, y: 0, width: 512, height: 512 },
      opacity: 1,
      visible: true,
      blendMode: 'normal',
      alpha: 'opaque',
    }],
    resources: [
      { version: 1, resourceId: layerResourceId, status: 'ready', filePath: '/legacy-base.jpg', mimeType: 'image/jpeg', width: 512, height: 512, hasAlpha: false, byteLength: 10, sha256: 'a' },
      { version: 1, resourceId: `${stackId}:composite`, status: 'ready', filePath: '/legacy-composite.png', mimeType: 'image/png', width: 512, height: 512, hasAlpha: true, byteLength: 10, sha256: 'b' },
      { version: 1, resourceId: `${stackId}:thumbnail`, status: 'ready', filePath: '/legacy-preview.webp', mimeType: 'image/webp', width: 256, height: 256, hasAlpha: false, byteLength: 10, sha256: 'c' },
    ],
  }
}

function data(overrides: Partial<LayerStackResultNodeData> = {}): LayerStackResultNodeData {
  return {
    resultKind: 'layer-stack',
    imageUrl,
    previewImageUrl: 'henji-media://multi-layer/preview.webp',
    aspectRatio: '2:1',
    imageEditSession: {
      kind: 'image-edit-v3',
      sourceUrl: imageUrl,
      documentRef: 'image-edit-v3:multi-layer-document',
      revision: 3,
      previewRef: null,
    },
    ...overrides,
  }
}

function renderNode(): ReturnType<typeof render> {
  return render(
    <ReactFlowProvider>
      <LayerStackResultNode
        id="multi-layer-node"
        type="layerStackResultNode"
        data={data()}
        selected={false}
        draggable
        selectable
        deletable
        dragging={false}
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />
    </ReactFlowProvider>,
  )
}

describe('LayerStackResultNode V3 编辑入口', () => {
  beforeEach(() => {
    useCanvasStore.setState({ selectedNodeId: null, edges: [] })
    useProjectStore.setState({ currentProjectId: 'project-a' })
    nodeMocks.openMultiLayerDocumentNodeEditor.mockClear()
  })

  afterEach(() => {
    cleanup()
    useProjectStore.setState({ currentProjectId: null, currentProject: null })
  })

  it('单击只选择节点，不打开编辑器', () => {
    renderNode()

    fireEvent.click(document.querySelector('[data-layer-stack-node-id="multi-layer-node"]') as Element)

    expect(useCanvasStore.getState().selectedNodeId).toBe('multi-layer-node')
    expect(nodeMocks.openMultiLayerDocumentNodeEditor).not.toHaveBeenCalled()
  })

  it('双击和明确编辑动作都打开完整图片编辑工具', () => {
    renderNode()
    const node = document.querySelector('[data-layer-stack-node-id="multi-layer-node"]') as Element

    fireEvent.doubleClick(node)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    expect(nodeMocks.openMultiLayerDocumentNodeEditor).toHaveBeenNthCalledWith(1, {
      projectRef: { kind: 'canvas.project', id: 'project-a' },
      nodeRef: { kind: 'canvas.node', id: 'project-a:multi-layer-node' },
    })
    expect(nodeMocks.openMultiLayerDocumentNodeEditor).toHaveBeenNthCalledWith(2, {
      projectRef: { kind: 'canvas.project', id: 'project-a' },
      nodeRef: { kind: 'canvas.node', id: 'project-a:multi-layer-node' },
    })
  })

  it('V1 迁移后的节点始终展示 V3 实时投影而不是旧缩略图', () => {
    render(
      <ReactFlowProvider>
        <LayerStackResultNode
          id="migrated-node"
          type="layerStackResultNode"
          data={data({ layerStackDocument: legacyDocument() })}
          selected={false}
          draggable
          selectable
          deletable
          dragging={false}
          zIndex={0}
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </ReactFlowProvider>,
    )

    const preview = screen.getByRole('img', { name: '多图层图片预览' })
    expect(preview.getAttribute('src')).toBe('henji-media://multi-layer/preview.webp')
    expect(preview.getAttribute('src')).not.toContain('legacy-preview')
  })
})
