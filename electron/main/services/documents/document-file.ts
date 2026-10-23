import fsp from 'node:fs/promises'
import path from 'node:path'

import {
  DocumentFormatError,
  MAX_DOCUMENT_FILE_BYTES,
  parseDocumentRawText,
  documentEnvelopeContract,
  documentEnvelopeMinReaderVersion,
  documentEnvelopeVersion,
  upgradeDocumentEnvelope,
  toTimestamp,
  type DocumentEnvelope,
} from '../../../../src/core/documents/envelope'
import { documentNameForKind, type DocumentKindDescriptor, type DocumentKindRegistry } from '../../../../src/core/documents/kinds'
import type { DocumentListSummary, DocumentMeta } from '../../../../src/core/documents/types'
import { createLocationCodec, type LocationContext, type LocationReport } from '../../../../src/core/storage/locationCodec'
import type { IndexedDocument } from './catalog'
import { DocumentNotFoundError, DocumentUnsupportedError, errorCode } from './errors'
import type { PackageAdapterRegistry } from './package-adapters'
import type { DocumentWorkspace, ResolvedContainer } from './workspace'
import { assertPersistenceVersion, PersistenceError, upgradePersistenceContent, type PersistenceContract } from '../../../../src/core/persistence/migrations'
import { backupBeforePersistenceUpgrade } from '../persistence/file-upgrade'
import { createMainLogger } from '../logging/main-logger'

/** 文档文件的读取、头信息与内容换算（文档仓库与索引扫描共用）。 */

export interface DocumentFileStat {
  size: number
  mtimeMs: number
  birthtimeMs: number
}

export interface DocumentFileHeader {
  id: string
  /** 文件头里的名称；对外以文件名为准，保存时同步。 */
  name: string
  draft: boolean
  revision: number
  kindVersion: number
  createdAt: string
  updatedAt: string
}

export interface LoadedDocumentFile {
  kind: DocumentKindDescriptor
  path: string
  stat: DocumentFileStat
  header: DocumentFileHeader
  /** JSON 类型的完整外壳；包类型与文件夹类型为 null。 */
  envelope: DocumentEnvelope | null
  /** 包类型与文件夹类型由适配器给出摘要；JSON 类型在换算内容后计算。 */
  packageSummary: DocumentListSummary | null
  backupPath?: string
}

export interface DocumentFileDependencies {
  kinds: DocumentKindRegistry
  adapters: PackageAdapterRegistry
}

/** 文件名去掉扩展名就是文档名（项目名就是文件夹名，同理）。 */
export function documentNameOf(kind: DocumentKindDescriptor, filePath: string): string {
  return documentNameForKind(kind, path.basename(filePath)) ?? path.basename(filePath)
}

export function kindForPath(kinds: DocumentKindRegistry, filePath: string): DocumentKindDescriptor {
  const kind = kinds.forFileName(path.basename(filePath))
  if (!kind) throw new DocumentFormatError('不是痕迹AI文档。')
  return kind
}

