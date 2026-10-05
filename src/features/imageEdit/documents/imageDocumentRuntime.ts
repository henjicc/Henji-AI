import { duplicateDocument, finalizeDocument, trashDocument, checkDocumentName } from '@/commands/documents'
import type { DocumentContainerRef, DocumentMeta, DocumentTarget } from '@/core/documents/types'
import { isEmptyImageDocumentContent, type ImageDocumentContent } from '@/core/documents/kinds/imageDocument'
import { createLogger } from '@/core/logging'
import { dialogDocumentSessionPrompter } from '@/features/documents/documentPromptStore'
import type { DocumentSession } from '@/features/documents/documentSession'
import { getDocumentSessionRegistry, parentFolderOf, type DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import type { DocumentLeaveOutcome, DocumentSessionPrompter } from '@/features/documents/documentSessionTypes'
import {
  discardImageEditDocumentInstanceV3,
  findImageEditDocumentInstanceV3,
  saveImageEditDocumentInstanceV3,
  subscribeImageEditDocumentInstancesV3,
} from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import type { ImageEditorV3ImageDocumentWorking } from '@/platform/contracts/imageEditorV3'

import {
  ImageDocumentPersistence,
  type ImageDocumentPersistenceOptions,
  type ImageDocumentRecoveryChoice,
  type ImageDocumentRecoveryInfo,
  type ImageDocumentWorkingHooks,
} from './imageDocumentPersistence'

/*
 * 图片文档运行时（3.5）：一份打开的 `.henjiimg` = 一个文档会话 + 程序目录里的工作副本 +
 * （打开编辑器时）一个 V3 文档实例。界面、助手与通用文档操作都经这里打开、新建、保存、离开。
 *
 * 会话内容是工作副本的描述（版本、尺寸、图层数），真正的图片、图层与历史由 V3 实例持有并高频
 * 保存进工作副本；实例每保存一次就通知会话，会话防抖后“保存”（工作副本屏障），空闲 30 秒、
 * 点“保存”、关闭与退出时写回 `.henjiimg`。
 */

const logger = createLogger('features.imageEdit.documents')

export interface OpenImageDocument {
  readonly id: string
  readonly session: DocumentSession
  readonly persistence: ImageDocumentPersistence
  /** 当前工作副本（重新载入后会变）。 */
  working(): ImageEditorV3ImageDocumentWorking
  /** 编辑器挂载时接上：落盘屏障、缩略图、重新载入前放下实例。 */
  attachEditor(hooks: ImageDocumentWorkingHooks): () => void
  /** 界面正在显示时不能被后台释放。 */
  isShown(): boolean
  setShown(shown: boolean): void
}

interface Handle extends OpenImageDocument {
  detachSession: () => void
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

/** 重新载入前放下内存实例：编辑器卸载是异步的，等它松开（最多约 1 秒）。 */
async function discardInstanceWhenReleased(id: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (discardImageEditDocumentInstanceV3(id)) return
    await sleep(25)
  }
  logger.warn('重新载入前没能放下图片文档实例', { event: 'image_document.reload.instance_busy', context: { documentId: id } })
}

const handles = new Map<string, Handle>()
const listeners = new Set<() => void>()
let registryProvider: () => DocumentSessionRegistry = getDocumentSessionRegistry
let prompterProvider: () => DocumentSessionPrompter = () => dialogDocumentSessionPrompter

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** 测试注入会话登记表与提示替身。 */
export function configureImageDocumentRuntimeForTests(options: {
  registry?: () => DocumentSessionRegistry
  prompter?: () => DocumentSessionPrompter
}): () => void {
  const previous = { registryProvider, prompterProvider }
  if (options.registry) registryProvider = options.registry
  if (options.prompter) prompterProvider = options.prompter
  return () => {
    registryProvider = previous.registryProvider
    prompterProvider = previous.prompterProvider
    handles.clear()
  }
}

export function subscribeOpenImageDocuments(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function findOpenImageDocument(id: string): OpenImageDocument | undefined {
  return handles.get(id)
}

function instanceRevision(id: string): number | null {
  const instance = findImageEditDocumentInstanceV3(id)
  return instance ? instance.bus.getSnapshot().document.revision : null
}

/** 默认落盘屏障：编辑器没接自己的屏障时，按 V3 实例自己的保存队列写完。 */
async function flushInstance(id: string): Promise<void> {
  const instance = findImageEditDocumentInstanceV3(id)
  if (instance?.persistenceOwner) await saveImageEditDocumentInstanceV3(id)
}

function summarize(content: ImageDocumentContent, id: string): ImageDocumentContent {
  const instance = findImageEditDocumentInstanceV3(id)
  if (!instance) return content
  const document = instance.bus.getSnapshot().document
  const crop = document.geometry.crop
  const rotated = !crop && (document.geometry.orientation.rotate === 90 || document.geometry.orientation.rotate === 270)
  const width = crop?.width ?? document.geometry.width
  const height = crop?.height ?? document.geometry.height
  const countLayers = (layers: readonly unknown[]): number => layers.reduce<number>((total, layer) => {
    const children = (layer as { children?: unknown }).children
    return total + 1 + (Array.isArray(children) ? countLayers(children) : 0)
  }, 0)
  return {
    workingRevision: document.revision,
    emptyUntilRevision: content.emptyUntilRevision,
    width: rotated ? height : width,
    height: rotated ? width : height,
    layers: countLayers(document.layers),
  }
}

/** 把会话接到 V3 实例上：实例每次保存都通知会话；会话结束时自动拆掉。 */
function bind(session: DocumentSession, persistence: ImageDocumentPersistence): Handle {
  const id = session.id
  let content = session.getContent() as ImageDocumentContent
  let editorHooks: ImageDocumentWorkingHooks | null = null
  const fallbackHooks: ImageDocumentWorkingHooks = { flush: () => flushInstance(id) }
  persistence.setHooks(fallbackHooks)
  persistence.bindSession({ meta: () => session.documentMeta, requestSave: () => session.markChanged() })
  const detachAdapter = session.attach({
    getContent: () => {
      content = summarize(content, id)
      return { ...content }
    },
    receiveContent: (next) => { content = next as ImageDocumentContent },
    subscribe: (onChange) => {
      let seen = instanceRevision(id)
      return subscribeImageEditDocumentInstancesV3(() => {
        const revision = instanceRevision(id)
        if (revision === null || revision === seen) return
        seen = revision
        onChange()
      })
    },
    isEmpty: (value) => isEmptyImageDocumentContent(summarize(value as ImageDocumentContent, id)),
  })
  const unsubscribeSession = session.subscribe(() => {
    if (!session.isEnded) return
    const handle = handles.get(id)
    if (handle?.session === session) {
      handle.detachSession()
      handles.delete(id)
      emit()
    }
  })
  let shown = false
  const handle: Handle = {
    id,
    session,
    persistence,
    isShown: () => shown,
    setShown: (value) => { shown = value },
    working: () => {
      const working = persistence.working
      if (!working) throw new Error('图片文档尚未打开。')
      return working
    },
    attachEditor(hooks) {
      editorHooks = hooks
      persistence.setHooks({
        flush: async () => { await hooks.flush() },
        thumbnail: () => hooks.thumbnail?.() ?? null,
        beforeReload: async () => {
          await hooks.beforeReload?.()
          await discardInstanceWhenReleased(id)
        },
      })
      return () => {
        if (editorHooks !== hooks) return
        editorHooks = null
        persistence.setHooks({
          ...fallbackHooks,
          beforeReload: () => discardInstanceWhenReleased(id),
        })
      }
    },
    detachSession: () => {
      unsubscribeSession()
      detachAdapter()
    },
  }
  return handle
}

function adopt(session: DocumentSession, persistence: ImageDocumentPersistence): OpenImageDocument {
  const existing = handles.get(session.id)
  if (existing && existing.session === session) return existing
  // 按文件重新解包后，旧的内存实例（上次打开留下、没有界面在用）不能再写回工作副本。
  if (persistence.imported) discardImageEditDocumentInstanceV3(session.id)
  const handle = bind(session, persistence)
  handles.set(session.id, handle)
  emit()
  return handle
}

export interface OpenImageDocumentOptions {
  /** 工作副本有没写回的修改时询问；省略时直接恢复工作副本（后台打开）。 */
  chooseRecovery?: (info: ImageDocumentRecoveryInfo) => Promise<ImageDocumentRecoveryChoice>
}

/** 打开图片文档；已打开时返回同一份。 */
export async function openImageDocument(target: DocumentTarget, options: OpenImageDocumentOptions = {}): Promise<OpenImageDocument> {
  const existing = handles.get(target.id)
  if (existing && !existing.session.isEnded) return existing
  const registry = registryProvider()
  const opened = registry.get(target.id)
  if (opened && !opened.isEnded) throw new Error('这份图片文档已经在别处打开。')
  const persistence = new ImageDocumentPersistence(options.chooseRecovery ? { chooseRecovery: options.chooseRecovery } : {})
  const session = await registry.open(target, { persistence })
  logger.info('图片文档已打开', { event: 'image_document.open.completed', context: { documentId: session.id, imported: persistence.imported } })
  return adopt(session, persistence)
}

/** 新建草稿：工作副本已由调用方按 documentId 建好；草稿以“未命名图片 N”写进它最终所在的文件夹。 */
export async function createImageDocument(
  prepared: NonNullable<ImageDocumentPersistenceOptions['pendingCreate']>,
  container: DocumentContainerRef = { kind: 'user' },
): Promise<OpenImageDocument> {
  const persistence = new ImageDocumentPersistence({ pendingCreate: prepared })
  const session = await registryProvider().create({ kind: 'image_document', container }, { persistence })
  logger.info('图片文档草稿已新建', { event: 'image_document.create.completed', context: { documentId: session.id, blank: prepared.emptyUntilRevision !== null } })
  return adopt(session, persistence)
}

/** 离开（返回列表、切换文档）：已保存的写回后关闭；空草稿删除；有内容的草稿询问保存 / 不保存 / 取消。 */
export async function leaveImageDocument(id: string): Promise<DocumentLeaveOutcome> {
  const handle = handles.get(id)
  if (!handle) return 'closed'
  const outcome = await registryProvider().leave(id)
  if (outcome !== 'cancelled') handle.setShown(false)
  return outcome
}

/** 编辑器里的“保存”：草稿先起名（可更改位置），再写回。返回 false 表示取消起名。 */
export async function saveImageDocument(id: string): Promise<boolean> {
  return await registryProvider().save(id)
}

/**
 * 另存为：
 * - 草稿：就是“保存”（起名对话框可更改位置）。
 * - 已保存的文档：先写回，再在原文件夹建副本（新 ID），按起的名字与位置转正，打开副本、关闭原文档。
 * 返回新打开的文档；取消时返回 null。
 */
export async function saveImageDocumentAs(id: string): Promise<OpenImageDocument | null> {
  const handle = handles.get(id)
  if (!handle) return null
  const meta: DocumentMeta = handle.session.documentMeta
  if (meta.draft) return await saveImageDocument(id) ? handle : null
  await handle.session.commit('save')
  let copy: DocumentMeta | null = null
  const sourceFolder = parentFolderOf(meta.path)
  const saved = await prompterProvider().askSaveName({
    subject: { type: 'document', kind: 'image_document' },
    initialName: meta.name,
    defaultFolder: sourceFolder,
    check: (name, folder) => checkDocumentName({
      subject: { type: 'document', kind: 'image_document' },
      name,
      location: { folder: folder ?? sourceFolder },
    }),
    submit: async (name, folder) => {
      const duplicated = await duplicateDocument({ target: { id: meta.id, path: meta.path }, onConflict: 'keepBoth' })
      try {
        const finalized = await finalizeDocument({ target: { id: duplicated.meta.id, path: duplicated.meta.path }, name, folder: folder ?? sourceFolder })
        copy = finalized.meta
      } catch (error) {
        await trashDocument({ id: duplicated.meta.id, path: duplicated.meta.path }).catch(() => undefined)
        throw error
      }
    },
  })
  const created = copy as DocumentMeta | null
  if (!saved || !created) return null
  const opened = await openImageDocument({ id: created.id, path: created.path })
  await leaveImageDocument(id)
  logger.info('图片文档已另存为', { event: 'image_document.save_as.completed', context: { sourceId: id, documentId: created.id } })
  return opened
}

/**
 * 后台释放（通用文档操作移到回收站前、助手用完后）：界面正在显示的不释放；其余写回后关闭。
 * 返回 false 表示正在编辑，不能释放。
 */
export async function releaseImageDocument(documentId: string): Promise<boolean> {
  const handle = handles.get(documentId)
  if (!handle) return true
  if (handle.isShown()) return false
  await handle.session.close()
  return true
}

/**
 * 后台（助手读写图片编辑实体）用到一份图片文档时先打开它的会话：按需解包到工作副本，
 * 修改照常空闲写回；有没写回的修改时直接接着工作副本用（不丢修改、不弹窗）。
 * 不是图片文档（画布节点、剪辑画面的内嵌文档）时什么也不做。
 */
export async function ensureImageDocumentOpenInBackground(documentId: string): Promise<void> {
  const existing = handles.get(documentId)
  if (existing && !existing.session.isEnded) return
  const { getDocumentOperations } = await import('@/features/documents/documentOperations')
  const documents = await getDocumentOperations().listDocuments({
    kind: 'image_document', container: { kind: 'any' }, includeDrafts: true, includeMissing: false,
  })
  const document = documents.find((candidate) => candidate.id === documentId)
  if (!document) return
  await openImageDocument({ id: document.id, path: document.path })
}

/** 内容是否为空（新建空白图片后没有编辑）。 */
export function isOpenImageDocumentEmpty(id: string): boolean {
  return handles.get(id)?.session.isEmpty() ?? false
}
