import { z } from 'zod'

import { documentKindRegistry, type DocumentKindDescriptor } from '@/core/documents/kinds'
import { entryNameKey, keepBothEntryName, normalizeEntryName } from '@/core/documents/naming'
import type {
  CreateDocumentRequest,
  CreateProjectRequest,
  DocumentContainerRef,
  DocumentKindId,
  DocumentIndexScanReport,
  DocumentListQuery,
  DocumentMeta,
  DocumentReadResult,
  DocumentSaveResult,
  DocumentSummary,
  DocumentTarget,
  DocumentTransferResult,
  DuplicateDocumentRequest,
  FinalizeDocumentRequest,
  FinalizeProjectRequest,
  ImportFileRequest,
  ImportFileResult,
  MoveDocumentRequest,
  NameCheckRequest,
  NameCheckResult,
  NameConflictPolicy,
  ProjectListQuery,
  ProjectSummary,
  RenameDocumentRequest,
  RenameProjectRequest,
  SaveDocumentRequest,
  SetProjectMainDocumentRequest,
} from '@/core/documents/types'

import type { DocumentOperationCommands } from './documentOperations'
import { DocumentSessionRegistry } from './documentSessionRegistry'
import type {
  DocumentConflictChoice,
  DocumentContentAdapter,
  DocumentLeaveChoice,
  DocumentSaveNamePromptInfo,
  DocumentSessionPrompter,
} from './documentSessionTypes'

/*
 * 仅供测试：假的 JSON 文档类型 + 内存里的文档命令替身（不跑主进程）。
 * 行为对齐 2.2 主进程文档仓库的约定：版本核对、内容没变不写、草稿转正、同一文件夹查重。
 */

export const TEST_DOCUMENT_ROOT = 'D:/作品/测试文档'
export const TEST_PROJECT_ROOT = 'D:/作品/项目'

export const testContentSchema = z.object({ items: z.array(z.string()) })
export type TestContent = z.infer<typeof testContentSchema>

export const testDocumentKind: DocumentKindDescriptor<TestContent> = {
  id: 'canvas',
  extension: '.henji-test',
  standaloneFolderNames: { zh: '测试文档', en: 'Test Documents' },
  untitledNames: { zh: '未命名测试', en: 'Untitled Test' },
  storage: 'json',
  version: 1,
  contentSchema: testContentSchema,
  upgradeContent: (content) => content,
  createEmptyContent: () => ({ items: [] }),
  isEmptyContent: (content) => content.items.length === 0,
  summarize: (content) => ({ items: content.items.length }),
}

export function namedError(name: string, message = name): Error {
  const error = new Error(message)
  error.name = name
  return error
}

interface StoredDocument {
  meta: DocumentMeta
  content: unknown
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

/**
 * 替身里的类型说明：'canvas' 用测试类型（会话测试沿用），其余类型用正式登记表（工具接入测试用真实内容规则）。
 */
export function fakeKindOf(kind: DocumentKindId): DocumentKindDescriptor {
  return kind === testDocumentKind.id ? testDocumentKind as unknown as DocumentKindDescriptor : documentKindRegistry.require(kind)
}

function isFakeContentEmpty(kind: DocumentKindId, content: unknown): boolean {
  const descriptor = fakeKindOf(kind)
  const parsed = descriptor.contentSchema.safeParse(content)
  return parsed.success ? descriptor.isEmptyContent(parsed.data) : false
}

export class FakeDocumentCommands implements DocumentOperationCommands {
  readonly documents = new Map<string, StoredDocument>()
  readonly projects = new Map<string, ProjectSummary>()
  readonly trashed: string[] = []
  readonly calls: string[] = []
  /** 真正写进文件的次数（unchanged 不计）。 */
  writes = 0
  activeSaves = 0
  maxConcurrentSaves = 0
  /** 下面几次 saveDocument 直接失败（模拟磁盘错误）。 */
  failSaves = 0
  /** 有值时 saveDocument 等它完成再写（模拟慢写）。 */
  saveGate: Promise<void> | null = null
  private nextId = 1
  private clock = 1_000

