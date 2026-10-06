import fs from 'node:fs/promises'
import path from 'node:path'

import type {
  WorkRootChangeResult,
  WorkRootInfo,
  WorkRootMoveProgress,
  WorkRootTarget,
  WorkRootTargetInspection,
} from '../../../../src/platform/contracts/workRoot'
import type { MainLogger } from '../logging/main-logger'
import { inspectWorkRootTarget, moveWorkRoot, WorkRootMoveError, type MoveWorkRootInput } from './moveWorkRoot'

/*
 * 作品目录更换服务（任务 4.2）：解析目标、单实例运行、切换设置、刷新作品索引。
 * 依赖全部注入，正式运行环境见 `runtime.ts`，测试用临时目录。
 *
 * 不改写任何数据库记录与文档：位置都是相对写法（实施方案 2.5）。外部位置（作品目录之外的项目）不动。
 * 媒体协议按当前作品目录动态授权（protocol.ts 每次读取 getUserRootDir），切换设置后立即覆盖新位置。
 */

export interface WorkRootServiceDeps {
  /** 当前作品目录布局（每次调用重新读取设置）。 */
  layout: () => WorkRootInfo & { rootFolderName: string; rootFolderNames: readonly string[] }
  /** 切换作品目录设置：null 表示回到默认位置。 */
  writeCustomRoot: (root: string | null) => void
  /** 切换后按新位置建好分类文件夹。 */
  ensureFolders: () => void
  /** 切换后刷新作品索引（项目在新位置被重新认领）。 */
  refreshIndex: () => Promise<unknown>
  /** 还有会往作品目录写文件的后台工作（生成结果保存、导出等）时返回给用户看的原因，空闲时返回 null。 */
  busyReason: () => string | null
  logger: MainLogger
  style?: 'win32' | 'posix'
  /** 测试注入，透传给 moveWorkRoot。 */
  moveOptions?: Pick<MoveWorkRootInput, 'forceCopy' | 'fileOps' | 'availableBytes'>
}

export interface WorkRootService {
  getInfo(): WorkRootInfo
  resolveTarget(target: WorkRootTarget): Promise<string>
  inspectTarget(target: WorkRootTarget): Promise<WorkRootTargetInspection>
  change(target: WorkRootTarget, onProgress?: (progress: WorkRootMoveProgress) => void): Promise<WorkRootChangeResult>
  cancel(): boolean
  isRunning(): boolean
  /** 应用退出时：取消进行中的移动并等它回滚完成，不留半截状态。 */
  dispose(): Promise<void>
}

