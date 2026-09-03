import { afterEach, describe, expect, it } from 'vitest'

import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import {
  collectMultiLayerDocumentLiveReferences,
  resetMultiLayerDocumentLifecycleForTests,
  retainMultiLayerDocumentReferences,
} from './multiLayerDocumentLifecycleService'

function documentNode(id: string, documentId: string): CanvasNode {
  const sourceUrl = `/managed/${documentId}.png`
  return {
    id,
    type: CANVAS_NODE_TYPES.layerStackResult,
    position: { x: 0, y: 0 },
    data: {
      resultKind: 'layer-stack',
      imageUrl: sourceUrl,
      previewImageUrl: sourceUrl,
      aspectRatio: '1:1',
      imageEditSession: {
        kind: 'image-edit-v3',
        sourceUrl,
        documentRef: `image-edit-v3:${documentId}`,
        revision: 1,
        previewRef: `sha256:${'a'.repeat(64)}`,
      },
    },
  } as CanvasNode
}

afterEach(() => resetMultiLayerDocumentLifecycleForTests())

describe('多图层文档引用感知生命周期', () => {
  it('枚举当前、撤销、重做、拖拽快照与打开会话引用', () => {
    const current = documentNode('current', 'current-document')
    const past = documentNode('past', 'past-document')
    const future = documentNode('future', 'future-document')
    const drag = documentNode('drag', 'drag-document')
    const refs = collectMultiLayerDocumentLiveReferences({
      nodes: [current],
      history: {
        past: [{ nodes: [past], edges: [] }],
        future: [{ nodes: [future], edges: [] }],
      },
      dragHistorySnapshot: { nodes: [drag], edges: [] },
      activeToolDialog: { nodeId: current.id, toolType: 'edit' },
    })
    expect(refs).toEqual(new Set([
      'image-edit-v3:current-document',
      'image-edit-v3:past-document',
      'image-edit-v3:future-document',
      'image-edit-v3:drag-document',
    ]))
  })

  it('显式项目包或编辑会话 lease 在释放前保持文档存活', () => {
    const release = retainMultiLayerDocumentReferences(['image-edit-v3:leased-document'])
    const emptyState = {
      nodes: [],
      history: { past: [], future: [] },
      dragHistorySnapshot: null,
      activeToolDialog: null,
    }
    expect(collectMultiLayerDocumentLiveReferences(emptyState))
      .toContain('image-edit-v3:leased-document')
    release()
    expect(collectMultiLayerDocumentLiveReferences(emptyState))
      .not.toContain('image-edit-v3:leased-document')
  })
})
