import {
  ingestImageEditorV3Source,
  loadImageEditorV3Document,
} from '@/commands/imageEditorV3'
import { readImageEditDocumentInstanceV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import {
  type ImageEditSessionReferenceV3,
} from '@/core/imageEdit'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'
import { createImageEditDocumentV3, createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type {
  ImageEditDocumentReferenceV3,
  ImageEditDocumentRepositoryV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts'
import type {
  ImageEditorV3DocumentSnapshot,
  ImageEditorV3ManagedSource,
  ImageEditorV3ResourceDescriptor,
} from '@/platform/contracts/imageEditorV3'
import {
  createImageMarkV3ColorMode,
  prepareImageEditSourceLocatorV3,
} from '@/features/imageEdit/v3/application/imageEditSourceV3'
export interface ImageEditPreparedSessionV3 {
  sourceUrl: string
  document: ImageEditDocumentV3
  history: ImageEditCommandHistorySnapshotV3
  persistence: ImageEditPersistenceSnapshotV3
  reference: ImageEditDocumentReferenceV3
  resourceByteSizes: Readonly<Record<string, number>>
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
}

export interface PrepareImageEditManagedSessionOptionsV3 {
  sourceImageUrl: string
  session?: ImageEditSessionReferenceV3 | null
  documentId?: string
  repository: Pick<ImageEditDocumentRepositoryV3, 'save'>
  signal?: AbortSignal
  ingestSource?: typeof ingestImageEditorV3Source
  loadSnapshot?: typeof loadImageEditorV3Document
}

function documentIdFromRef(documentRef: string): string {
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

function descriptorSizes(snapshot: ImageEditorV3DocumentSnapshot): Readonly<Record<string, number>> {
  return Object.fromEntries(snapshot.resources.map((resource) => [
    resource.resourceRef,
    resource.byteLength,
  ]))
}

async function loadReferencedSession(
  session: ImageEditSessionReferenceV3,
  loadSnapshot: typeof loadImageEditorV3Document,
  signal: AbortSignal | undefined,
): Promise<ImageEditPreparedSessionV3> {
  const current = readImageEditDocumentInstanceV3(documentIdFromRef(session.documentRef))
  if (current) return { ...current, sourceUrl: session.sourceUrl }
  const snapshot = await loadSnapshot({
    requestId: `image-editor-v3:session:load:${createImageEditIdV3('request')}`,
    documentRef: session.documentRef,
  }, signal)
  const documentId = documentIdFromRef(session.documentRef)
  if (!snapshot) throw new Error('图片编辑文档不存在')
  if (
    snapshot.documentRef !== session.documentRef
    || snapshot.document.id !== documentId
    || snapshot.revision !== session.revision
    || snapshot.document.revision !== session.revision
    || snapshot.previewRef !== session.previewRef
  ) {
    throw new Error('图片编辑会话版本与权威文档不一致')
  }
  const persistence = restorePersistence(snapshot.document, snapshot.history)
  return {
    sourceUrl: session.sourceUrl,
    document: persistence.document,
    history: persistence.history,
    persistence,
    reference: {
      documentId,
      revision: snapshot.revision,
      previewRef: snapshot.previewRef,
    },
    resourceByteSizes: descriptorSizes(snapshot),
    resourceDescriptors: snapshot.resources,
  }
}

export async function prepareImageEditManagedSessionV3(
  options: PrepareImageEditManagedSessionOptionsV3,
): Promise<ImageEditPreparedSessionV3> {
  options.signal?.throwIfAborted()
  if (options.session) return loadReferencedSession(options.session, options.loadSnapshot ?? loadImageEditorV3Document, options.signal)
  const documentId = options.documentId ?? createImageEditIdV3('image-document')
  const ingest = options.ingestSource ?? ingestImageEditorV3Source
  const managed: ImageEditorV3ManagedSource = await ingest({
    requestId: `image-editor-v3:session:source:${documentId}`,
    source: await prepareImageEditSourceLocatorV3(options.sourceImageUrl),
  }, options.signal)
  options.signal?.throwIfAborted()
  const document = createImageEditDocumentV3({
    width: managed.metadata.width,
    height: managed.metadata.height,
    sourceResourceId: managed.resource.resourceRef,
    documentId,
    color: createImageMarkV3ColorMode(managed.metadata),
  })
  const persistence = createInitialPersistence(document)
  const reference = await options.repository.save(document, {
    expectedRevision: 0,
    previewRef: null,
    history: persistence.history,
    signal: options.signal,
  })
  return {
    sourceUrl: options.sourceImageUrl,
    document,
    history: persistence.history,
    persistence,
    reference,
    resourceByteSizes: {
      [managed.resource.resourceRef]: managed.resource.byteLength,
    },
    resourceDescriptors: [managed.resource],
  }
}

