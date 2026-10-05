import fsp from 'node:fs/promises'
import path from 'node:path'

import { entryNameKey, untitledEntryName } from '../../../../src/core/documents/naming'
import { buildProjectManifest, UNTITLED_PROJECT_NAMES } from '../../../../src/core/documents/projectManifest'
import type {
  CreateProjectRequest,
  FinalizeProjectRequest,
  ProjectListQuery,
  ProjectSummary,
  RenameProjectRequest,
} from '../../../../src/core/documents/types'
import { isPathInside, samePath } from '../../../../src/core/storage/pathSyntax'
import { createDirectoryExclusively, EntryExistsError, moveDirectoryNoOverwrite } from '../fs/no-overwrite'
import { KeyedSerialExecutor } from '../image-editor-v3/serial-executor'
import type { MainLogger } from '../logging/main-logger'
import type { IndexedProject } from './catalog'
import {
  DocumentLocationError,
  DocumentNameConflictError,
  DocumentNameInvalidError,
  FileInUseError,
  isInUseError,
  ProjectNotFoundError,
} from './errors'
import { readEntryNameKeys, requireEntryName } from './name-check'
import type { DocumentWorkspace } from './workspace'

/*
 * 项目（实施方案 2.2、2.8）：装文档和素材的文件夹，项目名就是文件夹名。
 *
 * - 新建项目以草稿状态建在作品目录的“项目”文件夹里，自动起名“未命名项目 N”（中英按作品目录语言）。
 * - 第一次保存（转正）时起名，可另选父文件夹：整个文件夹移过去并登记为外部位置。
 * - 在作品目录之外打开的项目登记为外部位置（索引里唯一不能由扫描重建的数据）。
 * - 用户输入的名字重名时报错，由界面提示，不偷偷加后缀；建文件夹、改名都以不覆盖的方式完成。
 */

export interface ProjectServiceOptions {
  workspace: DocumentWorkspace
  logger: MainLogger
  trashItem(target: string): Promise<void>
  showItemInFolder(target: string): void
  grantMediaRoots(directories: readonly string[]): void
  /** 项目移到回收站后清掉其中文档的封面。 */
  removeCovers?(docIds: readonly string[]): Promise<void>
  /** 索引里找不到项目时刷新后重试。 */
  refreshProjects?(): Promise<void>
  /** 登记外部位置后在后台补扫其中的文档。 */
  scheduleIndexRefresh?(): void
}

const MAX_NAME_ATTEMPTS = 100

export class ProjectService {
  private readonly executor = new KeyedSerialExecutor()

  constructor(private readonly options: ProjectServiceOptions) {}

  private get workspace(): DocumentWorkspace {
    return this.options.workspace
  }

  list(query: ProjectListQuery = {}): ProjectSummary[] {
    const catalog = this.workspace.catalog
    const counts = new Map<string, number>()
    for (const document of catalog.listDocuments({ includeMissing: false })) {
      if (document.projectId) counts.set(document.projectId, (counts.get(document.projectId) ?? 0) + 1)
    }
    return catalog.listProjects()
      .filter((project) => (query.includeDrafts ?? true) || !project.draft)
      .filter((project) => (query.includeMissing ?? true) || !project.missing)
      .map((project) => this.summary(project, counts.get(project.id) ?? 0))
  }

