import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

import type { DocumentKindDescriptor } from '../../../../src/core/documents/kinds'
import {
  buildProjectManifest,
  inferProjectLocale,
  INTERNAL_FOLDER_NAME,
  parseProjectManifestText,
  projectManifestContract,
  PROJECT_MANIFEST_FILE_NAME,
  serializeProjectManifest,
  type ProjectManifest,
} from '../../../../src/core/documents/projectManifest'
import type { DocumentContainerRef, FolderLocale } from '../../../../src/core/documents/types'
import type { LocationContext } from '../../../../src/core/storage/locationCodec'
import { isPathInside, samePath, type PathStyle } from '../../../../src/core/storage/pathSyntax'
import { writeBufferAtomically } from '../fs/atomic-file'
import type { MainLogger } from '../logging/main-logger'
import type { DocumentCatalog, IndexedProject } from './catalog'
import { DocumentLocationError, errorCode, ProjectNotFoundError } from './errors'
import { backupBeforePersistenceUpgrade } from '../persistence/file-upgrade'

/*
 * 作品目录与项目容器（实施方案 2.3）：
 *
 * 文档/痕迹AI/
 *   项目/<项目名>/             项目文件夹：各类文档、生成结果/、素材/、.henji/project.json（隐藏）
 *   画布/ 口播/ 镜头参考/ 图片文档/   不属于任何项目的文档（用到时才建）
 *   生成结果/ 上传素材/ 导出/ 助手技能/  同 1.1
 *   .henji/                    作品目录自己的内部资源（用到时才建，隐藏）
 *
 * 文档所在容器由文件位置决定：向上找到的第一个含 `.henji/project.json` 的文件夹就是它的项目，
 * 找不到就是作品目录（包括另存到作品目录之外的独立文档）。这条判断只看磁盘，不依赖索引是否最新。
 */

export interface WorkspaceLayout {
  /** 作品目录。 */
  root: string
  /** 作品目录首次创建时确定的文件夹语言。 */
  locale: FolderLocale
  /** 1.1 的“项目”文件夹。 */
  projectsDir: string
  /** 作品目录的“生成结果”，独立文档的生成结果放这里。 */
  generatedDir: string
  /** 作品目录的“上传素材”，独立文档复制进来的素材放这里。 */
  uploadsDir: string
  /** 作品目录的“导出”：没有另选位置的单文件包放这里（4.1）。 */
  exportsDir: string
}

export interface ResolvedContainer {
  ref: DocumentContainerRef
  /** 容器根：项目文件夹或作品目录。 */
  root: string
  locale: FolderLocale
  /** 项目说明；作品目录为 null。 */
  manifest: ProjectManifest | null
  generatedDir: string
  materialsDir: string
}

export interface DocumentWorkspaceOptions {
  style: PathStyle
  layout: () => WorkspaceLayout
  /** 不该写进文档的根（程序目录）。 */
  programRoots: () => readonly string[]
  catalog: DocumentCatalog
  kinds: { list(): readonly DocumentKindDescriptor[] }
  logger: MainLogger
  /** 把内部文件夹设为隐藏；Windows 默认用 attrib，失败只记日志。 */
  hideDirectory?: (directory: string) => Promise<void>
  now?: () => Date
  randomId?: () => string
}

const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_PARENT_LEVELS = 64

export class DocumentWorkspace {
  readonly style: PathStyle

  constructor(private readonly options: DocumentWorkspaceOptions) {
    this.style = options.style
  }

  get catalog(): DocumentCatalog {
    return this.options.catalog
  }

  layout(): WorkspaceLayout {
    return this.options.layout()
  }

  programRoots(): readonly string[] {
    return this.options.programRoots()
  }

  now(): Date {
    return this.options.now?.() ?? new Date()
  }

  randomId(): string {
    return this.options.randomId?.() ?? randomUUID()
  }

  // ==================== 内部文件夹与项目说明 ====================

  /**
   * `<容器>/.henji`：用到时才建，新建时在 Windows 上设为隐藏（失败只记日志）。
   * 已存在的不再改属性：被用户删掉后重建会重新隐藏，用户自己取消隐藏的保持原样。
   */
  async ensureInternalFolder(containerRoot: string): Promise<string> {
    const directory = path.join(containerRoot, INTERNAL_FOLDER_NAME)
    const existed = await fsp.stat(directory).then((stat) => stat.isDirectory(), () => false)
    if (existed) return directory
    await fsp.mkdir(directory, { recursive: true })
    try {
      await this.options.hideDirectory?.(directory)
    } catch (error) {
      this.options.logger.warn('内部文件夹未能设为隐藏', {
        event: 'documents.workspace.hide_failed',
        context: { directory },
        error,
      })
    }
    return directory
  }