  seed(options: { name: string; content: unknown; draft?: boolean; folder?: string; projectId?: string; kind?: DocumentKindId; id?: string }): DocumentMeta {
    const id = options.id ?? `doc-${this.nextId++}`
    const kind = options.kind ?? testDocumentKind.id
    const folder = options.folder ?? TEST_DOCUMENT_ROOT
    const meta: DocumentMeta = {
      id,
      kind,
      name: options.name,
      path: `${folder}/${options.name}${fakeKindOf(kind).extension}`,
      container: options.projectId ? { kind: 'project', projectId: options.projectId } : { kind: 'user' },
      draft: options.draft ?? false,
      revision: 1,
      kindVersion: 1,
      createdAt: this.clock,
      updatedAt: this.clock,
    }
    this.documents.set(id, { meta, content: structuredClone(options.content) })
    return meta
  }

  seedProject(options: { name: string; draft?: boolean }): ProjectSummary {
    const id = `project-${this.nextId++}`
    const project: ProjectSummary = {
      id,
      name: options.name,
      path: `${TEST_PROJECT_ROOT}/${options.name}`,
      locale: 'zh',
      folders: { generated: '生成结果', materials: '素材' },
      draft: options.draft ?? false,
      external: false,
      missing: false,
      createdAt: this.clock,
      mainVideoEditId: null,
      documentCount: 0,
    }
    this.projects.set(id, project)
    return project
  }

  /** 模拟别处改了文件（版本加一）。 */
  modifyExternally(id: string, content: TestContent): void {
    const stored = this.require(id)
    stored.content = structuredClone(content)
    stored.meta = { ...stored.meta, revision: stored.meta.revision + 1, updatedAt: ++this.clock }
  }

  stored(id: string): StoredDocument | undefined {
    return this.documents.get(id)
  }

  async readDocument(target: DocumentTarget): Promise<DocumentReadResult> {
    this.calls.push('readDocument')
    const stored = this.require(target.id)
    return { meta: stored.meta, content: structuredClone(stored.content), missingPaths: [], externalDirectories: [], unresolved: [] }
  }

  async createDocument(request: CreateDocumentRequest): Promise<DocumentReadResult> {
    this.calls.push('createDocument')
    const name = request.name ?? this.untitledName(request.kind)
    // 对齐主进程：给了名字按用户输入处理，同一文件夹重名报错不加后缀
    const folder = request.container.kind === 'project' ? this.projects.get(request.container.projectId)?.path ?? TEST_DOCUMENT_ROOT : TEST_DOCUMENT_ROOT
    if (request.name !== undefined && this.isTaken(folder, request.name, '')) throw namedError('DocumentNameConflictError', '已有同名文件。')
    if (request.id !== undefined && this.documents.has(request.id)) throw namedError('DocumentLocationError', '已有同一 ID 的文档。')
    const meta = this.seed({
      id: request.id,
      kind: request.kind,
      name,
      content: request.content ?? fakeKindOf(request.kind).createEmptyContent(),
      draft: request.draft ?? request.name === undefined,
      projectId: request.container.kind === 'project' ? request.container.projectId : undefined,
      folder: request.container.kind === 'project' ? this.projects.get(request.container.projectId)?.path : undefined,
    })
    return this.readDocument({ id: meta.id })
  }

  async saveDocument(request: SaveDocumentRequest): Promise<DocumentSaveResult> {
    this.calls.push('saveDocument')
    this.activeSaves += 1
    this.maxConcurrentSaves = Math.max(this.maxConcurrentSaves, this.activeSaves)
    try {
      if (this.saveGate) await this.saveGate
      if (this.failSaves > 0) {
        this.failSaves -= 1
        throw new Error('磁盘已满')
      }
      const stored = this.require(request.target.id)
      if (!request.force && stored.meta.revision !== request.expectedRevision) throw namedError('DocumentRevisionConflictError', '版本冲突')
      if (JSON.stringify(stored.content) === JSON.stringify(request.content)) return { meta: stored.meta, unchanged: true }
      stored.content = structuredClone(request.content)
      stored.meta = { ...stored.meta, revision: stored.meta.revision + 1, updatedAt: ++this.clock }
      this.writes += 1
      return { meta: stored.meta, unchanged: false }
    } finally {
      this.activeSaves -= 1
    }
  }

