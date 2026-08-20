import { beforeEach, describe, expect, it } from 'vitest'

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { mediaPortId } from '@/features/canvas/domain/socketTypes'
import { useCanvasStore } from './canvasStore'

describe('canvasStore resolveUploadPlaceholder', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      activeToolDialog: null,
      history: { past: [], future: [] },
      dragHistorySnapshot: null,
      activeHistoryGroup: null,
    })
  })

  it('保留节点身份和用户标题，清除测量尺寸，并可一次撤销回空上传节点', () => {
    const nodeId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.universalUpload,
      { x: 120, y: 80 },
      { displayName: '我的素材' },
    )
    useCanvasStore.setState((state) => ({
      nodes: state.nodes.map((node) => node.id === nodeId ? {
        ...node,
        selected: true,
        parentId: 'group-1',
        measured: { width: 240, height: 240 },
        width: 240,
        height: 240,
        style: { ...(node.style ?? {}), width: 240, height: 240 },
      } : node),
      selectedNodeId: nodeId,
    }))

    expect(useCanvasStore.getState().resolveUploadPlaceholder(nodeId, {
      type: CANVAS_NODE_TYPES.videoUpload,
      data: {
        videoUrl: 'C:/media/clip.mp4',
        previewImageUrl: 'C:/media/clip.jpg',
        aspectRatio: '16:9',
        sourceFileName: 'clip.mp4',
      },
    })).toBe(true)

    const resolved = useCanvasStore.getState().nodes.find((node) => node.id === nodeId)
    expect(resolved).toMatchObject({
      id: nodeId,
      type: CANVAS_NODE_TYPES.videoUpload,
      position: { x: 120, y: 80 },
      selected: true,
      parentId: 'group-1',
      data: {
        displayName: '我的素材',
        videoUrl: 'C:/media/clip.mp4',
        sourceFileName: 'clip.mp4',
      },
    })
    expect(resolved?.measured).toBeUndefined()
    expect(resolved?.width).toBeUndefined()
    expect(resolved?.height).toBeUndefined()
    expect(resolved?.style?.width).toBeUndefined()
    expect(resolved?.style?.height).toBeUndefined()

    expect(useCanvasStore.getState().undo()).toBe(true)
    expect(useCanvasStore.getState().nodes.find((node) => node.id === nodeId)).toMatchObject({
      id: nodeId,
      type: CANVAS_NODE_TYPES.universalUpload,
      data: { displayName: '我的素材' },
    })
  })

  it('只允许解析仍存在的统一上传占位节点', () => {
    expect(useCanvasStore.getState().resolveUploadPlaceholder('missing', {
      type: CANVAS_NODE_TYPES.upload,
      data: { imageUrl: 'C:/media/image.png' },
    })).toBe(false)
  })

  it('首次类型化连线锁定媒体类型，且撤销同时移除连线并恢复未锁定', () => {
    const uploadId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.universalUpload,
      { x: 20, y: 20 },
    )
    const imageTargetId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.imageEdit,
      { x: 360, y: 20 },
    )
    useCanvasStore.setState({ history: { past: [], future: [] } })

    useCanvasStore.getState().onConnect({
      source: uploadId,
      target: imageTargetId,
      sourceHandle: 'source',
      targetHandle: mediaPortId('image'),
    })

    expect(useCanvasStore.getState().nodes.find((node) => node.id === uploadId)?.data)
      .toMatchObject({ lockedMediaKind: 'image' })
    expect(useCanvasStore.getState().edges).toContainEqual(expect.objectContaining({
      source: uploadId,
      target: imageTargetId,
      sourceHandle: 'source',
      targetHandle: mediaPortId('image'),
    }))

    expect(useCanvasStore.getState().undo()).toBe(true)
    expect(useCanvasStore.getState().edges).toHaveLength(0)
    expect(useCanvasStore.getState().nodes.find((node) => node.id === uploadId)?.data)
      .toMatchObject({ lockedMediaKind: null })
  })

  it('锁定后拒绝其他媒体端口，并在转换为具体节点时迁移既有连线', () => {
    const uploadId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.universalUpload,
      { x: 20, y: 20 },
      { lockedMediaKind: 'image' },
    )
    const imageTargetId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.imageEdit,
      { x: 360, y: 20 },
    )
    const videoTargetId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.videoGen,
      { x: 360, y: 280 },
    )
    useCanvasStore.setState({ history: { past: [], future: [] } })

    useCanvasStore.getState().onConnect({
      source: uploadId,
      target: imageTargetId,
      sourceHandle: 'source',
      targetHandle: mediaPortId('image'),
    })
    useCanvasStore.getState().onConnect({
      source: uploadId,
      target: videoTargetId,
      sourceHandle: 'source',
      targetHandle: mediaPortId('video'),
    })
    expect(useCanvasStore.getState().edges).toHaveLength(1)

    expect(useCanvasStore.getState().resolveUploadPlaceholder(uploadId, {
      type: CANVAS_NODE_TYPES.videoUpload,
      data: { videoUrl: 'C:/media/wrong.mp4' },
    })).toBe(false)
    expect(useCanvasStore.getState().resolveUploadPlaceholder(uploadId, {
      type: CANVAS_NODE_TYPES.upload,
      data: { imageUrl: 'C:/media/image.png', aspectRatio: '1:1' },
    })).toBe(true)

    expect(useCanvasStore.getState().nodes.find((node) => node.id === uploadId)?.type)
      .toBe(CANVAS_NODE_TYPES.upload)
    expect(useCanvasStore.getState().edges).toContainEqual(expect.objectContaining({
      source: uploadId,
      sourceHandle: 'source',
      target: imageTargetId,
      targetHandle: mediaPortId('image'),
    }))
  })
})
