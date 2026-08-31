import {
  ImageEditorV3CommandRepository,
  ingestImageEditorV3Source,
  loadImageEditorV3Document,
} from '@/commands/imageEditorV3'
import {
  parseImageEditDocument,
  type ImageEditSessionReferenceV3,
} from '@/core/imageEdit'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { migrateImageEditDocumentV2ToV3 } from '@/core/imageEdit/v3/legacyMigration'
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
  resolveImageMarkV3SourceLocator,
} from '@/features/imageMark/standalone/imageMarkV3Source'
import {
  CANVAS_EDIT_V3_SESSION_OPTION,
  parseCanvasEditV3NodeSession,
} from './canvasEditV3Contracts'
import {
  importLayerStackV1AsImageEditDocumentV3,
  readLayerStackV1ImageEditorOption,
} from './layerStackV1Adapter'

export { CANVAS_EDIT_V3_SESSION_OPTION } from './canvasEditV3Contracts'

export class CanvasEditV3SessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanvasEditV3SessionError'
  }
}

export interface CanvasEditV3PreparedSession {
  sourceUrl: string
  document: ImageEditDocumentV3
  history: ImageEditCommandHistorySnapshotV3
  persistence: ImageEditPersistenceSnapshotV3
  reference: ImageEditDocumentReferenceV3
  resourceByteSizes: Readonly<Record<string, number>>
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
}

interface PrepareCanvasEditV3SessionOptions {
  sourceImageUrl: string
  toolOptions: DynamicValueMap
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

export function readCanvasEditV3SessionOption(
  options: DynamicValueMap,
  sourceImageUrl: string,
): ImageEditSessionReferenceV3 | null {
  const raw = options[CANVAS_EDIT_V3_SESSION_OPTION]
  if (raw === undefined) return null
  if (typeof raw !== 'string') {
    throw new CanvasEditV3SessionError('画布图片编辑会话字段必须是稳定的 JSON 引用')
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new CanvasEditV3SessionError('画布图片编辑会话引用无法解析')
  }
  let session: ImageEditSessionReferenceV3 | null
  try {
    session = parseCanvasEditV3NodeSession(decoded, sourceImageUrl)
  } catch {
    throw new CanvasEditV3SessionError('画布图片编辑会话引用无效或与节点图片不一致')
  }
  if (!session) throw new CanvasEditV3SessionError('画布图片编辑会话引用无效')
  return session
}

async function loadReferencedSession(
  session: ImageEditSessionReferenceV3,
  loadSnapshot: typeof loadImageEditorV3Document,
  signal: AbortSignal | undefined,
): Promise<CanvasEditV3PreparedSession> {
  const snapshot = await loadSnapshot({
    requestId: `image-editor-v3:canvas-edit:load:${createImageEditIdV3('request')}`,
    documentRef: session.documentRef,
  }, signal)
  const documentId = documentIdFromRef(session.documentRef)
  if (!snapshot) throw new CanvasEditV3SessionError('画布图片编辑文档不存在')
  if (
    snapshot.documentRef !== session.documentRef
    || snapshot.document.id !== documentId
    || snapshot.revision !== session.revision
    || snapshot.document.revision !== session.revision
    || snapshot.previewRef !== session.previewRef
  ) {
    throw new CanvasEditV3SessionError('画布图片编辑会话版本与权威文档不一致')
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

async function importLegacySession(
  options: PrepareCanvasEditV3SessionOptions,
): Promise<CanvasEditV3PreparedSession> {
  const documentId = options.documentId ?? createImageEditIdV3('canvas-edit-document')
  const ingest = options.ingestSource ?? ingestImageEditorV3Source
  const layerStack = readLayerStackV1ImageEditorOption(options.toolOptions)
  if (layerStack) {
    const imported = await importLayerStackV1AsImageEditDocumentV3({
      document: layerStack,
      documentId,
      signal: options.signal,
      ingestSource: ingest,
    })
    const persistence = createInitialPersistence(imported.document)
    const reference = await options.repository.save(imported.document, {
      expectedRevision: 0,
      previewRef: null,
      history: persistence.history,
      signal: options.signal,
    })
    return {
      sourceUrl: options.sourceImageUrl,
      document: imported.document,
      history: persistence.history,
      persistence,
      reference,
      resourceByteSizes: Object.fromEntries(imported.resourceDescriptors.map((resource) => [
        resource.resourceRef,
        resource.byteLength,
      ])),
      resourceDescriptors: imported.resourceDescriptors,
    }
  }
  const managed: ImageEditorV3ManagedSource = await ingest({
    requestId: `image-editor-v3:canvas-edit:source:${documentId}`,
    source: resolveImageMarkV3SourceLocator(options.sourceImageUrl),
  }, options.signal)
  const legacy = parseImageEditDocument(options.toolOptions.document ?? options.toolOptions.markDoc)
  let generatedLayerIndex = 0
  const migrated = migrateImageEditDocumentV2ToV3(legacy, {
    width: managed.metadata.width,
    height: managed.metadata.height,
    sourceResourceId: managed.resource.resourceRef,
    documentId,
    idFactory: (prefix) => `${prefix}-${documentId}-${generatedLayerIndex += 1}`,
  })
  const document: ImageEditDocumentV3 = {
    ...migrated,
    color: createImageMarkV3ColorMode(managed.metadata),
  }
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

export async function prepareCanvasEditV3Session(
  options: PrepareCanvasEditV3SessionOptions,
): Promise<CanvasEditV3PreparedSession> {
  const session = readCanvasEditV3SessionOption(options.toolOptions, options.sourceImageUrl)
  if (session) {
    return loadReferencedSession(
      session,
      options.loadSnapshot ?? loadImageEditorV3Document,
      options.signal,
    )
  }
  return importLegacySession(options)
}

export function createCanvasEditV3SessionReference(
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

export function serializeCanvasEditV3SessionReference(
  session: ImageEditSessionReferenceV3,
): string {
  return JSON.stringify(session)
}

export function createCanvasEditV3Repository(): ImageEditorV3CommandRepository {
  return new ImageEditorV3CommandRepository()
}
