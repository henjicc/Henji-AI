import { describe, expect, it } from 'vitest'

import { CANVAS_MUTATION_APPLICATION_CAPABILITIES } from './canvasMutationApplicationCapabilities'

const capability = CANVAS_MUTATION_APPLICATION_CAPABILITIES.find(
  (item) => item.id === 'apply_canvas_image_capability',
)

describe('apply_canvas_image_capability contract', () => {
  it('只接受后台可创建节点的图片能力，不接受本地弹窗工具', () => {
    expect(capability).toBeTruthy()
    expect(capability?.inputSchema.safeParse({
      projectId: 'project-1', sourceNodeId: 'source-1', capabilityId: 'image.background-removal',
    }).success).toBe(true)
    expect(capability?.inputSchema.safeParse({
      projectId: 'project-1', sourceNodeId: 'source-1', capabilityId: 'image.grid-split',
    }).success).toBe(false)
  })

  it('如实声明节点、连线和选中态三项副作用', () => {
    expect(capability?.control?.impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ effect: 'create', entityTypes: ['canvas.node'] }),
      expect.objectContaining({ effect: 'create', entityTypes: ['canvas.edge'] }),
      expect.objectContaining({
        effect: 'update',
        entityTypes: ['canvas.project'],
        propertyIds: ['canvas.project.selected_node'],
      }),
    ]))

    const effects = capability?.resolveObservedEffects?.({
      projectId: 'project-1', sourceNodeId: 'source-1', capabilityId: 'image.background-removal',
    }, {
      projectId: 'project-1', kind: 'canvas-node', sourceNodeId: 'source-1',
      capabilityId: 'image.background-removal', nodeId: 'node-1', edgeId: 'edge-1', undoRef: 'undo-1',
    }) ?? []
    expect(effects).toHaveLength(3)
    expect(effects[2]).toMatchObject({
      effect: 'update',
      targetRefs: [{ kind: 'canvas.project', id: 'project-1' }],
      evidence: ['selected-node:node-1'],
    })
  })
})
