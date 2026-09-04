import { describe, expect, it } from 'vitest'

import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../builtinApplicationCapabilityRegistry'
import {
  CANVAS_EDITOR_APPLICATION_CAPABILITIES,
  OPEN_MULTI_LAYER_DOCUMENT_NODE_EDITOR_CAPABILITY_ID,
} from './canvasEditorApplicationCapabilities'

const capability = CANVAS_EDITOR_APPLICATION_CAPABILITIES.find(
  (item) => item.id === OPEN_MULTI_LAYER_DOCUMENT_NODE_EDITOR_CAPABILITY_ID,
)

const input = {
  projectRef: { kind: 'canvas.project', id: 'project-a' },
  nodeRef: { kind: 'canvas.node', id: 'project-a:document-node' },
}

describe('open_multi_layer_document_node_editor contract', () => {
  it('只接受严格的画布工程和节点稳定引用', () => {
    expect(capability).toBeTruthy()
    expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(
      OPEN_MULTI_LAYER_DOCUMENT_NODE_EDITOR_CAPABILITY_ID,
    )).toBe(capability)
    expect(capability?.inputSchema.safeParse(input).success).toBe(true)
    expect(capability?.inputSchema.safeParse({
      ...input,
      nodeRef: { kind: 'generation.result', id: 'result-a' },
    }).success).toBe(false)
    expect(capability?.inputSchema.safeParse({ ...input, nodeId: 'raw-node' }).success).toBe(false)
    expect(capability?.inputSchema.safeParse({
      ...input,
      projectRef: { ...input.projectRef, internal: true },
    }).success).toBe(false)
    expect(capability?.aiInputSchema.additionalProperties).toBe(false)
  })

  it('声明 R0 导航、稳定引用和画布内节点编辑器成功证据', () => {
    expect(capability).toMatchObject({
      version: 1,
      domain: 'canvas',
      risk: 'R0',
      idempotent: true,
      supportsUndo: false,
      requiredScopes: expect.arrayContaining(['navigation', 'canvas']),
      acceptsRefs: ['canvas.project', 'canvas.node'],
      producesRefs: ['canvas.project', 'canvas.node', 'application.surface'],
    })
    expect(capability?.control.impacts).toEqual([
      expect.objectContaining({
        effect: 'navigate',
        entityTypes: ['canvas.project', 'canvas.node', 'application.surface'],
        verificationRequired: false,
      }),
    ])
    expect(capability?.successEvidence.join(' ')).toContain('节点自己的多图层文档编辑器')
    expect(capability?.failureRecovery.join(' ')).toContain('不要改用 open_image_editor_with_source')
  })

  it('输出只接受 workspace.canvas 和多图层文档编辑器结果', () => {
    expect(capability?.outputSchema.safeParse({
      ...input,
      surfaceId: 'workspace.canvas',
      editorKind: 'multi_layer_document',
      status: 'opened',
      resultRefs: [
        input.projectRef,
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
      resultRefs: [],
      revision: 1,
      scopeRevisions: {},
    }).success).toBe(false)
  })
})