  manifestPath(projectRoot: string): string {
    return path.join(projectRoot, INTERNAL_FOLDER_NAME, PROJECT_MANIFEST_FILE_NAME)
  }

  /** 读项目说明；文件不存在返回 null，内容损坏时抛 ProjectManifestError。 */
  async readManifest(projectRoot: string): Promise<ProjectManifest | null> {
    let text: string
    try {
      const stat = await fsp.stat(this.manifestPath(projectRoot))
      if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return null
      text = await fsp.readFile(this.manifestPath(projectRoot), 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return null
      throw error
    }
    let raw: unknown
    try { raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown }
    catch { return parseProjectManifestText(text) }
    const backupPath = raw && typeof raw === 'object' && 'version' in raw ? await backupBeforePersistenceUpgrade(this.manifestPath(projectRoot), projectManifestContract(), typeof raw.version === 'number' ? raw.version : 0, text) : undefined
    return parseProjectManifestText(text, backupPath)
  }

  async writeManifest(projectRoot: string, manifest: ProjectManifest): Promise<void> {
    await this.ensureInternalFolder(projectRoot)
    await writeBufferAtomically(this.manifestPath(projectRoot), Buffer.from(serializeProjectManifest(manifest), 'utf8'))
  }

  /**
   * 读项目说明；没有说明的文件夹（手动建的、拷来的旧文件夹）按已有子文件夹推断语言后补写一份。
   */
  async ensureManifest(projectRoot: string): Promise<{ manifest: ProjectManifest; created: boolean }> {
    const existing = await this.readManifest(projectRoot)
    if (existing) return { manifest: existing, created: false }
    const entries = await fsp.readdir(projectRoot).catch(() => [] as string[])
    const manifest = buildProjectManifest({
      id: this.randomId(),
      createdAt: this.now().toISOString(),
      locale: inferProjectLocale(entries, this.layout().locale),
      draft: false,
    })
    await this.writeManifest(projectRoot, manifest)
    this.options.logger.info('已为项目文件夹补写项目说明', {
      event: 'documents.workspace.manifest_created',
      context: { projectRoot, projectId: manifest.id },
    })
    return { manifest, created: true }
  }

  /** 从 directory（含）向上找含项目说明的文件夹。 */
  async findProjectRoot(directory: string): Promise<{ root: string; manifest: ProjectManifest } | null> {
    let current = path.resolve(directory)
    for (let level = 0; level < MAX_PARENT_LEVELS; level += 1) {
      const manifest = await this.readManifest(current)
      if (manifest) return { root: current, manifest }
      const parent = path.dirname(current)
      if (parent === current) return null
      current = parent
    }
    return null
  }

  // ==================== 容器 ====================

  private userContainer(layout = this.layout()): ResolvedContainer {
    return {
      ref: { kind: 'user' },
      root: layout.root,
      locale: layout.locale,
      manifest: null,
      generatedDir: layout.generatedDir,
      materialsDir: layout.uploadsDir,
    }
  }

  private projectContainer(root: string, manifest: ProjectManifest): ResolvedContainer {
    return {
      ref: { kind: 'project', projectId: manifest.id },
      root,
      locale: manifest.locale,
      manifest,
      generatedDir: path.join(root, manifest.folders.generated),
      materialsDir: path.join(root, manifest.folders.materials),
    }
  }

  /** 按引用解析容器；项目以索引里的位置为准，并核对磁盘上的项目说明。 */
  async resolveContainer(ref: DocumentContainerRef): Promise<ResolvedContainer> {
    if (ref.kind === 'user') return this.userContainer()
    const project = this.catalog.getProject(ref.projectId)
    if (!project) throw new ProjectNotFoundError(ref.projectId)
    const manifest = await this.readManifest(project.path).catch(() => null)
    if (!manifest || manifest.id !== ref.projectId) throw new ProjectNotFoundError(ref.projectId)
    return this.projectContainer(project.path, manifest)
  }

  /** 文件所在容器（只看磁盘）。 */
  async containerForPath(filePath: string): Promise<ResolvedContainer> {
    return await this.containerForFolder(path.dirname(filePath))
  }

  /** 放进这个文件夹的文档属于哪个容器（只看磁盘）。 */
  async containerForFolder(folder: string): Promise<ResolvedContainer> {
    const found = await this.findProjectRoot(folder)
    return found ? this.projectContainer(found.root, found.manifest) : this.userContainer()
  }

  /** 已读到项目说明的项目文件夹 → 容器（扫描时用，不再查磁盘）。 */
  containerOfProject(root: string, manifest: ProjectManifest): ResolvedContainer {
    return this.projectContainer(root, manifest)
  }

  /** 作品目录容器。 */
  userContainerNow(): ResolvedContainer {
    return this.userContainer()
  }

  /** 项目索引行：名称就是文件夹名；external 表示不在作品目录的“项目”文件夹里。 */
  async describeProject(root: string, manifest: ProjectManifest): Promise<IndexedProject> {
    const [folder, manifestStat] = await Promise.all([
      fsp.stat(root).catch(() => null),
      fsp.stat(this.manifestPath(root)).catch(() => null),
    ])
    return {
      id: manifest.id,
      path: root,
      name: path.basename(root),
      locale: manifest.locale,
      folders: { ...manifest.folders },
      draft: manifest.draft === true,
      mainVideoEditId: manifest.mainVideoEditId ?? null,
      createdAt: Date.parse(manifest.createdAt) || 0,
      external: !samePath(this.style, path.dirname(root), this.layout().projectsDir),
      missing: false,
      manifestModifiedAt: manifestStat?.mtimeMs ?? 0,
      manifestSize: manifestStat?.size ?? 0,
      folderCreatedAt: folder?.birthtimeMs ?? 0,
    }
  }

  /** 独立存放的类型文件夹（作品目录下，按作品目录语言命名）。 */
  standaloneFolder(kind: DocumentKindDescriptor): string {
    if (!kind.standaloneFolderNames) throw new DocumentLocationError('这种文档只能放在项目里。')
    const layout = this.layout()
    return path.join(layout.root, kind.standaloneFolderNames[layout.locale])
  }

  /** 新建、移入时文档的默认文件夹：项目文件夹，或作品目录下的类型文件夹。 */
  defaultDocumentFolder(kind: DocumentKindDescriptor, container: ResolvedContainer): string {
    return container.ref.kind === 'project' ? container.root : this.standaloneFolder(kind)
  }

  /** 位置换算的上下文：作品目录、全部已知项目与程序目录。 */
  locationContext(container: ResolvedContainer): LocationContext {
    const projects = this.catalog.listProjects()
      .filter((project) => !project.missing)
      .map((project) => ({ id: project.id, root: project.path }))
    if (container.ref.kind === 'project') {
      const id = container.ref.projectId
      const others = projects.filter((project) => project.id !== id)
      projects.splice(0, projects.length, ...others, { id, root: container.root })
    }
    return {
      style: this.style,
      userRoot: this.layout().root,
      projects,
      programRoots: this.programRoots(),
      container: container.ref,
    }
  }

  // ==================== 位置判断 ====================

  isInsideProgramRoots(target: string): boolean {
    return this.programRoots().some((root) => isPathInside(this.style, root, target))
  }

  assertWritableLocation(target: string): void {
    if (!path.isAbsolute(target) || target.includes('\0')) throw new DocumentLocationError('位置无效，请选择一个文件夹。')
    if (this.isInsideProgramRoots(target)) throw new DocumentLocationError('不能把作品放在程序内部数据目录里，请换一个位置。')
  }

  /**
   * 文件夹是否已在扫描范围内（类型文件夹、项目文件夹、已登记的外部位置）。
   * 不在范围内的独立文档保存位置需要登记为外部位置，才能出现在列表里。
   */
  isScannedDocumentFolder(folder: string): boolean {
    const layout = this.layout()
    for (const kind of this.options.kinds.list()) {
      const names = kind.standaloneFolderNames
      if (names && isPathInside(this.style, path.join(layout.root, names[layout.locale]), folder)) return true
    }
    return this.catalog.listExternalLocations().some((location) => (
      location.kind === 'folder' ? samePath(this.style, location.path, folder) : isPathInside(this.style, location.path, folder)
    ))
  }
}
