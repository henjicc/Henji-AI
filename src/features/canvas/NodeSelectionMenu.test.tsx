// @vitest-environment jsdom

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CANVAS_NODE_TYPES } from './domain/canvasNodes'
import { nodeCatalog } from './application/nodeCatalog'
import { canvasNodeDefinitions } from './domain/nodeRegistry'
import { aggregateQuickConnectMenuDefinitions } from './hooks/useCanvasNodeMenu'
import {
  isParamConnectionCompatible,
  resolveCompatibleTargetHandleForSource,
} from './application/graphValueResolver'
import { mediaPortId } from './domain/socketTypes'
import {
  NodeSelectionMenu,
} from './NodeSelectionMenu'
import {
  getSortedNodeMenuDefinitions,
  getUploadAccept,
  resolveNodeMenuLayout,
} from './application/nodeMenuLayout'

describe('NodeSelectionMenu', () => {
  it('按分区与顺序组织菜单，并把上传聚合为单项', () => {
    const items = getSortedNodeMenuDefinitions(nodeCatalog.getMenuDefinitions())
    expect(items.map((item) => item.type)).toEqual([
      CANVAS_NODE_TYPES.universalUpload,
      CANVAS_NODE_TYPES.imageEdit,
      CANVAS_NODE_TYPES.videoGen,
      CANVAS_NODE_TYPES.audioGen,
      CANVAS_NODE_TYPES.storyboardGen,
      CANVAS_NODE_TYPES.textProcessing,
      CANVAS_NODE_TYPES.textAnnotation,
      CANVAS_NODE_TYPES.cameraStage,
      CANVAS_NODE_TYPES.imageModelSelector,
      CANVAS_NODE_TYPES.videoModelSelector,
      CANVAS_NODE_TYPES.audioModelSelector,
      CANVAS_NODE_TYPES.intSource,
      CANVAS_NODE_TYPES.floatSource,
      CANVAS_NODE_TYPES.stringSource,
      CANVAS_NODE_TYPES.booleanSource,
    ])
    expect(items.filter((item) => item.menuAggregationKey === 'upload')).toHaveLength(1)
  })

  it('为快捷上传限制兼容媒体类型，并在右下边缘向内翻转', () => {
    expect(getUploadAccept(['image', 'audio'])).toBe('image/*,audio/*')
    expect(resolveNodeMenuLayout({
      position: { x: 790, y: 590 },
      parentWidth: 800,
      parentHeight: 600,
      menuWidth: 284,
      menuHeight: 500,
    })).toMatchObject({
      left: 504,
      top: 88,
      transformOrigin: 'bottom right',
    })
  })

  it('连接快捷菜单把兼容的具体上传节点聚合为单一上传项', () => {
    expect(aggregateQuickConnectMenuDefinitions([
      canvasNodeDefinitions[CANVAS_NODE_TYPES.upload],
      canvasNodeDefinitions[CANVAS_NODE_TYPES.audioUpload],
      canvasNodeDefinitions[CANVAS_NODE_TYPES.textAnnotation],
    ])).toEqual({
      types: [CANVAS_NODE_TYPES.textAnnotation, CANVAS_NODE_TYPES.universalUpload],
      uploadKinds: ['image', 'audio'],
    })
  })

  it('空上传节点用单一万能端口连接三类媒体输入，锁定后拒绝其他类型', () => {
    const sourceNode = {
      id: 'upload-placeholder',
      type: CANVAS_NODE_TYPES.universalUpload,
      position: { x: 0, y: 0 },
      data: canvasNodeDefinitions[CANVAS_NODE_TYPES.universalUpload].createDefaultData(),
    }

    expect(resolveCompatibleTargetHandleForSource(
      sourceNode,
      CANVAS_NODE_TYPES.imageEdit,
      'source',
    )).toBe(mediaPortId('image'))
    const videoTargetNode = {
      id: 'video-target',
      type: CANVAS_NODE_TYPES.videoGen,
      position: { x: 0, y: 0 },
      data: canvasNodeDefinitions[CANVAS_NODE_TYPES.videoGen].createDefaultData(),
    }
    const audioTargetNode = {
      id: 'audio-target',
      type: CANVAS_NODE_TYPES.audioGen,
      position: { x: 0, y: 0 },
      data: canvasNodeDefinitions[CANVAS_NODE_TYPES.audioGen].createDefaultData(),
    }
    expect(isParamConnectionCompatible(
      sourceNode,
      videoTargetNode,
      mediaPortId('video'),
      'source',
    )).toBe(true)
    expect(isParamConnectionCompatible(
      sourceNode,
      audioTargetNode,
      mediaPortId('audio'),
      'source',
    )).toBe(true)

    sourceNode.data.lockedMediaKind = 'image'
    expect(isParamConnectionCompatible(
      sourceNode,
      videoTargetNode,
      mediaPortId('video'),
      'source',
    )).toBe(false)
  })

  it('打开后聚焦首项，支持方向键、Enter 与 Esc', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const { getByRole, getAllByRole, rerender } = render(
      <NodeSelectionMenu
        position={{ x: 20, y: 20 }}
        allowedTypes={[CANVAS_NODE_TYPES.intSource, CANVAS_NODE_TYPES.floatSource]}
        uploadKinds={[]}
        onSelect={onSelect}
        onClose={onClose}
      />
    )
    const menu = getByRole('menu')
    const items = getAllByRole('menuitem')
    await waitFor(() => expect(document.activeElement).toBe(items[0]))
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(menu, { key: 'Enter' })
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(CANVAS_NODE_TYPES.floatSource, undefined))

    rerender(
      <NodeSelectionMenu
        position={{ x: 20, y: 20 }}
        allowedTypes={[CANVAS_NODE_TYPES.intSource]}
        uploadKinds={[]}
        onSelect={onSelect}
        onClose={onClose}
      />
    )
    fireEvent.keyDown(getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('菜单打开时再次右键空白区域不会触发旧菜单关闭', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()

    try {
      const { rerender } = render(
        <NodeSelectionMenu
          position={{ x: 20, y: 20 }}
          uploadKinds={[]}
          onSelect={vi.fn()}
          onClose={onClose}
        />
      )

      fireEvent.mouseDown(document.body, { button: 2 })
      rerender(
        <NodeSelectionMenu
          position={{ x: 320, y: 240 }}
          uploadKinds={[]}
          onSelect={vi.fn()}
          onClose={onClose}
        />
      )
      act(() => vi.runAllTimers())

      expect(onClose).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
