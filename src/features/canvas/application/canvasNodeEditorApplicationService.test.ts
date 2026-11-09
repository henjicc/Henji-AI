// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCanvasStore } from '@/stores/canvasStore'

import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { closeCameraStageNodeEditorDialog, markCameraStageNodeEditorLoaded, openCameraStageNodeEditorDialog, useCameraStageNodeEditor } from './cameraStageNodeEditor'
import { openCanvasNodeEditor } from './canvasNodeEditorApplicationService'

vi.mock('./canvasApplicationService', async (importOriginal) => ({
  ...await importOriginal<typeof import('./canvasApplicationService')>(),
  openCanvasProject: vi.fn(async () => undefined),
  focusCanvasNode: vi.fn(async () => ({ focused: true })),
}))
vi.mock('@/features/navigation/application', () => ({ openApplicationSurface: vi.fn(() => ({ surfaceId: 'workspace.canvas' })) }))

const cameraNode = (id: string): CanvasNode => ({ id, type: CANVAS_NODE_TYPES.cameraStage, position: { x: 0, y: 0 }, data: { projectId: `stage-${id}` } } as CanvasNode)
const input = (nodeId: string) => ({
  canvasRef: { kind: 'canvas.document' as const, id: 'canvas-a' },
  nodeRef: { kind: 'canvas.node' as const, id: `canvas-a:${nodeId}` },
})

describe('打开画布节点编辑器', () => {
  beforeEach(() => {
    closeCameraStageNodeEditorDialog()
    useCanvasStore.setState({ nodes: [cameraNode('stage-1'), cameraNode('stage-2'), { id: 'text-1', type: CANVAS_NODE_TYPES.textAnnotation, position: { x: 0, y: 0 }, data: {} } as CanvasNode], activeToolDialog: null })
  })

  it('3D 节点打开同一个编辑器，等节点的镜头参考载入后才返回它的引用', async () => {
    const opening = openCanvasNodeEditor(input('stage-1'))
    await vi.waitFor(() => expect(useCameraStageNodeEditor.getState().nodeId).toBe('stage-1'))
    markCameraStageNodeEditorLoaded('stage-1', 'stage-stage-1')
    await expect(opening).resolves.toMatchObject({ editorKind: 'camera_stage', status: 'opened', cameraStageDocumentRef: { kind: 'camera_stage.document', id: 'stage-stage-1' } })
    await expect(openCanvasNodeEditor(input('stage-1'))).resolves.toMatchObject({ status: 'already_open' })
  })

  it('另一个节点的编辑器开着时拒绝，不替用户关掉', async () => {
    openCameraStageNodeEditorDialog('stage-2')
    await expect(openCanvasNodeEditor(input('stage-1'))).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(useCameraStageNodeEditor.getState().nodeId).toBe('stage-2')
  })

  it('开着的编辑器对应的节点已经不在画布里时不再挡住打开', async () => {
    openCameraStageNodeEditorDialog('deleted-node')
    const opening = openCanvasNodeEditor(input('stage-1'))
    await vi.waitFor(() => expect(useCameraStageNodeEditor.getState().nodeId).toBe('stage-1'))
    markCameraStageNodeEditorLoaded('stage-1', 'stage-stage-1')
    await expect(opening).resolves.toMatchObject({ status: 'opened' })
  })

  it('没有编辑器的节点被拒绝，并列出可打开的节点', async () => {
    await expect(openCanvasNodeEditor(input('text-1'))).rejects.toThrow(/canvas-a:stage-1、canvas-a:stage-2/)
  })
})
