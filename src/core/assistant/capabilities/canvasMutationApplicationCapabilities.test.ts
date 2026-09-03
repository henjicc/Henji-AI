import { describe, expect, it } from 'vitest'

import { CANVAS_MUTATION_APPLICATION_CAPABILITIES } from './canvasMutationApplicationCapabilities'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../builtinApplicationCapabilityRegistry'

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

describe('export_image_edit_target_to_canvas contract', () => {
  const exportCapability = CANVAS_MUTATION_APPLICATION_CAPABILITIES.find(
    (item) => item.id === 'export_image_edit_target_to_canvas',
  )
  const input = {
    projectRef: { kind: 'canvas.project', id: 'project-1' },
    sourceNodeRef: { kind: 'canvas.node', id: 'document-node' },
    targetRef: { kind: 'image_edit.layer', id: 'v3:document:raster' },
  }

  it('只接受稳定 ApplicationRef，顶层与嵌套对象均拒绝附加字段', () => {
    expect(exportCapability).toBeTruthy()
    expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('export_image_edit_target_to_canvas')).toBe(exportCapability)
    expect(exportCapability?.inputSchema.safeParse(input).success).toBe(true)
    expect(exportCapability?.inputSchema.safeParse({ ...input, sourceNodeId: 'raw-id' }).success).toBe(false)
    expect(exportCapability?.inputSchema.safeParse({
      ...input, targetRef: { ...input.targetRef, kind: 'image_edit.effect' },
    }).success).toBe(false)
    expect(exportCapability?.inputSchema.safeParse({
      ...input, sourceNodeRef: { ...input.sourceNodeRef, internal: true },
    }).success).toBe(false)
    expect(exportCapability?.aiInputSchema.additionalProperties).toBe(false)
  })

  it('声明权限、非幂等重复语义、并发键、撤销与双 create Effect', () => {
    expect(exportCapability).toMatchObject({
      domain: 'image_edit', permission: 'canvas:write', risk: 'R1', version: 1,
      idempotent: false, parallelSafe: false, supportsUndo: true,
      acceptsRefs: expect.arrayContaining(['canvas.project', 'canvas.node', 'image_edit.layer']),
      producesRefs: ['canvas.node', 'canvas.edge'],
    })
    expect(exportCapability?.resolveConcurrencyKey?.(input)).toContain('document-node')
    expect(exportCapability?.control.impacts).toEqual([
      expect.objectContaining({ effect: 'create', entityTypes: ['canvas.node'] }),
      expect.objectContaining({ effect: 'create', entityTypes: ['canvas.edge'] }),
    ])

    const output = {
      ...input,
      nodeRef: { kind: 'canvas.node', id: 'export-node' },
      edgeRef: { kind: 'canvas.edge', id: 'export-edge' },
      undoRef: 'undo-export', width: 400, height: 300, mediaType: 'image/png',
      revision: 1, scopeRevisions: { canvas: 2, image_edit: 1 },
    }
    expect(exportCapability?.outputSchema.safeParse(output).success).toBe(true)
    expect(exportCapability?.createUndo?.(output)).toEqual({ kind: 'canvas_history', token: 'undo-export' })
    expect(exportCapability?.resolveObservedEffects?.(input, output)).toEqual([
      expect.objectContaining({ effect: 'create', targetRefs: [output.nodeRef] }),
      expect.objectContaining({ effect: 'create', targetRefs: [output.edgeRef] }),
    ])
  })
})
