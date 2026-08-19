// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApplicationExecutionContext, ApplicationPlannedStep } from '@/core/application-control'
import { CANVAS_NODE_TYPES, type StoryboardFrameItem } from '@/features/canvas/domain/canvasNodes'
import { useCanvasStore, type CanvasNode } from '@/stores/canvasStore'
import { useProjectStore, type Project } from '@/stores/projectStore'

import { CanvasNodeMutationExecutor } from './canvasMutationExecutor'
import { CanvasProjectMutationExecutor } from './canvasProjectMutationExecutor'
import { CANVAS_ENTITY_TYPES, createCanvasReflectionRegistrations } from './canvasReflection'
import * as canvasMutationService from './canvasMutationService'

// 双路径清单 DP-08：通用节点属性写入必须委托画布领域服务。

const projectId = 'canvas-reflection-project'
const nodeId = 'node-1'
const context: ApplicationExecutionContext = {
  requestId: 'canvas-reflection-test',
  exposure: 'assistant',
  permissions: new Set(['canvas:read', 'canvas:write']),
  acceptedDataClasses: new Set(['C0', 'C1']),
}

function node(): CanvasNode {
  return {
    id: nodeId,
    type: CANVAS_NODE_TYPES.textAnnotation,
    position: { x: 100, y: 200 },
    data: { displayName: '原节点', content: '内容' },
  }
}

function project(canvasNode: CanvasNode): Project {
  return {
    id: projectId,
    name: '反射测试项目',
    createdAt: 1,
    updatedAt: 2,
    nodeCount: 1,
    coverPath: null,
    nodes: [canvasNode],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  }
}

