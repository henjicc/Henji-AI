import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createDocumentKindRegistry, defineSkeletonDocumentKind, DOCUMENT_KINDS, type DocumentKindRegistry } from '../../../../src/core/documents/kinds'
import type { FolderLocale } from '../../../../src/core/documents/types'
import { pathKey, type PathStyle } from '../../../../src/core/storage/pathSyntax'
import type { MainLogger } from '../logging/main-logger'
import type {
  DocumentCatalog,
  ExternalLocation,
  ExternalLocationKind,
  IndexedDocument,
  IndexedDocumentFilter,
  IndexedProject,
} from './catalog'
import { createDocumentServices, type DocumentServices } from './create-services'
import type { PackageAdapterRegistry } from './package-adapters'

/*
 * 文档底座单元测试的共用夹具（只被 *.test.ts 引用）：临时作品目录、内存版作品索引、假的回收站。
 * 内存索引只复刻 DocumentCatalog 的存储语义（按 ID 写入、同一位置唯一）；
 * SQLite 正式实现由原生测试 index.native.test.ts 覆盖。
 */

export const HOST_STYLE: PathStyle = process.platform === 'win32' ? 'win32' : 'posix'

function keyOf(target: string): string {
  const key = pathKey(HOST_STYLE, target)
  if (key === null) throw new Error(`不是绝对路径：${target}`)
  return key
}

export class MemoryDocumentCatalog implements DocumentCatalog {
  readonly documents = new Map<string, IndexedDocument>()
  readonly projects = new Map<string, IndexedProject>()
  readonly locations = new Map<string, ExternalLocation>()

  getDocument(id: string): IndexedDocument | null {
    return this.documents.get(id) ?? null
  }

  getDocumentByPath(target: string): IndexedDocument | null {
    const key = pathKey(HOST_STYLE, target)
    return [...this.documents.values()].find((row) => keyOf(row.path) === key) ?? null
  }

  listDocuments(filter: IndexedDocumentFilter = {}): IndexedDocument[] {
    return [...this.documents.values()]
      .filter((row) => !filter.kind || row.kind === filter.kind)
      .filter((row) => filter.projectId === undefined || row.projectId === filter.projectId)
      .filter((row) => filter.includeDrafts !== false || !row.draft)
      .filter((row) => filter.includeMissing !== false || !row.missing)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
  }

  upsertDocument(row: IndexedDocument): void {
    const key = keyOf(row.path)
    for (const [id, existing] of this.documents) if (id !== row.id && keyOf(existing.path) === key) this.documents.delete(id)
    this.documents.set(row.id, { ...row })
  }

  removeDocument(id: string): void {
    this.documents.delete(id)
  }

  rebaseDocuments(oldRoot: string, newRoot: string): void {
    const prefix = `${keyOf(oldRoot)}/`
    for (const row of this.documents.values()) {
      if (!keyOf(row.path).startsWith(prefix)) continue
      row.path = path.join(newRoot, path.relative(oldRoot, row.path))
    }
  }

  getProject(id: string): IndexedProject | null {
    return this.projects.get(id) ?? null
  }

  getProjectByPath(target: string): IndexedProject | null {
    const key = pathKey(HOST_STYLE, target)
    return [...this.projects.values()].find((row) => keyOf(row.path) === key) ?? null
  }

  listProjects(): IndexedProject[] {
    return [...this.projects.values()]
  }

  upsertProject(row: IndexedProject): void {
    const key = keyOf(row.path)
    for (const [id, existing] of this.projects) if (id !== row.id && keyOf(existing.path) === key) this.projects.delete(id)
    this.projects.set(row.id, { ...row, folders: { ...row.folders } })
  }

  removeProject(id: string): void {
    for (const [documentId, row] of this.documents) if (row.projectId === id) this.documents.delete(documentId)
    this.projects.delete(id)
  }

  listExternalLocations(): ExternalLocation[] {
    return [...this.locations.values()]
  }

  addExternalLocation(target: string, kind: ExternalLocationKind): void {
    this.locations.set(keyOf(target), { path: target, kind, addedAt: Date.now() })
  }

  removeExternalLocation(target: string): void {
    this.locations.delete(keyOf(target))
  }

  clearRebuildableIndex(): void {
    this.documents.clear()
    this.projects.clear()
  }
}