  async finalizeDocument(request: FinalizeDocumentRequest): Promise<DocumentTransferResult> {
    this.calls.push('finalizeDocument')
    const stored = this.require(request.target.id)
    const folder = request.folder ?? folderOf(stored.meta.path)
    if (this.isTaken(folder, request.name, stored.meta.id)) throw namedError('DocumentNameConflictError', '已有同名文件。')
    const moved = folder !== folderOf(stored.meta.path)
    stored.meta = {
      ...stored.meta,
      name: request.name,
      path: `${folder}/${request.name}${fakeKindOf(stored.meta.kind).extension}`,
      draft: false,
      // 换位置时复制素材、改写引用，revision 加一
      revision: moved ? stored.meta.revision + 1 : stored.meta.revision,
    }
    if (moved && stored.meta.kind === testDocumentKind.id) stored.content = { items: [...(stored.content as TestContent).items, '已复制素材'] }
    return { meta: stored.meta, copiedFiles: moved ? 1 : 0, missingPaths: [] }
  }

  async trashDocument(target: DocumentTarget): Promise<void> {
    this.calls.push('trashDocument')
    this.require(target.id)
    this.documents.delete(target.id)
    this.trashed.push(target.id)
  }

  async deleteEmptyDraft(target: DocumentTarget): Promise<void> {
    this.calls.push('deleteEmptyDraft')
    const stored = this.require(target.id)
    if (!stored.meta.draft || !isFakeContentEmpty(stored.meta.kind, stored.content)) throw namedError('DocumentNotEmptyError', '草稿不为空。')
    this.documents.delete(target.id)
  }

  /** 对齐主进程：只有找不到文件（标为缺失）的文档能从列表移除，文件还在时报 DocumentLocationError。 */
  async forgetDocument(docId: string): Promise<void> {
    this.calls.push('forgetDocument')
    if (!this.documents.has(docId)) return
    if (!this.missingIds.has(docId)) throw namedError('DocumentLocationError', '这份文档的文件还在，不能只从列表移除。')
    this.documents.delete(docId)
    this.missingIds.delete(docId)
  }