describe('canvas reflection and mutation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    const canvasNode = node()
    const currentProject = project(canvasNode)
    useCanvasStore.getState().setCanvasData([canvasNode], [], { past: [], future: [] })
    useProjectStore.setState({
      projects: [currentProject],
      currentProjectId: projectId,
      currentProject,
      isHydrated: true,
      isOpeningProject: false,
      saveCurrentProject: vi.fn(),
    })
  })

  /*
   * 专用能力（add_canvas_node 等）返回的是裸 nodeId，通用动词要的是 `工程ID:节点ID`。
   * 同一样东西两种形状，拿着能力返回的 id 去调通用动词就必然 NOT_FOUND——实测画布场景反复
   * 撞这一条。规则本来就写着"领域 provider 可将全局唯一的短引用补全成正式稳定引用"。
   */
  it('裸子实体 id 在当前工程内被补全成正式稳定引用', async () => {
    const registrations = createCanvasReflectionRegistrations()
    const nodeProvider = registrations
      .find((item) => item.entity.id === CANVAS_ENTITY_TYPES.node)?.provider
    expect(nodeProvider).toBeDefined()

    const snapshot = await nodeProvider?.readEntity(
      { kind: CANVAS_ENTITY_TYPES.node, id: nodeId },
      { propertyIds: [`${CANVAS_ENTITY_TYPES.node}.node_type`] }
    )
    expect(snapshot?.properties).toMatchObject({
      [`${CANVAS_ENTITY_TYPES.node}.node_type`]: CANVAS_NODE_TYPES.textAnnotation,
    })
  })

  it('当前工程里没有这个子 id 时照旧拒绝', async () => {
    const registrations = createCanvasReflectionRegistrations()
    const nodeProvider = registrations
      .find((item) => item.entity.id === CANVAS_ENTITY_TYPES.node)?.provider
    await expect(nodeProvider?.readEntity(
      { kind: CANVAS_ENTITY_TYPES.node, id: 'never-existed' },
      { propertyIds: [] }
    )).rejects.toThrow('NOT_FOUND')
  })


  it('提供项目、节点和连线稳定实体及受限节点属性', async () => {
    const registrations = createCanvasReflectionRegistrations()
    expect(registrations.map((item) => item.entity.id)).toEqual([
      CANVAS_ENTITY_TYPES.project,
      CANVAS_ENTITY_TYPES.node,
      CANVAS_ENTITY_TYPES.edge,
    ])
    const nodeRegistration = registrations.find((item) => item.entity.id === CANVAS_ENTITY_TYPES.node)
    if (!nodeRegistration?.provider) throw new Error('CANVAS_NODE_PROVIDER_MISSING')
    const snapshot = await nodeRegistration.provider.readEntity(
      { kind: CANVAS_ENTITY_TYPES.node, id: `${projectId}:${nodeId}` },
      {}
    )
    expect(snapshot?.properties).toMatchObject({
      'canvas.node.node_type': CANVAS_NODE_TYPES.textAnnotation,
      'canvas.node.display_name': '原节点',
      'canvas.node.position': { x: 100, y: 200 },
    })
    expect(nodeRegistration?.properties.map((item) => item.id)).toEqual([
      'canvas.node.project_ref',
      'canvas.node.node_type',
      'canvas.node.display_name',
      'canvas.node.position',
      'canvas.node.storyboard_frames',
    ])
    const projectRegistration = registrations.find((item) => item.entity.id === CANVAS_ENTITY_TYPES.project)
    expect(projectRegistration?.properties.find((item) => item.id === 'canvas.project.name')).toMatchObject({
      requiredPermissions: { write: ['canvas:write'] },
    })
    expect(projectRegistration?.properties.find((item) => item.id === 'canvas.project.name')?.readOnlyReason)
      .toBeUndefined()
  })

  it('通过通用工程属性执行器改名并撤销包含冒号的旧名称', async () => {
    const oldProject = project(node())
    oldProject.name = '旧:项目名'
    useProjectStore.setState({
      projects: [oldProject],
      currentProject: oldProject,
      renameProject: (id, name) => useProjectStore.setState((state) => ({
        projects: state.projects.map((item) => item.id === id ? { ...item, name } : item),
        currentProject: state.currentProject?.id === id ? { ...state.currentProject, name } : state.currentProject,
      })),
    })
    const executor = new CanvasProjectMutationExecutor()
    const result = await executor.apply({
      kind: 'mutation',
      target: { kind: CANVAS_ENTITY_TYPES.project, id: projectId },
      entityType: CANVAS_ENTITY_TYPES.project,
      expectedRevisions: { canvas: 2 },
      mutations: [{ propertyId: 'canvas.project.name', operation: 'set', value: '新项目名' }],
    })
    expect(useProjectStore.getState().projects.find((item) => item.id === projectId)?.name).toBe('新项目名')

    await executor.undo(String(result.undoToken))
    expect(useProjectStore.getState().projects.find((item) => item.id === projectId)?.name).toBe('旧:项目名')
  })

  it('原子更新节点标题与位置并可整体撤销', async () => {
    const serviceSpy = vi.spyOn(canvasMutationService, 'applyCanvasNodePropertyPatches')
    const executor = new CanvasNodeMutationExecutor()
    const step: Extract<ApplicationPlannedStep, { kind: 'mutation' }> = {
      kind: 'mutation',
      target: { kind: CANVAS_ENTITY_TYPES.node, id: `${projectId}:${nodeId}` },
      entityType: CANVAS_ENTITY_TYPES.node,
      expectedRevisions: { canvas: 2 },
      mutations: [
        { propertyId: 'canvas.node.display_name', operation: 'set', value: '新标题' },
        { propertyId: 'canvas.node.position', operation: 'set', value: { x: 320, y: 480 } },
      ],
    }
    const [result] = await executor.applyAtomic([step], context)
    expect(serviceSpy).toHaveBeenCalledWith(projectId, [{
      nodeId,
      displayName: '新标题',
      position: { x: 320, y: 480 },
    }])
    expect(useCanvasStore.getState().nodes[0]).toMatchObject({
      position: { x: 320, y: 480 },
      data: { displayName: '新标题' },
    })
    expect(result.undoToken).toBeTruthy()

    await executor.undo(String(result.undoToken), context)
    expect(useCanvasStore.getState().nodes[0]).toMatchObject({
      position: { x: 100, y: 200 },
      data: { displayName: '原节点' },
    })
  })

  it('分镜格子按 id 定点更新 note 与 order，并可整体撤销', async () => {
    const storyboardNodeId = 'node-storyboard'
    const frames: StoryboardFrameItem[] = [
      { id: 'frame-1', imageUrl: null, note: '第一格', order: 0 },
      { id: 'frame-2', imageUrl: null, note: '第二格', order: 1 },
    ]
    const storyboardNode: CanvasNode = {
      id: storyboardNodeId,
      type: CANVAS_NODE_TYPES.storyboardSplit,
      position: { x: 0, y: 0 },
      data: { displayName: '分镜', aspectRatio: '16:9', gridRows: 1, gridCols: 2, frames },
    }
    // 走 setCanvasData（而不是裸 setState）：undo 落回的也是 setCanvasData，两边的归一化要一致，
    // 否则"撤销后与原值相等"这条断言会被归一化补的默认字段（如 aspectRatio）误判成不相等。
    const before = useCanvasStore.getState()
    before.setCanvasData([...before.nodes, storyboardNode], before.edges, before.history)
    const baselineFrames = useCanvasStore.getState().nodes.find((item) => item.id === storyboardNodeId)?.data.frames
    const executor = new CanvasNodeMutationExecutor()
    const step: Extract<ApplicationPlannedStep, { kind: 'mutation' }> = {
      kind: 'mutation',
      target: { kind: CANVAS_ENTITY_TYPES.node, id: `${projectId}:${storyboardNodeId}` },
      entityType: CANVAS_ENTITY_TYPES.node,
      expectedRevisions: { canvas: 2 },
      mutations: [{
        propertyId: 'canvas.node.storyboard_frames',
        operation: 'set',
        value: [
          { id: 'frame-1', note: '改过的第一格' },
          { id: 'frame-2', order: 0 },
        ],
      }],
    }

    const [result] = await executor.applyAtomic([step], context)

    const updatedNode = useCanvasStore.getState().nodes.find((item) => item.id === storyboardNodeId)
    expect(updatedNode?.data.frames).toMatchObject([
      { id: 'frame-1', note: '改过的第一格', order: 0 },
      { id: 'frame-2', note: '第二格', order: 0 },
    ])

    await executor.undo(String(result.undoToken), context)
    const restoredNode = useCanvasStore.getState().nodes.find((item) => item.id === storyboardNodeId)
    expect(restoredNode?.data.frames).toEqual(baselineFrames)
  })

  it('分镜格子 id 不存在时整批拒绝，不改动任何格子', async () => {
    const storyboardNodeId = 'node-storyboard-2'
    const frames: StoryboardFrameItem[] = [{ id: 'frame-1', imageUrl: null, note: '唯一的格子', order: 0 }]
    const storyboardNode: CanvasNode = {
      id: storyboardNodeId,
      type: CANVAS_NODE_TYPES.storyboardSplit,
      position: { x: 0, y: 0 },
      data: { displayName: '分镜', aspectRatio: '16:9', gridRows: 1, gridCols: 1, frames },
    }
    useCanvasStore.setState((state) => ({ nodes: [...state.nodes, storyboardNode] }))
    const executor = new CanvasNodeMutationExecutor()
    const step: Extract<ApplicationPlannedStep, { kind: 'mutation' }> = {
      kind: 'mutation',
      target: { kind: CANVAS_ENTITY_TYPES.node, id: `${projectId}:${storyboardNodeId}` },
      entityType: CANVAS_ENTITY_TYPES.node,
      expectedRevisions: { canvas: 2 },
      mutations: [{ propertyId: 'canvas.node.storyboard_frames', operation: 'set', value: [{ id: '不存在的格子', note: '改不到' }] }],
    }

    await expect(executor.applyAtomic([step], context)).rejects.toThrow('以下分镜格子 id 不存在')
    const untouchedNode = useCanvasStore.getState().nodes.find((item) => item.id === storyboardNodeId)
    expect(untouchedNode?.data.frames).toMatchObject(frames)
  })

  it('对非分镜节点写 storyboard_frames 被拒绝', async () => {
    const executor = new CanvasNodeMutationExecutor()
    const step: Extract<ApplicationPlannedStep, { kind: 'mutation' }> = {
      kind: 'mutation',
      target: { kind: CANVAS_ENTITY_TYPES.node, id: `${projectId}:${nodeId}` },
      entityType: CANVAS_ENTITY_TYPES.node,
      expectedRevisions: { canvas: 2 },
      mutations: [{ propertyId: 'canvas.node.storyboard_frames', operation: 'set', value: [{ id: 'frame-1' }] }],
    }

    await expect(executor.applyAtomic([step], context)).rejects.toThrow('目标节点不是分镜格子节点')
  })

  it('非法属性使整组变更回滚', async () => {
    const executor = new CanvasNodeMutationExecutor()
    const step: Extract<ApplicationPlannedStep, { kind: 'mutation' }> = {
      kind: 'mutation',
      target: { kind: CANVAS_ENTITY_TYPES.node, id: `${projectId}:${nodeId}` },
      entityType: CANVAS_ENTITY_TYPES.node,
      expectedRevisions: { canvas: 2 },
      mutations: [
        { propertyId: 'canvas.node.display_name', operation: 'set', value: '不应保留' },
        { propertyId: 'canvas.node.internal_data', operation: 'set', value: 'forbidden' },
      ],
    }
    // 统一错误码带出属性 id 与可写清单，模型据此能自己改对，而不是只知道"失败了"。
    await expect(executor.applyAtomic([step], context)).rejects.toThrow('PROPERTY_NOT_WRITABLE:canvas.node.internal_data')
    expect(useCanvasStore.getState().nodes[0].data.displayName).toBe('原节点')
  })
})
