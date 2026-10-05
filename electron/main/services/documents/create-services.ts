import path from 'node:path'

import { documentKindRegistry, type DocumentKindRegistry } from '../../../../src/core/documents/kinds'
import type { DocumentCoverSource } from '../../../../src/core/documents/types'
import type { PathStyle } from '../../../../src/core/storage/pathSyntax'
import type { MainLogger } from '../logging/main-logger'
import type { DocumentCatalog } from './catalog'
import { DocumentCoverStore } from './covers'
import { DocumentIndexScanner } from './index-scanner'
import { createPackageAdapterRegistry, type PackageAdapterRegistry } from './package-adapters'
import { ProjectService } from './projects'
import { DocumentRepository } from './repository'
import { DocumentService } from './service'
import { DocumentWorkspace, type WorkspaceLayout } from './workspace'

/** 文档底座的运行环境：正式运行由 runtime.ts 注入 appPaths、henji.db 与 Electron 能力，测试注入临时目录。 */
export interface DocumentEnvironment {
  style: PathStyle
  layout(): WorkspaceLayout
  programRoots(): readonly string[]
  catalog: DocumentCatalog
  /** 程序目录里的文档底座内部存储（锁、封面）。 */
  storeDirectory: string
  logger(domain: string): MainLogger
  trashItem(target: string): Promise<void>
  showItemInFolder(target: string): void
  grantMediaRoots(directories: readonly string[]): void
  renderCover(sources: readonly DocumentCoverSource[]): Promise<{ bytes: Buffer; selected: DocumentCoverSource[] }>
  hideDirectory?(directory: string): Promise<void>
  kinds?: DocumentKindRegistry
  adapters?: PackageAdapterRegistry
  now?(): Date
  randomId?(): string
}

export interface DocumentServices {
  service: DocumentService
  workspace: DocumentWorkspace
  repository: DocumentRepository
  projects: ProjectService
  scanner: DocumentIndexScanner
  covers: DocumentCoverStore
}

export function createDocumentServices(environment: DocumentEnvironment): DocumentServices {
  const kinds = environment.kinds ?? documentKindRegistry
  const adapters = environment.adapters ?? createPackageAdapterRegistry()
  const workspace = new DocumentWorkspace({
    style: environment.style,
    layout: environment.layout,
    programRoots: environment.programRoots,
    catalog: environment.catalog,
    kinds,
    logger: environment.logger('main.documents.workspace'),
    hideDirectory: environment.hideDirectory,
    now: environment.now,
    randomId: environment.randomId,
  })
  const scanner = new DocumentIndexScanner({ workspace, kinds, adapters, logger: environment.logger('main.documents.index') })
  const covers = new DocumentCoverStore({
    directory: path.join(environment.storeDirectory, 'covers'),
    render: environment.renderCover,
    logger: environment.logger('main.documents.covers'),
  })
  const refreshProjects = async (): Promise<void> => { await scanner.refresh() }
  const repository = new DocumentRepository({
    workspace,
    kinds,
    adapters,
    logger: environment.logger('main.documents'),
    lockDirectory: path.join(environment.storeDirectory, 'locks'),
    trashItem: environment.trashItem,
    showItemInFolder: environment.showItemInFolder,
    grantMediaRoots: environment.grantMediaRoots,
    removeCover: (docId) => covers.remove(docId),
    refreshProjects,
  })
  const projects = new ProjectService({
    workspace,
    logger: environment.logger('main.documents.projects'),
    trashItem: environment.trashItem,
    showItemInFolder: environment.showItemInFolder,
    grantMediaRoots: environment.grantMediaRoots,
    removeCovers: async (docIds) => { await Promise.all(docIds.map((docId) => covers.remove(docId))) },
    refreshProjects,
    scheduleIndexRefresh: () => { void scanner.refresh().catch(() => undefined) },
  })
  const service = new DocumentService({ workspace, repository, projects, scanner, covers })
  return { service, workspace, repository, projects, scanner, covers }
}