/** 读取文档文件与头信息；文件不在时抛 DocumentNotFoundError（带调用方给的 ID）。 */
export async function loadDocumentFile(
  filePath: string,
  dependencies: DocumentFileDependencies,
  expectedId?: string,
): Promise<LoadedDocumentFile> {
  const kind = kindForPath(dependencies.kinds, filePath)
  let stat: DocumentFileStat
  try {
    stat = await statDocumentLocation(kind, filePath, dependencies.adapters)
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') throw new DocumentNotFoundError(expectedId ?? '')
    throw error
  }
  if (kind.storage !== 'json') {
    const adapter = dependencies.adapters.get(kind.id)
    if (!adapter) throw new DocumentUnsupportedError('这种文档的读写尚未接入。')
    const header = await adapter.readHeader(filePath)
    assertPersistenceVersion(documentPersistenceContract(kind), header.kindVersion)
    return {
      kind,
      path: filePath,
      stat,
      header: {
        id: header.id,
        name: header.name,
        draft: header.draft,
        revision: header.revision,
        kindVersion: header.kindVersion,
        createdAt: header.createdAt,
        updatedAt: header.updatedAt,
      },
      envelope: null,
      packageSummary: header.summary,
    }
  }
  if (stat.size > MAX_DOCUMENT_FILE_BYTES) throw new DocumentFormatError('文档文件超过可读取的大小。')
  const originalText = await fsp.readFile(filePath, 'utf8')
  const raw = parseDocumentRawText(originalText)
  const fromEnvelopeVersion = documentEnvelopeVersion(raw)
  const envelopeMinReader = documentEnvelopeMinReaderVersion(raw)
  const upgradingEnvelope = fromEnvelopeVersion < documentEnvelopeContract.version
  const logger = createMainLogger('main.documents')
  let envelopeBackup: string | undefined
  let envelope: DocumentEnvelope
  try {
    assertPersistenceVersion(documentEnvelopeContract, fromEnvelopeVersion, envelopeMinReader)
    envelopeBackup = upgradingEnvelope ? await backupBeforePersistenceUpgrade(filePath, documentEnvelopeContract, fromEnvelopeVersion, originalText) : undefined
    if (upgradingEnvelope) logger.info('开始升级文档外壳', { event: 'documents.envelope.upgrade.start', context: { fromVersion: fromEnvelopeVersion, toVersion: documentEnvelopeContract.version, backupPath: envelopeBackup } })
    envelope = upgradeDocumentEnvelope(raw, envelopeBackup)
    if (upgradingEnvelope) logger.info('文档外壳升级完成，等待首次保存', { event: 'documents.envelope.upgrade.completed', context: { fromVersion: fromEnvelopeVersion, toVersion: documentEnvelopeContract.version, backupPath: envelopeBackup } })
  } catch (error) {
    logger.warn('文档外壳读取失败', { event: 'documents.envelope.read.failed', context: { fromVersion: fromEnvelopeVersion, toVersion: documentEnvelopeContract.version, backupPath: envelopeBackup }, error })
    throw error
  }
  if (envelope.kind !== kind.id) throw new DocumentFormatError('文档类型与扩展名不一致。')
  const contract = documentPersistenceContract(kind)
  try {
    assertPersistenceVersion(contract, envelope.kindVersion, envelope.kindMinReaderVersion)
    const backupPath = (envelope.kindVersion < contract.version ? await backupBeforePersistenceUpgrade(filePath, contract, envelope.kindVersion, originalText) : undefined) ?? envelopeBackup
    return { kind, path: filePath, stat, header: headerFromEnvelope(envelope), envelope, packageSummary: null, backupPath }
  } catch (error) {
    createMainLogger('main.documents').warn('文档格式读取失败', { event: 'documents.load.failed', context: { format: contract.id, fromVersion: envelope.kindVersion, toVersion: kind.version }, error })
    throw error
  }
}

/**
 * 文档位置的大小与时间：普通文档与单文件包取文件本身；文件夹类型取其中的头信息文件，
 * 创建时间取文件夹本身。位置的形状不对（该是文件却是文件夹，或反过来）时报格式错误。
 */
export async function statDocumentLocation(kind: DocumentKindDescriptor, filePath: string, adapters: PackageAdapterRegistry): Promise<DocumentFileStat> {
  const info = await fsp.stat(filePath)
  if (kind.storage !== 'folder') {
    if (!info.isFile()) throw new DocumentFormatError('文档位置不是文件。')
    return { size: info.size, mtimeMs: info.mtimeMs, birthtimeMs: info.birthtimeMs }
  }
  if (!info.isDirectory()) throw new DocumentFormatError('文档位置不是文件夹。')
  const headerFile = adapters.get(kind.id)?.headerFile
  if (!headerFile) throw new DocumentUnsupportedError('这种文档的读写尚未接入。')
  const header = await fsp.stat(path.join(filePath, headerFile))
  return { size: header.size, mtimeMs: header.mtimeMs, birthtimeMs: info.birthtimeMs }
}

export function documentPersistenceContract(kind: DocumentKindDescriptor): PersistenceContract {
  return { id: `document.${kind.id}`, name: kind.untitledNames.zh.replace('未命名', ''), version: kind.version, minReaderVersion: kind.minReaderVersion, schema: kind.contentSchema, migrations: kind.migrations }
}

function headerFromEnvelope(envelope: DocumentEnvelope): DocumentFileHeader {
  return {
    id: envelope.id,
    name: envelope.name,
    draft: envelope.draft === true,
    revision: envelope.revision,
    kindVersion: envelope.kindVersion,
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt,
  }
}