export function silentLogger(): MainLogger {
  const noop = (): void => undefined
  return { trace: noop, debug: noop, info: noop, warn: noop, error: noop }
}

export interface TestEnvironment {
  base: string
  workRoot: string
  programRoot: string
  outside: string
  catalog: DocumentCatalog
  services: DocumentServices
  trashed: string[]
  revealed: string[]
  granted: string[]
  /** 被设为隐藏的内部文件夹。 */
  hidden: string[]
  /** 测试用的 ID 生成器：可预测，便于断言。 */
  ids: string[]
  cleanup(): Promise<void>
}

export interface TestEnvironmentOptions {
  locale?: FolderLocale
  catalog?: DocumentCatalog
  kinds?: DocumentKindRegistry
  adapters?: PackageAdapterRegistry
}

/**
 * 通用仓库测试用的类型登记：画布（3.4 起有真实内容规则）在这里换成内容任意的骨架类型，
 * 仓库、索引与项目测试照旧拿它当“任意 JSON 文档”；其余类型用正式登记。
 */
export const GENERIC_TEST_DOCUMENT_KINDS: DocumentKindRegistry = createDocumentKindRegistry(DOCUMENT_KINDS.map((kind) => (
  kind.id === 'canvas'
    ? defineSkeletonDocumentKind({ id: kind.id, extension: kind.extension, standaloneFolderNames: kind.standaloneFolderNames, untitledNames: kind.untitledNames, storage: kind.storage })
    : kind
)))

/** 在系统临时目录里建一套作品目录、程序目录与“外部”位置，不碰用户真实目录。 */
export function createTestEnvironment(options: TestEnvironmentOptions = {}): TestEnvironment {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-documents-'))
  const locale = options.locale ?? 'zh'
  const workRoot = path.join(base, locale === 'zh' ? '痕迹AI' : 'Henji AI')
  const programRoot = path.join(base, 'program', 'Henji-AI')
  const outside = path.join(base, '外部 位置')
  const folders = locale === 'zh'
    ? { projects: '项目', generated: '生成结果', uploads: '上传素材' }
    : { projects: 'Projects', generated: 'Generated', uploads: 'Uploads' }
  for (const folder of [workRoot, programRoot, outside, ...Object.values(folders).map((name) => path.join(workRoot, name))]) {
    fs.mkdirSync(folder, { recursive: true })
  }
  const catalog = options.catalog ?? new MemoryDocumentCatalog()
  const trashed: string[] = []
  const revealed: string[] = []
  const granted: string[] = []
  const hidden: string[] = []
  const ids: string[] = []
  let counter = 0
  const services = createDocumentServices({
    style: HOST_STYLE,
    layout: () => ({
      root: workRoot,
      locale,
      projectsDir: path.join(workRoot, folders.projects),
      generatedDir: path.join(workRoot, folders.generated),
      uploadsDir: path.join(workRoot, folders.uploads),
    }),
    programRoots: () => [programRoot],
    catalog,
    storeDirectory: path.join(programRoot, 'DocumentStore'),
    logger: () => silentLogger(),
    trashItem: async (target) => {
      trashed.push(target)
      await fsp.rm(target, { recursive: true, force: true })
    },
    showItemInFolder: (target) => { revealed.push(target) },
    grantMediaRoots: (directories) => { granted.push(...directories) },
    renderCover: async (sources) => ({ bytes: Buffer.from(`cover:${sources.length}`), selected: [...sources] }),
    hideDirectory: async (directory) => { hidden.push(directory) },
    kinds: options.kinds ?? GENERIC_TEST_DOCUMENT_KINDS,
    adapters: options.adapters,
    randomId: () => {
      counter += 1
      const id = `id-${String(counter).padStart(4, '0')}`
      ids.push(id)
      return id
    },
  })
  return {
    base, workRoot, programRoot, outside, catalog, services, trashed, revealed, granted, hidden, ids,
    cleanup: async () => { await fsp.rm(base, { recursive: true, force: true }) },
  }
}

/** 列出文件夹（含子文件夹）里的全部文件，返回相对路径（正斜杠）。 */
export async function listFiles(root: string): Promise<string[]> {
  const result: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(target)
      else result.push(path.relative(root, target).split(path.sep).join('/'))
    }
  }
  await walk(root)
  return result.sort()
}