  async listDocuments(query: DocumentListQuery = {}): Promise<DocumentSummary[]> {
    this.calls.push('listDocuments')
    return [...this.documents.values()]
      .filter(({ meta }) => !query.kind || meta.kind === query.kind)
      .filter(({ meta }) => query.includeDrafts !== false || !meta.draft)
      .filter(({ meta }) => query.includeMissing !== false || !this.missingIds.has(meta.id))
      .filter(({ meta }) => {
        const filter = query.container ?? { kind: 'any' }
        if (filter.kind === 'any') return true
        if (filter.kind === 'user') return meta.container.kind === 'user'
        return meta.container.kind === 'project' && meta.container.projectId === filter.projectId
      })
      .map(({ meta }) => ({
        ...meta,
        projectName: meta.container.kind === 'project' ? this.projects.get(meta.container.projectId)?.name ?? null : null,
        external: false,
        missing: this.missingIds.has(meta.id),
        fileModifiedAt: meta.updatedAt,
        sizeBytes: 1,
        coverPath: null,
        summary: {},
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async checkName(request: NameCheckRequest): Promise<NameCheckResult> {
    this.calls.push('checkName')
    const check = normalizeEntryName(request.name)
    if (!check.ok) return { status: 'invalid', reason: check.reason, message: check.message }
    const location = request.location
    let folder: string
    let self: string | undefined
    if ('folder' in location) folder = location.folder
    else if ('renaming' in location) {
      folder = folderOf(location.renaming)
      self = location.renaming
    } else folder = request.subject.type === 'project' ? TEST_PROJECT_ROOT : TEST_DOCUMENT_ROOT
    if (folder.startsWith('Z:')) return { status: 'invalid', reason: 'location', message: '位置不可用。' }
    const suffix = request.subject.type === 'project' ? '' : fakeKindOf(request.subject.kind).extension
    const path = `${folder}/${check.name}${suffix}`
    const existing = this.entryPaths().find((entry) => entry !== self && folderOf(entry) === folder
      && entryNameKey(entry.slice(folder.length + 1)) === entryNameKey(`${check.name}${suffix}`))
    return existing
      ? { status: 'duplicate', name: check.name, path, existingPath: existing }
      : { status: 'available', name: check.name, path }
  }

  async createProject(request?: CreateProjectRequest): Promise<ProjectSummary> {
    this.calls.push('createProject')
    // 对齐主进程：自动名“未命名项目 N”在“项目”文件夹里顺延
    let name = request?.name
    for (let index = 1; name === undefined; index += 1) {
      const candidate = `未命名项目 ${index}`
      if (![...this.projects.values()].some((project) => entryNameKey(project.name) === entryNameKey(candidate))) name = candidate
    }
    return this.seedProject({ name, draft: request?.name === undefined })
  }

  async finalizeProject(request: FinalizeProjectRequest): Promise<ProjectSummary> {
    this.calls.push('finalizeProject')
    const project = this.projects.get(request.projectId)
    if (!project) throw namedError('ProjectNotFoundError')
    const parent = request.parentFolder ?? folderOf(project.path)
    const path = `${parent}/${request.name}`
    const next = { ...project, name: request.name, path, draft: false, external: Boolean(request.parentFolder) }
    this.projects.set(project.id, next)
    for (const stored of this.documents.values()) {
      if (stored.meta.container.kind === 'project' && stored.meta.container.projectId === project.id) {
        stored.meta = { ...stored.meta, path: stored.meta.path.replace(project.path, path) }
      }
    }
    return next
  }

  async trashProject(projectId: string): Promise<void> {
    this.calls.push('trashProject')
    this.projects.delete(projectId)
    for (const [id, stored] of this.documents) {
      if (stored.meta.container.kind === 'project' && stored.meta.container.projectId === projectId) this.documents.delete(id)
    }
    this.trashed.push(projectId)
  }

  async listProjects(query: ProjectListQuery = {}): Promise<ProjectSummary[]> {
    this.calls.push('listProjects')
    return [...this.projects.values()].filter((project) => query.includeDrafts !== false || !project.draft)
  }

  // ---- 通用文档操作（2.5）用到的命令：行为对齐主进程仓库（用户输入的名字重名报错，keepBoth 加序号） ----

  readonly revealed: string[] = []
  refreshCount = 0

  async renameDocument(request: RenameDocumentRequest): Promise<DocumentMeta> {
    this.calls.push('renameDocument')
    const stored = this.require(request.target.id)
    const check = normalizeEntryName(request.name)
    if (!check.ok) throw namedError('DocumentNameInvalidError', check.message)
    const folder = folderOf(stored.meta.path)
    if (this.isTaken(folder, check.name, stored.meta.id)) throw namedError('DocumentNameConflictError', '已有同名文件。')
    stored.meta = { ...stored.meta, name: check.name, path: `${folder}/${check.name}${fakeKindOf(stored.meta.kind).extension}` }
    return stored.meta
  }

  async moveDocument(request: MoveDocumentRequest): Promise<DocumentTransferResult> {
    this.calls.push('moveDocument')
    const stored = this.require(request.target.id)
    const folder = this.folderFor(request.container)
    const name = this.pickName(folder, stored.meta.name, stored.meta.id, request.onConflict ?? 'fail')
    const projectChanged = JSON.stringify(stored.meta.container) !== JSON.stringify(request.container)
    stored.meta = {
      ...stored.meta,
      name,
      container: request.container,
      path: `${folder}/${name}${fakeKindOf(stored.meta.kind).extension}`,
      // 换容器时复制素材、改写引用，revision 加一（对齐主进程）
      revision: projectChanged ? stored.meta.revision + 1 : stored.meta.revision,
    }
    return { meta: stored.meta, copiedFiles: projectChanged ? 1 : 0, missingPaths: [] }
  }

  async duplicateDocument(request: DuplicateDocumentRequest): Promise<DocumentTransferResult> {
    this.calls.push('duplicateDocument')
    const stored = this.require(request.target.id)
    const folder = folderOf(stored.meta.path)
    const name = this.pickName(folder, request.name ?? stored.meta.name, '', request.onConflict ?? 'fail')
    const copy = this.seed({
      kind: stored.meta.kind,
      name,
      content: structuredClone(stored.content),
      folder,
      projectId: stored.meta.container.kind === 'project' ? stored.meta.container.projectId : undefined,
    })
    return { meta: copy, copiedFiles: 0, missingPaths: [] }
  }

  async revealDocument(target: DocumentTarget): Promise<void> {
    this.calls.push('revealDocument')
    this.require(target.id)
    this.revealed.push(target.id)
  }

  async refreshIndex(): Promise<DocumentIndexScanReport> {
    this.calls.push('refreshIndex')
    this.refreshCount += 1
    return { startedAt: 0, durationMs: 0, projects: this.projects.size, documents: this.documents.size, readDocuments: 0, reassignedIds: 0, moved: 0, missing: 0, invalid: 0 }
  }

  async renameProject(request: RenameProjectRequest): Promise<ProjectSummary> {
    this.calls.push('renameProject')
    const project = this.projects.get(request.projectId)
    if (!project) throw namedError('ProjectNotFoundError')
    if ([...this.projects.values()].some((other) => other.id !== project.id && entryNameKey(other.name) === entryNameKey(request.name))) {
      throw namedError('DocumentNameConflictError', '已有同名文件夹。')
    }
    const path = `${folderOf(project.path)}/${request.name}`
    const next = { ...project, name: request.name, path }
    this.projects.set(project.id, next)
    for (const stored of this.documents.values()) {
      if (stored.meta.container.kind === 'project' && stored.meta.container.projectId === project.id) {
        stored.meta = { ...stored.meta, path: stored.meta.path.replace(project.path, path) }
      }
    }
    return next
  }

  async revealProject(projectId: string): Promise<void> {
    this.calls.push('revealProject')
    this.revealed.push(projectId)
  }

  /** 收集素材的替身：把 collectMapping 里登记的原位置换成项目“素材”里的新位置（对齐主进程：有变化才加版本）。 */
  collectMapping = new Map<string, string>()
  readonly imported: ImportFileRequest[] = []

  async collectDocumentMedia(target: DocumentTarget): Promise<DocumentTransferResult> {
    this.calls.push('collectDocumentMedia')
    const stored = this.require(target.id)
    const before = JSON.stringify(stored.content)
    let after = before
    for (const [from, to] of this.collectMapping) after = after.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1))
    if (after === before) return { meta: stored.meta, copiedFiles: 0, missingPaths: [] }
    stored.content = JSON.parse(after) as unknown
    stored.meta = { ...stored.meta, revision: stored.meta.revision + 1, updatedAt: ++this.clock }
    return { meta: stored.meta, copiedFiles: this.collectMapping.size, missingPaths: [] }
  }

  /** 对齐主进程：已在容器里的文件原样返回，否则放进容器的“生成结果 / 素材”。 */
  async importFile(request: ImportFileRequest): Promise<ImportFileResult> {
    this.calls.push('importFile')
    this.imported.push(request)
    const root = request.container.kind === 'project' ? this.projects.get(request.container.projectId)?.path : TEST_DOCUMENT_ROOT
    if (!root) throw namedError('ProjectNotFoundError')
    const source = request.sourcePath.replaceAll('\\', '/')
    if (source.startsWith(`${root}/`)) return { path: request.sourcePath, copied: false }
    const folder = request.folder === 'generated' ? '生成结果' : '素材'
    return { path: `${root}/${folder}/${source.slice(source.lastIndexOf('/') + 1)}`, copied: true }
  }

  async setProjectMainDocument(request: SetProjectMainDocumentRequest): Promise<ProjectSummary> {
    this.calls.push('setProjectMainDocument')
    const project = this.projects.get(request.projectId)
    if (!project) throw namedError('ProjectNotFoundError')
    if (request.documentId !== null) {
      const document = this.documents.get(request.documentId)
      if (!document || document.meta.kind !== 'video_edit' || document.meta.container.kind !== 'project' || document.meta.container.projectId !== project.id) {
        throw namedError('DocumentLocationError', '主剪辑必须是这个项目里的剪辑。')
      }
    }
    const next = { ...project, mainVideoEditId: request.documentId }
    this.projects.set(project.id, next)
    return next
  }

  async registerExternalProject(folderPath: string): Promise<ProjectSummary> {
    this.calls.push('registerExternalProject')
    const existing = [...this.projects.values()].find((project) => project.path === folderPath)
    if (existing) return existing
    const name = folderPath.slice(folderPath.replaceAll('\\', '/').lastIndexOf('/') + 1)
    const project = this.seedProject({ name })
    const next = { ...project, path: folderPath, external: true }
    this.projects.set(project.id, next)
    return next
  }

  async forgetExternalLocation(folderPath: string): Promise<void> {
    this.calls.push('forgetExternalLocation')
    for (const [id, project] of this.projects) if (project.path === folderPath && project.external) this.projects.delete(id)
  }

  /** 把一份文档标为缺失（模拟文件被删或外部盘不在）。 */
  missingIds = new Set<string>()

  private folderFor(container: DocumentContainerRef): string {
    if (container.kind === 'user') return TEST_DOCUMENT_ROOT
    const project = this.projects.get(container.projectId)
    if (!project) throw namedError('ProjectNotFoundError')
    return project.path
  }

  private pickName(folder: string, name: string, selfId: string, policy: NameConflictPolicy): string {
    if (!this.isTaken(folder, name, selfId)) return name
    if (policy === 'fail') throw namedError('DocumentNameConflictError', '目标位置已有同名文件。')
    return keepBothEntryName(name, (candidate) => this.isTaken(folder, candidate, selfId))
  }

  private entryPaths(): string[] {
    return [...[...this.documents.values()].map(({ meta }) => meta.path), ...[...this.projects.values()].map((project) => project.path)]
  }

  private isTaken(folder: string, name: string, selfId: string): boolean {
    return [...this.documents.values()].some(({ meta }) => meta.id !== selfId && folderOf(meta.path) === folder && entryNameKey(meta.name) === entryNameKey(name))
  }

  private untitledName(kind: DocumentKindId = testDocumentKind.id): string {
    for (let index = 1; ; index += 1) {
      const name = `${fakeKindOf(kind).untitledNames.zh} ${index}`
      if (![...this.documents.values()].some(({ meta }) => meta.name === name)) return name
    }
  }

  private require(id: string): StoredDocument {
    const stored = this.documents.get(id)
    if (!stored) throw namedError('DocumentNotFoundError', '找不到文档。')
    return stored
  }
}

export interface ScriptedPrompter extends DocumentSessionPrompter {
  leaveChoices: DocumentLeaveChoice[]
  conflictChoices: DocumentConflictChoice[]
  saveName: ((info: DocumentSaveNamePromptInfo) => Promise<boolean>) | null
  log: string[]
}

/** 按脚本回答的提示替身。 */
export function createScriptedPrompter(): ScriptedPrompter {
  const prompter: ScriptedPrompter = {
    leaveChoices: [],
    conflictChoices: [],
    saveName: null,
    log: [],
    chooseLeaveAction: async (info) => {
      prompter.log.push(`leave:${info.subject}:${info.name}`)
      return prompter.leaveChoices.shift() ?? 'cancel'
    },
    askSaveName: async (info) => {
      prompter.log.push(`saveName:${info.initialName}`)
      return prompter.saveName ? await prompter.saveName(info) : false
    },
    resolveConflict: async (info) => {
      prompter.log.push(`conflict:${info.name}`)
      return prompter.conflictChoices.shift() ?? 'later'
    },
  }
  return prompter
}

export function createTestRegistry(commands = new FakeDocumentCommands(), prompter = createScriptedPrompter()): {
  registry: DocumentSessionRegistry
  commands: FakeDocumentCommands
  prompter: ScriptedPrompter
} {
  const registry = new DocumentSessionRegistry({
    commands,
    prompter,
    kinds: { require: () => testDocumentKind as unknown as DocumentKindDescriptor },
    timing: { autosaveDelayMs: 800, idleCommitDelayMs: 5000, retryBaseDelayMs: 2000, retryMaxDelayMs: 8000 },
  })
  return { registry, commands, prompter }
}

/** 模拟工具实例：内容可变，改动时通知会话。 */
export class TestToolInstance implements DocumentContentAdapter<TestContent> {
  content: TestContent
  received: TestContent[] = []
  private readonly listeners = new Set<() => void>()

  constructor(content: TestContent) {
    this.content = structuredClone(content)
  }

  edit(item: string): void {
    this.content = { items: [...this.content.items, item] }
    for (const listener of this.listeners) listener()
  }

  clear(): void {
    this.content = { items: [] }
    for (const listener of this.listeners) listener()
  }

  touch(): void {
    for (const listener of this.listeners) listener()
  }

  getContent(): TestContent {
    return this.content
  }

  receiveContent(content: TestContent): void {
    this.content = structuredClone(content)
    this.received.push(this.content)
    // 工具通常会在换内容时发出变更通知；会话应忽略这一次
    for (const listener of this.listeners) listener()
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange)
    return () => { this.listeners.delete(onChange) }
  }
}
