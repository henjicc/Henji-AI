import { resampleImageEditCapability } from '@/core/application-control/domains/imageEdit/imageEditGeometryCapabilities';
import { applicationCallerAccess } from '@/core/application-control/callerContext';
import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control';
import { collectImageEditV3LiveLayers, imageEditV3LayerRef, splitImageEditV3DocumentRef } from '../v3/application/imageEditDocumentRefs';
import { requireImageEditDocumentInstanceV3 } from '../v3/application/imageEditDocumentInstances';
import { runImageEditPersistedOperationV3 } from '../v3/application/imageEditPersistenceOperations';
import { commitDocumentGeometryV3, prepareDocumentGeometryV3 } from '../v3/tools/documentGeometry/service';
export function registerImageEditGeometryHandlers(registrar: ApplicationCapabilityHandlerRegistrar): void {
  registrar.registerHandler(resampleImageEditCapability.id, async (input, context) => {
    const parsed = resampleImageEditCapability.inputSchema.parse(input), { documentId } = splitImageEditV3DocumentRef(parsed.documentRef);
    const access = context.callerGrant ? applicationCallerAccess(context.callerGrant, context.requestId ?? 'resample-image', context.signal) : undefined;
    return runImageEditPersistedOperationV3(documentId, access, async () => {
      const { bus, persistenceOwner } = requireImageEditDocumentInstanceV3(documentId);
      if (access && persistenceOwner?.projection?.requiredPermissions.some(permission => !access.permissions.has(permission))) throw new Error('PERMISSION_DENIED:图片文档节点保存需要原画布的写入权限');
      const draft = await prepareDocumentGeometryV3(bus, { width: parsed.width, height: parsed.height, mode: parsed.method, protectSelection: parsed.protectSelection }, { signal: context.signal });
      const removedLayers = collectImageEditV3LiveLayers(draft.original).map(({ layer }) => imageEditV3LayerRef(documentId, layer.id));
      let commandId: string;
      try { commandId = commitDocumentGeometryV3(bus, draft); } catch (error) { await draft.release(); throw error; }
      const current = bus.getSnapshot().document;
      return { ref: parsed.documentRef, commandId, removedLayers, createdLayers: current.layers.map(layer => imageEditV3LayerRef(documentId, layer.id)), width: current.geometry.width, height: current.geometry.height,
        verification: { verified: current.geometry.width === parsed.width && current.geometry.height === parsed.height && bus.getPersistenceSnapshot().history.undo.at(-1)?.forward.commandId === commandId } };
    });
  });
}
