// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApplicationExecutionContext, ApplicationPlannedStep } from '@/core/application-control'
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
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
    await expect(executor.applyAtomic([step], context)).rejects.toThrow('PROPERTY_NOT_FOUND')
    expect(useCanvasStore.getState().nodes[0].data.displayName).toBe('原节点')
  })
})
