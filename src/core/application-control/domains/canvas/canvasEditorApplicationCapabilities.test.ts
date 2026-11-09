import { describe, expect, it } from 'vitest'

import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../builtinApplicationCapabilityRegistry'
import {
  CANVAS_EDITOR_APPLICATION_CAPABILITIES,
  OPEN_CANVAS_NODE_EDITOR_CAPABILITY_ID,
} from './canvasEditorApplicationCapabilities'

const capability = CANVAS_EDITOR_APPLICATION_CAPABILITIES.find(
  (item) => item.id === OPEN_CANVAS_NODE_EDITOR_CAPABILITY_ID,
)

const input = {
  canvasRef: { kind: 'canvas.document', id: 'project-a' },
  nodeRef: { kind: 'canvas.node', id: 'project-a:document-node' },
}

describe('open_canvas_node_editor contract', () => {
  it('只接受严格的画布和节点稳定引用', () => {
    expect(capability).toBeTruthy()
    const registered = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(
      OPEN_CANVAS_NODE_EDITOR_CAPABILITY_ID,
    )
    expect(registered).toMatchObject(capability!)
    expect(registered?.inputSchema).toBe(capability?.inputSchema)
    expect(registered?.outputSchema).toBe(capability?.outputSchema)
    expect(capability?.inputSchema.safeParse(input).success).toBe(true)
    expect(capability?.inputSchema.safeParse({
      ...input,
      nodeRef: { kind: 'generation.result', id: 'result-a' },
    }).success).toBe(false)
    expect(capability?.inputSchema.safeParse({ ...input, nodeId: 'raw-node' }).success).toBe(false)
    expect(capability?.inputSchema.safeParse({
      ...input,
      canvasRef: { ...input.canvasRef, internal: true },
    }).success).toBe(false)
    expect(capability?.aiInputSchema.additionalProperties).toBe(false)
  })

  it('声明 R0 导航、稳定引用和画布内节点编辑器成功证据', () => {
    expect(capability).toMatchObject({
      version: 1,
      domain: 'canvas',
      idempotent: true,
      supportsUndo: false,
      requiredScopes: expect.arrayContaining(['navigation', 'canvas']),
      acceptsRefs: ['canvas.document', 'canvas.node'],
      producesRefs: ['canvas.document', 'canvas.node', 'application.surface', 'camera_stage.document'],
    })
    expect(capability?.control.impacts).toEqual([
      expect.objectContaining({
        effect: 'navigate',
        entityTypes: ['canvas.document', 'canvas.node', 'application.surface'],
        verificationRequired: false,
      }),
    ])
    expect(capability?.successEvidence.join(' ')).toContain('节点自己的编辑器')
    expect(capability?.failureRecovery.join(' ')).toContain('不要改用 open_image_editor_with_source')
  })

  it('输出只接受 workspace.canvas 里的节点编辑器结果，3D 节点带镜头参考引用', () => {
    const cameraStageDocumentRef = { kind: 'camera_stage.document', id: 'stage-a' }
    expect(capability?.outputSchema.safeParse({
      ...input,
      surfaceId: 'workspace.canvas',
      editorKind: 'camera_stage',
      status: 'opened',
      verification: { verified: true, condition: '已打开' },
      cameraStageDocumentRef,
      resultRefs: [input.canvasRef, input.nodeRef, { kind: 'application.surface', id: 'workspace.canvas' }, cameraStageDocumentRef],
      revision: 1,
      scopeRevisions: {},
    }).success).toBe(true)
    expect(capability?.outputSchema.safeParse({
      ...input,
      surfaceId: 'workspace.canvas',
      editorKind: 'multi_layer_document',
      status: 'opened',
      verification: { verified: true, condition: '已打开' },
      resultRefs: [
        input.canvasRef,
        input.nodeRef,
        { kind: 'application.surface', id: 'workspace.canvas' },
      ],
      revision: 1,
      scopeRevisions: { navigation: 2, canvas: 3 },
    }).success).toBe(true)
    expect(capability?.outputSchema.safeParse({
      ...input,
      surfaceId: 'tool.image_edit',
      editorKind: 'multi_layer_document',
      status: 'opened',
      verification: { verified: true, condition: '已打开' },
      resultRefs: [],
      revision: 1,
      scopeRevisions: {},
    }).success).toBe(false)
  })
})
