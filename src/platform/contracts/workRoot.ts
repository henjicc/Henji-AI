/*
 * 作品目录（默认“文档/痕迹AI”，任务 4.2）的位置与更换。
 *
 * 作品目录只放作品：项目、各类文档、生成结果、上传素材、导出、助手技能；数据库、密钥、日志、缓存等
 * 程序数据在程序目录，不随之移动。文档与数据库里的位置都是相对写法（实施方案 2.5），
 * 更换作品目录 = 主进程整体移动这个文件夹 + 切换设置，不改写任何记录。
 * 主进程实现在 `electron/main/services/work-root/`，渲染层经 `src/commands/workRoot.ts` 调用。
 */

/** 更换目标：恢复默认位置，或用户选择的文件夹。 */
export type WorkRootTarget = { kind: 'default' } | { kind: 'custom'; folder: string }

export interface WorkRootInfo {
  /** 当前作品目录。 */
  root: string
  /** 默认作品目录（文档/痕迹AI），首次确定后不变。 */
  defaultRoot: string
  isCustom: boolean
}

/**
 * 目标检查结果：
 * - `ok`：可以移动（目标不存在或是空文件夹）
 * - `current`：就是当前作品目录
 * - `nested`：在当前作品目录里面，或包含当前作品目录
 * - `notEmpty`：目标文件夹里已经有东西
 * - `notDirectory`：目标位置是一个文件
 */
export type WorkRootTargetStatus = 'ok' | 'current' | 'nested' | 'notEmpty' | 'notDirectory'

export interface WorkRootTargetInspection {
  /** 实际会成为作品目录的文件夹（所选文件夹不是空的时，在其中新建“痕迹AI”）。 */
  root: string
  status: WorkRootTargetStatus
}

export type WorkRootMovePhase = 'preparing' | 'moving' | 'copying' | 'verifying' | 'cleaning'

export interface WorkRootMoveProgress {
  phase: WorkRootMovePhase
  current: number
  total: number
  /** 当前处理的文件（相对作品目录）。 */
  item: string
}

export interface WorkRootChangeResult {
  changed: boolean
  root: string
  /** 同一磁盘直接改名；跨磁盘复制并核对后删除旧位置。 */
  mode: 'rename' | 'copy' | 'none'
  /** 旧位置已删除；复制模式下删除失败时为 false（作品已在新位置，旧位置留有副本）。 */
  oldRootRemoved: boolean
  /** 完成后需要重新启动，让已打开的界面按新位置重新载入。 */
  requiresRestart: boolean
}

/** 失败原因（错误对象的 name 为 `WorkRootMoveError`，message 以 `<code>:` 开头）。 */
export type WorkRootMoveErrorCode =
  | 'same_root'
  | 'nested_root'
  | 'target_not_empty'
  | 'target_not_directory'
  | 'insufficient_space'
  | 'in_use'
  | 'busy'
  | 'cancelled'
  | 'move_failed'

export const WORK_ROOT_IPC_CHANNELS = {
  getInfo: 'workRoot:getInfo',
  inspectTarget: 'workRoot:inspectTarget',
  change: 'workRoot:change',
  cancel: 'workRoot:cancel',
  open: 'workRoot:open',
  relaunch: 'workRoot:relaunch',
  progress: 'workRoot:progress',
} as const

export interface WorkRootPlatform {
  getInfo(): Promise<WorkRootInfo>
  inspectTarget(target: WorkRootTarget): Promise<WorkRootTargetInspection>
  /** 整体移动作品目录并切换设置；失败或取消时原目录保持完整、设置不变。 */
  change(target: WorkRootTarget): Promise<WorkRootChangeResult>
  /** 取消进行中的移动（复制阶段有效；已切换设置后不再可取消）。返回是否有可取消的移动。 */
  cancel(): Promise<boolean>
  onProgress(handler: (progress: WorkRootMoveProgress) => void): () => void
  /** 在文件管理器中打开作品目录。 */
  open(): Promise<void>
  /** 更换完成后重新启动应用。 */
  relaunch(): Promise<void>
}

/** 从错误里取出失败原因；不是作品目录移动错误时返回 null。 */
export function readWorkRootMoveErrorCode(error: unknown): WorkRootMoveErrorCode | null {
  if (!(error instanceof Error)) return null
  const match = /^(same_root|nested_root|target_not_empty|target_not_directory|insufficient_space|in_use|busy|cancelled|move_failed):/.exec(error.message)
  return match ? match[1] as WorkRootMoveErrorCode : null
}