function sameName(style: 'win32' | 'posix', left: string, right: string): boolean {
  return style === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

async function isEmptyOrMissing(folder: string): Promise<boolean> {
  try {
    const stat = await fs.stat(folder)
    return stat.isDirectory() && (await fs.readdir(folder)).length === 0
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

export function createWorkRootService(deps: WorkRootServiceDeps): WorkRootService {
  const style = deps.style ?? (process.platform === 'win32' ? 'win32' : 'posix')
  const logger = deps.logger
  let running: { controller: AbortController; done: Promise<unknown> } | null = null

  const getInfo = (): WorkRootInfo => {
    const layout = deps.layout()
    return { root: layout.root, defaultRoot: layout.defaultRoot, isCustom: layout.isCustom }
  }

  /**
   * 用户选的文件夹：名字本来就是“痕迹AI / Henji AI”或是空文件夹 → 直接用它；
   * 否则在里面新建“痕迹AI”（选了“D:\”这类已有内容的文件夹时不会把作品散在里面）。
   */
  const resolveTarget = async (target: WorkRootTarget): Promise<string> => {
    const layout = deps.layout()
    if (target.kind === 'default') return path.resolve(layout.defaultRoot)
    const folder = path.resolve(target.folder)
    const base = path.basename(folder)
    if (layout.rootFolderNames.some((name) => sameName(style, name, base))) return folder
    if (await isEmptyOrMissing(folder)) return folder
    return path.join(folder, layout.rootFolderName)
  }

  const inspectTarget = async (target: WorkRootTarget): Promise<WorkRootTargetInspection> => {
    const root = await resolveTarget(target)
    return { root, status: await inspectWorkRootTarget(deps.layout().root, root) }
  }

  const change = async (
    target: WorkRootTarget,
    onProgress?: (progress: WorkRootMoveProgress) => void,
  ): Promise<WorkRootChangeResult> => {
    if (running) throw new WorkRootMoveError('busy', '作品目录正在移动，请等待完成')
    const controller = new AbortController()
    let finish: () => void = () => undefined
    running = { controller, done: new Promise<void>((resolve) => { finish = resolve }) }
    const startedAt = Date.now()
    try {
      const layout = deps.layout()
      const oldRoot = path.resolve(layout.root)
      const newRoot = await resolveTarget(target)
      const useDefault = path.relative(newRoot, path.resolve(layout.defaultRoot)) === ''
      if (path.relative(oldRoot, newRoot) === '') {
        return { changed: false, root: oldRoot, mode: 'none', oldRootRemoved: false, requiresRestart: false }
      }
      const busyReason = deps.busyReason()
      if (busyReason) throw new WorkRootMoveError('busy', `${busyReason}，请等待完成后再更换作品目录`)
      logger.info('开始更换作品目录', { event: 'work_root.move.start', context: { from: oldRoot, to: newRoot, useDefault } })

      const result = await moveWorkRoot({
        ...deps.moveOptions,
        oldRoot,
        newRoot,
        signal: controller.signal,
        onProgress,
        commit: () => {
          deps.writeCustomRoot(useDefault ? null : newRoot)
          logger.info('作品目录设置已切换', { event: 'work_root.setting.switched', context: { to: newRoot, useDefault } })
        },
      })

      try {
        deps.ensureFolders()
      } catch (error) {
        logger.warn('新作品目录的分类文件夹创建失败，将在下次使用时重试', { event: 'work_root.folders.failed', error })
      }
      try {
        await deps.refreshIndex()
      } catch (error) {
        // 索引可以随时重建，下次打开页面或启动时会再扫描。
        logger.warn('更换作品目录后刷新作品索引失败', { event: 'work_root.index.refresh_failed', error })
      }
      if (!result.oldRootRemoved) {
        logger.warn('旧作品目录没能完全删除，作品已在新位置', { event: 'work_root.cleanup.incomplete', context: { from: oldRoot } })
      }
      logger.info('作品目录更换完成', {
        event: 'work_root.move.completed',
        context: { from: oldRoot, to: newRoot, mode: result.mode, files: result.files, bytes: result.bytes, oldRootRemoved: result.oldRootRemoved, durationMs: Date.now() - startedAt },
      })
      return { changed: true, root: newRoot, mode: result.mode, oldRootRemoved: result.oldRootRemoved, requiresRestart: true }
    } catch (error) {
      const code = error instanceof WorkRootMoveError ? error.code : 'move_failed'
      const context = { code, durationMs: Date.now() - startedAt }
      if (code === 'cancelled') logger.info('已取消更换作品目录，原目录保持不变', { event: 'work_root.move.cancelled', context })
      else if (code === 'busy' || code === 'in_use' || code === 'target_not_empty' || code === 'insufficient_space') {
        logger.warn('暂时无法更换作品目录，原目录保持不变', { event: 'work_root.move.failed', context, error })
      } else logger.error('更换作品目录失败，原目录保持不变', { event: 'work_root.move.failed', context, error })
      throw error
    } finally {
      running = null
      finish()
    }
  }

  return {
    getInfo,
    resolveTarget,
    inspectTarget,
    change,
    cancel: () => {
      if (!running) return false
      running.controller.abort()
      logger.info('请求取消更换作品目录', { event: 'work_root.move.cancel_requested' })
      return true
    },
    isRunning: () => running !== null,
    dispose: async () => {
      const current = running
      if (!current) return
      current.controller.abort()
      await current.done
    },
  }
}
