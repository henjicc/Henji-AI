/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactFlowInstance } from '@xyflow/react'
import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes'
import { useCanvasAssetDrop } from './useCanvasAssetDrop'

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  readAssetDragPayload: vi.fn(() => null),
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})
vi.mock('@/features/assets/drag/assetDragPayload', () => ({
  readAssetDragPayload: mocks.readAssetDragPayload,
}))
vi.mock('../application/canvasServices', () => ({
  canvasEventBus: { publish: mocks.publish },
}))

describe('useCanvasAssetDrop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('从文件管理器拖入多种媒体时创建对应上传节点并分发文件', () => {
    const addNode = vi.fn()
      .mockReturnValueOnce('image-node')
      .mockReturnValueOnce('video-node')
      .mockReturnValueOnce('audio-node')
    const schedulePersist = vi.fn()
    const reactFlowInstance = {
      screenToFlowPosition: vi.fn(() => ({ x: 100, y: 200 })),
    } as unknown as ReactFlowInstance<CanvasNode, CanvasEdge>
    const { result } = renderHook(() => useCanvasAssetDrop({
      reactFlowInstance,
      addNode,
      schedulePersist,
    }))
    const target = document.createElement('div')
    document.body.append(target)
    const files = [
      new File([], 'a.png', { type: 'image/png' }),
      new File([], 'b.mp4', { type: 'video/mp4' }),
      new File([], 'c.mp3', { type: 'audio/mpeg' }),
    ]
    const preventDefault = vi.fn()

    act(() => {
      result.current.onDrop({
        clientX: 20,
        clientY: 30,
        target,
        preventDefault,
        dataTransfer: { types: ['Files'], files },
      } as unknown as React.DragEvent)
      vi.runAllTimers()
    })

    expect(preventDefault).toHaveBeenCalled()
    expect(addNode.mock.calls.map((call) => call[0])).toEqual([
      'uploadNode',
      'videoUploadNode',
      'audioUploadNode',
    ])
    expect(schedulePersist).toHaveBeenCalledWith(0)
    expect(mocks.publish).toHaveBeenCalledWith('canvas/import-media', {
      nodeId: 'video-node',
      file: files[1],
    })
  })

  it('文件落在节点上传区时交给节点处理，不额外创建画布节点', () => {
    const addNode = vi.fn()
    const nodeElement = document.createElement('div')
    nodeElement.className = 'react-flow__node'
    const target = document.createElement('div')
    nodeElement.append(target)
    document.body.append(nodeElement)
    const { result } = renderHook(() => useCanvasAssetDrop({
      reactFlowInstance: { screenToFlowPosition: vi.fn() } as unknown as ReactFlowInstance<CanvasNode, CanvasEdge>,
      addNode,
      schedulePersist: vi.fn(),
    }))

    act(() => result.current.onDrop({
      target,
      preventDefault: vi.fn(),
      dataTransfer: { types: ['Files'], files: [new File([], 'a.png', { type: 'image/png' })] },
    } as unknown as React.DragEvent))

    expect(addNode).not.toHaveBeenCalled()
  })
})