/** 刚写完的 JSON 文档：只取文件状态，不再整份读回。 */
export async function describeWrittenDocument(
  kind: DocumentKindDescriptor,
  filePath: string,
  envelope: DocumentEnvelope,
): Promise<LoadedDocumentFile> {
  const info = await fsp.stat(filePath)
  return {
    kind,
    path: filePath,
    stat: { size: info.size, mtimeMs: info.mtimeMs, birthtimeMs: info.birthtimeMs },
    header: headerFromEnvelope(envelope),
    envelope,
    packageSummary: null,
  }
}

export interface DecodedDocumentContent {
  /** 内存形态，已升级到当前版本并通过类型 schema。 */
  content: unknown
  report: LocationReport
}

/** 把文件里的内容换回绝对路径、升级到当前版本并按类型 schema 校验。 */
export function decodeDocumentContent(
  file: LoadedDocumentFile,
  container: ResolvedContainer,
  workspace: DocumentWorkspace,
): DecodedDocumentContent {
  if (!file.envelope) throw new DocumentUnsupportedError('这种文档的内容由专用编辑器读写。')
  const codec = createLocationCodec(workspace.locationContext(container))
  const { content, report } = codec.decodeContent(file.envelope.content)
  const migrating = file.envelope.kindVersion < file.kind.version
  const logger = createMainLogger('main.documents')
  if (migrating) logger.info('开始升级文档内容', { event: 'documents.upgrade.start', context: { format: file.kind.id, fromVersion: file.envelope.kindVersion, toVersion: file.kind.version, backupPath: file.backupPath } })
  try {
    const upgraded = upgradePersistenceContent(documentPersistenceContract(file.kind), content, file.envelope.kindVersion, file.backupPath, file.envelope.kindMinReaderVersion)
    if (migrating) logger.info('文档内容升级完成，等待首次保存', { event: 'documents.upgrade.completed', context: { format: file.kind.id, fromVersion: file.envelope.kindVersion, toVersion: file.kind.version, backupPath: file.backupPath } })
    return { content: upgraded, report: file.kind.dependencyContent
      ? codec.decodeContent(file.kind.dependencyContent(upgraded)).report
      : report }
  } catch (error) {
    const failure = error instanceof PersistenceError ? error : null
    logger.warn('文档格式读取失败', { event: migrating ? 'documents.upgrade.failed' : 'documents.decode.failed', context: { format: failure?.formatId, fromVersion: failure?.fromVersion, toVersion: failure?.toVersion, fields: failure?.fields, backupPath: failure?.backupPath }, error })
    throw error
  }
}

/** 位置编码保留全部记录；依赖报告只用于检查和搬运实际输入资源。 */
export function encodeDocumentContent(kind: DocumentKindDescriptor, content: unknown, context: LocationContext): { content: unknown; report: LocationReport } {
  const codec = createLocationCodec(context)
  const encoded = codec.encodeContent(content)
  if (kind.dependencyContent) encoded.report = codec.encodeContent(kind.dependencyContent(content)).report
  return encoded
}

export function metaFromFile(file: LoadedDocumentFile, container: ResolvedContainer): DocumentMeta {
  return {
    id: file.header.id,
    kind: file.kind.id,
    name: documentNameOf(file.kind, file.path),
    path: file.path,
    container: container.ref,
    draft: file.header.draft,
    revision: file.header.revision,
    kindVersion: file.header.kindVersion,
    createdAt: toTimestamp(file.header.createdAt),
    updatedAt: toTimestamp(file.header.updatedAt),
  }
}

export function indexedFromFile(
  file: LoadedDocumentFile,
  container: ResolvedContainer,
  summary: DocumentListSummary,
): IndexedDocument {
  const meta = metaFromFile(file, container)
  return {
    id: meta.id,
    kind: meta.kind,
    path: meta.path,
    name: meta.name,
    projectId: container.ref.kind === 'project' ? container.ref.projectId : null,
    draft: meta.draft,
    revision: meta.revision,
    kindVersion: meta.kindVersion,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    fileModifiedAt: file.stat.mtimeMs,
    fileSize: file.stat.size,
    fileCreatedAt: file.stat.birthtimeMs,
    summary,
    missing: false,
  }
}

/** 列表摘要：JSON 类型换算并校验内容后由类型计算；内容无效时为空摘要（打开时再报具体错误）。 */
export function summarizeFile(
  file: LoadedDocumentFile,
  container: ResolvedContainer,
  workspace: DocumentWorkspace,
): DocumentListSummary {
  if (file.packageSummary) return file.packageSummary
  try {
    return file.kind.summarize(decodeDocumentContent(file, container, workspace).content)
  } catch {
    return {}
  }
}
