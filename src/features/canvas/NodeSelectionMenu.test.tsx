// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  NODE_MENU_SECTION_ORDER,
} from './application/nodeMenuLayout'

describe('NodeSelectionMenu', () => {
  afterEach(() => cleanup())

  it('按分区与顺序组织菜单，并把上传聚合为单项', () => {
    const items = getSortedNodeMenuDefinitions(nodeCatalog.getMenuDefinitions())
    const sortKeys = items.map((item) => [
      NODE_MENU_SECTION_ORDER.indexOf(item.menuSection ?? 'extensions'),
      item.menuOrder ?? Number.MAX_SAFE_INTEGER,
    ] as const)
    for (let index = 1; index < sortKeys.length; index += 1) {
      const [previousSection, previousOrder] = sortKeys[index - 1]
      const [section, order] = sortKeys[index]
      expect(section > previousSection || (section === previousSection && order >= previousOrder)).toBe(true)
    }
    expect(items.filter((item) => item.menuAggregationKey === 'upload')).toHaveLength(1)
  })

  it('为快捷上传限制兼容媒体类型', () => {
    expect(getUploadAccept(['image', 'audio'])).toBe('image/*,audio/*')
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

  it('挂在共享浮层上：登记浮层归属，点外收起后回调关闭且不选择', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const { getAllByRole } = render(
      <NodeSelectionMenu
        position={{ x: 20, y: 20 }}
        allowedTypes={[CANVAS_NODE_TYPES.intSource]}
        uploadKinds={[]}
        onSelect={onSelect}
        onClose={onClose}
      />
    )
    const menu = getAllByRole('menu').at(-1)
    expect(menu?.closest('[data-ui-overlay-id]')).not.toBeNull()
    fireEvent.mouseDown(document.body, { button: 0 })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSelect).not.toHaveBeenCalled()
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
