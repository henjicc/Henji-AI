import {
  ImageEditorV3CommandRepository,
  ingestImageEditorV3Source,
} from '@/commands/imageEditorV3'
import {
  coerceImageEditSession,
  isImageEditSessionReferenceV3,
  type ImageEditSessionData,
  type ImageEditSessionReferenceV3,
  type ImageMarkSession,
} from '@/core/imageEdit'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { migrateImageEditDocumentV2ToV3 } from '@/core/imageEdit/v3/legacyMigration'
import type {
  ImageEditDocumentReferenceV3,
  ImageEditDocumentRepositoryV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts'
import {
  getImageEditorHostProfileV3,
  ImageEditorReadinessErrorV3,
} from '@/features/imageEdit/v3/application/imageEditorHostProfiles'
import type { ImageEditorV3ManagedSource } from '@/platform/contracts/imageEditorV3'
import {
  createImageMarkV3ColorMode,
  resolveImageMarkV3SourceLocator,
} from '../standalone/imageMarkV3Source'

export interface ViewerMarkEditorV3PreparedSession {
  sourceUrl: string
  document: ImageEditDocumentV3
  history: ImageEditCommandHistorySnapshotV3
  persistence: ImageEditPersistenceSnapshotV3
  reference: ImageEditDocumentReferenceV3
}

export type ViewerMarkEditorV3SessionErrorKey =
  | 'imageEditor.v3.viewer.errors.saveUnavailable'
  | 'imageEditor.v3.viewer.errors.savedDocumentNotFound'
  | 'imageEditor.v3.viewer.errors.staleSessionReference'

export class ViewerMarkEditorV3SessionError extends Error {
  constructor(readonly messageKey: ViewerMarkEditorV3SessionErrorKey) {
    super(messageKey)
    this.name = 'ViewerMarkEditorV3SessionError'
  }
}

interface PrepareViewerMarkEditorV3SessionOptions {
  imageUrl: string
  session?: ImageEditSessionData | ImageMarkSession
  documentId: string
  repository: Pick<ImageEditDocumentRepositoryV3, 'load' | 'save'>
  signal?: AbortSignal
  ingestSource?: typeof ingestImageEditorV3Source
}

function documentIdFromRef(documentRef: ImageEditSessionReferenceV3['documentRef']): string {
  return documentRef.slice('image-edit-v3:'.length)
}

function createInitialPersistence(document: ImageEditDocumentV3): ImageEditPersistenceSnapshotV3 {
  const history = new ImageEditCommandHistoryV3()
  history.clear(document)
  return {
    document,
    history: history.createSnapshot(),
    retainedResources: [],
  }
}

function restorePersistence(
  document: ImageEditDocumentV3,
  historySnapshot: ImageEditCommandHistorySnapshotV3 | null,
): ImageEditPersistenceSnapshotV3 {
  const history = new ImageEditCommandHistoryV3()
  if (historySnapshot) history.restore(document, historySnapshot)
  else history.clear(document)
  return {
    document,
    history: history.createSnapshot(),
    retainedResources: history.getRetainedResources(),
  }
}

function assertQuickProfileAccepts(document: ImageEditDocumentV3): void {
  const profile = getImageEditorHostProfileV3('quick')
  if (!profile.saveActions.includes('save-document')) {
    throw new ViewerMarkEditorV3SessionError(
      'imageEditor.v3.viewer.errors.saveUnavailable',
    )
  }
  const hdr = document.color.transferFunction === 'pq'
    || document.color.transferFunction === 'hlg'
    || document.color.hdrMetadata !== null
  if (hdr && profile.hdrReadiness.state !== 'ready') {
    throw new ImageEditorReadinessErrorV3(profile.hdrReadiness)
  }
}

async function loadReferencedSession(
  session: ImageEditSessionReferenceV3,
  repository: PrepareViewerMarkEditorV3SessionOptions['repository'],
  signal: AbortSignal | undefined,
): Promise<ViewerMarkEditorV3PreparedSession> {
  const documentId = documentIdFromRef(session.documentRef)
  const loaded = await repository.load(documentId, signal)
  if (!loaded || loaded.documentId !== documentId) {
    throw new ViewerMarkEditorV3SessionError(
      'imageEditor.v3.viewer.errors.savedDocumentNotFound',
    )
  }
  if (loaded.revision < session.revision) {
    throw new ViewerMarkEditorV3SessionError(
      'imageEditor.v3.viewer.errors.staleSessionReference',
    )
  }
  assertQuickProfileAccepts(loaded.document)
  const persistence = restorePersistence(loaded.document, loaded.history)
  return {
    sourceUrl: session.sourceUrl,
    document: persistence.document,
    history: persistence.history,
    persistence,
    reference: {
      documentId: loaded.documentId,
      revision: loaded.revision,
      previewRef: loaded.previewRef,
    },
  }
}

async function importLegacySession(
  options: PrepareViewerMarkEditorV3SessionOptions,
): Promise<ViewerMarkEditorV3PreparedSession> {
  const legacy = coerceImageEditSession(options.session, options.imageUrl)
  const ingest = options.ingestSource ?? ingestImageEditorV3Source
  const managed: ImageEditorV3ManagedSource = await ingest({
    requestId: `image-editor-v3:viewer:source:${options.documentId}`,
    source: resolveImageMarkV3SourceLocator(legacy.sourceUrl),
  }, options.signal)
  let generatedLayerIndex = 0
  const migrated = migrateImageEditDocumentV2ToV3(legacy.document, {
    width: managed.metadata.width,
    height: managed.metadata.height,
    sourceResourceId: managed.resource.resourceRef,
    documentId: options.documentId,
    idFactory: (prefix) => `${prefix}-${options.documentId}-${generatedLayerIndex += 1}`,
  })
  const document: ImageEditDocumentV3 = {
    ...migrated,
    color: createImageMarkV3ColorMode(managed.metadata),
  }
  assertQuickProfileAccepts(document)
  const persistence = createInitialPersistence(document)
  const reference = await options.repository.save(document, {
    expectedRevision: 0,
    previewRef: null,
    history: persistence.history,
    signal: options.signal,
  })
  return {
    sourceUrl: legacy.sourceUrl,
    document,
    history: persistence.history,
    persistence,
    reference,
  }
}

export async function prepareViewerMarkEditorV3Session(
  options: PrepareViewerMarkEditorV3SessionOptions,
): Promise<ViewerMarkEditorV3PreparedSession> {
  if (isImageEditSessionReferenceV3(options.session)) {
    return loadReferencedSession(options.session, options.repository, options.signal)
  }
  return importLegacySession(options)
}

export function createViewerMarkEditorV3SessionReference(
  sourceUrl: string,
  reference: ImageEditDocumentReferenceV3,
): ImageEditSessionReferenceV3 {
  return {
    kind: 'image-edit-v3',
    sourceUrl,
    documentRef: `image-edit-v3:${reference.documentId}`,
    revision: reference.revision,
    previewRef: reference.previewRef as ImageEditSessionReferenceV3['previewRef'],
  }
}

export function createViewerMarkEditorV3Repository(): ImageEditorV3CommandRepository {
  return new ImageEditorV3CommandRepository()
}
