import { shell } from 'electron'
import { execFile } from 'node:child_process'

import { allowMediaRoot } from '../../protocol'
import { getProgramDataDir, getProgramStoreDir, getUserDataLayout } from '../appPaths'
import { renderCoverImage } from '../covers/cover-render'
import { readUserDataRootSettings } from '../dataRoot'
import { getDb } from '../db'
import { createMainLogger } from '../logging/main-logger'
import { createDocumentServices, type DocumentServices } from './create-services'
import { DocumentIndexStore } from './index-store'
import { createPackageAdapterRegistry } from './package-adapters'
import { createImageDocumentPackageAdapter } from '../image-editor-v3/image-document/package-adapter'
import type { DocumentService } from './service'
import type { WorkspaceLayout } from './workspace'

/*
 * 文档底座的正式运行环境：作品目录来自 appPaths，作品索引在 henji.db，
 * 回收站、在文件夹中显示用 Electron shell，媒体授权沿用 henji-media 协议的授权机制。
 */

const STYLE = process.platform === 'win32' ? 'win32' : 'posix'
const logger = createMainLogger('main.documents.runtime')
let services: DocumentServices | null = null

function workspaceLayout(): WorkspaceLayout {
  const layout = getUserDataLayout()
  return {
    root: layout.root,
    locale: layout.locale,
    projectsDir: layout.folders.projects,
    generatedDir: layout.folders.generated,
    uploadsDir: layout.folders.uploads,
  }
}

/** Windows 上用系统自带的 attrib 设隐藏属性；其他平台点开头的文件夹本来就隐藏。 */
async function hideDirectory(directory: string): Promise<void> {
  if (process.platform !== 'win32') return
  await new Promise<void>((resolve, reject) => {
    execFile('attrib', ['+h', directory], { windowsHide: true }, (error) => (error ? reject(error) : resolve()))
  })
}

function grantMediaRoots(directories: readonly string[]): void {
  for (const directory of directories) {
    try {
      allowMediaRoot(directory)
    } catch (error) {
      logger.warn('媒体目录授权失败', { event: 'documents.media_grant.failed', context: { directory }, error })
    }
  }
}

function getServices(): DocumentServices {
  services ??= createDocumentServices({
    style: STYLE,
    layout: workspaceLayout,
    programRoots: () => [getProgramDataDir()],
    catalog: new DocumentIndexStore(getDb(), STYLE),
    storeDirectory: getProgramStoreDir('documentStore'),
    logger: createMainLogger,
    trashItem: (target) => shell.trashItem(target),
    showItemInFolder: (target) => shell.showItemInFolder(target),
    grantMediaRoots,
    renderCover: renderCoverImage,
    hideDirectory,
    // 单文件包适配器登记处：图片文档 .henjiimg（3.5）。
    adapters: createPackageAdapterRegistry([createImageDocumentPackageAdapter()]),
  })
  return services
}

export function getDocumentService(): DocumentService {
  return getServices().service
}

/**
 * 启动后在后台扫描作品索引，不阻塞启动。作品目录尚未确定（全新安装、渲染层还没报告界面语言）时跳过，
 * 避免抢在渲染层之前按系统语言定下目录名称；之后的页面打开或刷新会触发扫描。
 */
export function scheduleStartupDocumentIndexScan(delayMs = 3_000): void {
  const timer = setTimeout(() => {
    try {
      const settings = readUserDataRootSettings()
      if (!settings.persistedDefault && !settings.customRoot) {
        logger.info('作品目录尚未确定，跳过启动扫描', { event: 'documents.index.startup_scan.skipped' })
        return
      }
      void getServices().scanner.refresh().catch(() => undefined)
    } catch (error) {
      logger.error('启动扫描作品索引失败', { event: 'documents.index.startup_scan.failed', error })
    }
  }, delayMs)
  timer.unref?.()
}
