import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import type { ImageEditPersistenceHostV3, ImageEditPersistenceProjectionV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOwner'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { isEditableLayerStackResultNode } from '../domain/canvasNodeGuards'
import { saveMultiLayerDocumentAfterEditing } from './multiLayerDocumentNodeGenerationAdapter'
import { CanvasPersistenceError, confirmCanvasPersistence } from './canvasPersistenceService'
import { MultiLayerDocumentNodeApplicationError } from './multiLayerDocumentNodeApplicationContracts'

/** 每个附着宿主拥有一个确认器；只有本确认器已安装但尚未落盘的投影能跳过再次物化。 */
export function createMultiLayerDocumentPersistenceConfirmation(input: {
  projectId: string; nodeId: string; documentRef: ImageEditSessionReferenceV3['documentRef']
}, dependencies: { saveProjection?: typeof saveMultiLayerDocumentAfterEditing } = {}) {
  const saveProjection = dependencies.saveProjection ?? saveMultiLayerDocumentAfterEditing
  const currentRevisions = () => ({ canvas: Math.max(0, Math.trunc(useProjectStore.getState().currentProject?.updatedAt ?? 0)) })
  const projection: NonNullable<ImageEditPersistenceHostV3['projection']> = {
    effects: [{ declarationId: 'image_edit.document.node_projection', effect: 'update',
      entityType: 'canvas.node', propertyIds: [], revisionScopes: ['canvas'] },
      { declarationId: 'image_edit.document.node_projection_confirmation', effect: 'execute',
        entityType: 'canvas.node', propertyIds: [], revisionScopes: ['canvas'] }],
    requiredPermissions: ['canvas:write'], currentRevisions,
  }
  const currentNode = () => {
    const node = useCanvasStore.getState().nodes.find((candidate) => candidate.id === input.nodeId)
    if (useProjectStore.getState().currentProjectId !== input.projectId || !isEditableLayerStackResultNode(node)
      || node.data.imageEditSession?.documentRef !== input.documentRef) {
      throw new MultiLayerDocumentNodeApplicationError('NODE_TARGET_CHANGED',
        '图片内容已保存，但原画布节点已删除或不再关联此图片。请恢复原节点及其文档关联后重试同步；当前编辑内容不会覆盖其他节点。', true)
    }
    return node
  }
  const receipt = (session: ImageEditSessionReferenceV3, persistedOnly = false): ImageEditPersistenceProjectionV3 => ({
    reference: { documentId: session.documentRef.slice('image-edit-v3:'.length),
      revision: session.revision, previewRef: session.previewRef },
    effects: [{ effect: persistedOnly ? 'execute' : 'update', entityType: 'canvas.node',
      refs: [{ kind: 'canvas.node', id: `${input.projectId}:${input.nodeId}`, revision: currentRevisions().canvas }],
      propertyIds: [], origin: { kind: 'cascade', declarationId: persistedOnly
        ? 'image_edit.document.node_projection_confirmation' : 'image_edit.document.node_projection' } }],
    resultingRevisions: currentRevisions(),
  })
  let pending: { node: ReturnType<typeof currentNode>; session: ImageEditSessionReferenceV3 } | null = null
  return {
    projection,
    async confirm(session: ImageEditSessionReferenceV3): Promise<ImageEditPersistenceProjectionV3> {
      if (session.documentRef !== input.documentRef) throw new Error('图片保存确认不能切换文档')
      const before = currentNode()
      try {
        if (pending && pending.node === before && pending.session.revision === session.revision) {
          await confirmCanvasPersistence(input.projectId)
          const result = receipt(pending.session, true)
          pending = null
          return result
        }
        pending = null
        const result = await saveProjection({
          ...input, data: before.data, session,
        })
        return receipt(result.imageEditSession)
      } catch (error) {
        if (error instanceof CanvasPersistenceError) {
          const node = currentNode()
          const installed = node.data.imageEditSession!
          if (node !== before && installed.documentRef === session.documentRef && installed.revision === session.revision) {
            pending = { node, session: installed }
          }
          const actual = pending?.node === node ? receipt(pending.session) : undefined
          throw new ApplicationPersistenceFailure(
            '图片内容已保存，画布预览同步尚未确认。请重试保存，不要重复编辑。',
            { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'projection',
              recovery: { capabilityId: 'retry_image_edit_document_save',
                target: { kind: 'image_edit.document', id: `v3:${encodeURIComponent(session.documentRef.slice('image-edit-v3:'.length))}` },
                replayMutation: false } }, error, actual,
          )
        }
        throw error
      }
    },
  }
}