  /** 新建项目：没给名字时为草稿并自动起名；给了名字按用户输入处理（重名报错）。 */
  async create(request: CreateProjectRequest = {}): Promise<ProjectSummary> {
    return await this.logged('create', {}, async () => {
      const layout = this.workspace.layout()
      const userName = request.name === undefined ? null : requireEntryName(request.name)
      const draft = request.draft ?? userName === null
      for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
        const taken = await readEntryNameKeys(layout.projectsDir)
        if (userName !== null) {
          const existing = taken.get(entryNameKey(userName))
          if (existing !== undefined) throw new DocumentNameConflictError(path.join(layout.projectsDir, existing))
        }
        const name = userName ?? untitledEntryName(UNTITLED_PROJECT_NAMES[layout.locale], (candidate) => taken.has(entryNameKey(candidate)))
        const root = path.join(layout.projectsDir, name)
        try {
          await createDirectoryExclusively(root)
        } catch (error) {
          if (!(error instanceof EntryExistsError)) throw error
          if (userName !== null) throw new DocumentNameConflictError(error.path)
          continue
        }
        const manifest = buildProjectManifest({
          id: this.workspace.randomId(),
          createdAt: this.workspace.now().toISOString(),
          locale: layout.locale,
          draft,
        })
        try {
          await this.workspace.writeManifest(root, manifest)
        } catch (error) {
          await fsp.rm(root, { recursive: true, force: true }).catch(() => undefined)
          throw error
        }
        const project = await this.workspace.describeProject(root, manifest)
        this.workspace.catalog.upsertProject(project)
        return this.summary(project, 0)
      }
      throw new Error('同名的项目过多，请先整理“项目”文件夹。')
    })
  }

  /** 改名就是改文件夹名；项目里的位置都是相对写法，不需要改写任何记录。 */
  async rename(request: RenameProjectRequest): Promise<ProjectSummary> {
    return await this.executor.run(request.projectId, async () => await this.logged('rename', { projectId: request.projectId }, async () => {
      const project = await this.requireProject(request.projectId)
      const name = requireEntryName(request.name)
      const target = path.join(path.dirname(project.path), name)
      if (target === project.path) return this.summary(project, this.countDocuments(project.id))
      return await this.relocate(project, target, { draft: project.draft })
    }))
  }

  /** 第一次保存：起名并去掉草稿标记；给了父文件夹时把整个项目移过去并登记为外部位置。 */
  async finalize(request: FinalizeProjectRequest): Promise<ProjectSummary> {
    return await this.executor.run(request.projectId, async () => await this.logged('finalize', { projectId: request.projectId, relocated: request.parentFolder !== undefined }, async () => {
      const project = await this.requireProject(request.projectId)
      const name = requireEntryName(request.name)
      let parent = path.dirname(project.path)
      if (request.parentFolder !== undefined) {
        this.workspace.assertWritableLocation(request.parentFolder)
        parent = path.resolve(request.parentFolder)
        if (isPathInside(this.workspace.style, project.path, parent)) throw new DocumentLocationError('不能把项目移到它自己的文件夹里。')
        if (await this.workspace.findProjectRoot(parent)) throw new DocumentLocationError('不能把项目放在另一个项目里。')
      }
      return await this.relocate(project, path.join(parent, name), { draft: false })
    }))
  }

  /** 整个项目文件夹移到系统回收站。 */
  async trash(projectId: string): Promise<void> {
    await this.executor.run(projectId, async () => await this.logged('trash', { projectId }, async () => {
      const project = await this.requireProject(projectId)
      try {
        await this.options.trashItem(project.path)
      } catch (error) {
        throw new FileInUseError('项目文件夹未能移到回收站，请确认没有其他程序正在使用其中的文件。', { cause: error })
      }
      const catalog = this.workspace.catalog
      const documentIds = catalog.listDocuments({ projectId }).map((document) => document.id)
      catalog.removeProject(projectId)
      if (project.external) catalog.removeExternalLocation(project.path)
      await this.options.removeCovers?.(documentIds)
    }))
  }

  /**
   * 打开作品目录之外的项目文件夹并登记为外部位置。没有项目说明的文件夹补写一份；
   * 与索引里另一个仍然存在的项目同 ID（拷贝出来的）时给它换新 ID。
   */
  async registerExternal(folderPath: string): Promise<ProjectSummary> {
    return await this.logged('register_external', { folderPath }, async () => {
      this.workspace.assertWritableLocation(folderPath)
      const root = path.resolve(folderPath)
      const stat = await fsp.stat(root).catch(() => null)
      if (!stat?.isDirectory()) throw new DocumentLocationError('请选择一个文件夹。')
      const layout = this.workspace.layout()
      if (isPathInside(this.workspace.style, root, layout.root)) throw new DocumentLocationError('不能把作品目录本身作为项目打开。')
      const parentProject = await this.workspace.findProjectRoot(path.dirname(root))
      if (parentProject) throw new DocumentLocationError('这个文件夹在另一个项目里，不能单独作为项目打开。')
      let { manifest } = await this.workspace.ensureManifest(root)
      const catalog = this.workspace.catalog
      const existing = catalog.getProject(manifest.id)
      if (existing && !samePath(this.workspace.style, existing.path, root)) {
        const original = await this.workspace.readManifest(existing.path).catch(() => null)
        if (original?.id === manifest.id) {
          manifest = { ...manifest, id: this.workspace.randomId() }
          await this.workspace.writeManifest(root, manifest)
          this.options.logger.info('拷贝出来的项目已换新 ID', { event: 'documents.projects.id_reassigned', context: { root, previousId: existing.id, projectId: manifest.id } })
        }
      }
      const project = await this.workspace.describeProject(root, manifest)
      catalog.upsertProject(project)
      if (project.external) {
        catalog.addExternalLocation(root, 'project')
        this.options.grantMediaRoots([root])
      }
      this.options.scheduleIndexRefresh?.()
      return this.summary(project, this.countDocuments(project.id))
    })
  }

  /** 从列表里移除外部位置（不动磁盘上的文件）。 */
  async forgetExternal(folderPath: string): Promise<void> {
    await this.logged('forget_external', { folderPath }, async () => {
      const catalog = this.workspace.catalog
      const location = catalog.listExternalLocations().find((item) => samePath(this.workspace.style, item.path, folderPath))
      if (!location) return
      catalog.removeExternalLocation(location.path)
      if (location.kind === 'project') {
        const project = catalog.getProjectByPath(location.path)
        if (project) catalog.removeProject(project.id)
        return
      }
      for (const document of catalog.listDocuments({ projectId: null })) {
        if (samePath(this.workspace.style, path.dirname(document.path), location.path)) catalog.removeDocument(document.id)
      }
    })
  }

  async reveal(projectId: string): Promise<void> {
    const project = await this.requireProject(projectId)
    this.options.showItemInFolder(project.path)
  }

  // ==================== 内部 ====================

  private countDocuments(projectId: string): number {
    return this.workspace.catalog.listDocuments({ projectId, includeMissing: false }).length
  }

  private summary(project: IndexedProject, documentCount: number): ProjectSummary {
    return {
      id: project.id,
      name: project.name,
      path: project.path,
      locale: project.locale,
      folders: { ...project.folders },
      draft: project.draft,
      external: project.external,
      missing: project.missing,
      createdAt: project.createdAt,
      mainVideoEditId: project.mainVideoEditId,
      documentCount,
    }
  }

  /** 索引里的项目，并核对磁盘上的项目说明仍是它；对不上时刷新索引后重试一次。 */
  private async requireProject(projectId: string): Promise<IndexedProject> {
    const find = async (): Promise<IndexedProject | null> => {
      const project = this.workspace.catalog.getProject(projectId)
      if (!project) return null
      const manifest = await this.workspace.readManifest(project.path).catch(() => null)
      return manifest?.id === projectId ? project : null
    }
    const found = await find()
    if (found) return found
    if (this.options.refreshProjects) {
      await this.options.refreshProjects()
      const refreshed = await find()
      if (refreshed) return refreshed
    }
    throw new ProjectNotFoundError(projectId)
  }

  /** 把项目文件夹移到 target（改名或换父文件夹），更新草稿标记、索引与外部位置。 */
  private async relocate(project: IndexedProject, target: string, options: { draft: boolean }): Promise<ProjectSummary> {
    const catalog = this.workspace.catalog
    if (target !== project.path) {
      try {
        await moveDirectoryNoOverwrite(project.path, target)
      } catch (error) {
        if (error instanceof EntryExistsError) throw new DocumentNameConflictError(error.path)
        if (isInUseError(error)) throw new FileInUseError('项目里的文件正在被使用（预览、导出或其他程序），请关闭后再试。', { cause: error })
        throw error
      }
      catalog.rebaseDocuments(project.path, target)
    }
    const current = await this.workspace.readManifest(target)
    if (!current) throw new ProjectNotFoundError(project.id)
    const manifest = buildProjectManifest({ ...current, draft: options.draft, mainVideoEditId: current.mainVideoEditId })
    if (manifest.draft !== current.draft) await this.workspace.writeManifest(target, manifest)
    const updated = await this.workspace.describeProject(target, manifest)
    catalog.upsertProject(updated)
    if (project.external) catalog.removeExternalLocation(project.path)
    if (updated.external) {
      catalog.addExternalLocation(target, 'project')
      this.options.grantMediaRoots([target])
    }
    return this.summary(updated, this.countDocuments(updated.id))
  }

  private async logged<T>(action: string, context: Record<string, unknown>, operation: () => Promise<T>): Promise<T> {
    const logger = this.options.logger
    logger.info('开始处理项目', { event: `documents.projects.${action}.start`, context })
    try {
      const result = await operation()
      logger.info('项目处理完成', { event: `documents.projects.${action}.completed`, context })
      return result
    } catch (error) {
      const expected = [DocumentNameConflictError, DocumentNameInvalidError, DocumentLocationError, ProjectNotFoundError, FileInUseError]
        .some((type) => error instanceof type)
      logger[expected ? 'warn' : 'error']('项目处理失败', { event: `documents.projects.${action}.failed`, context, error })
      throw error
    }
  }
}
