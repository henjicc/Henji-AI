import { createLogger } from '@/core/logging'
import { useCallback, useEffect, useState } from 'react'
import { openDialog } from '@/platform/desktopApi'
import {
  cancelWorkRootChange,
  changeWorkRoot,
  getWorkRootInfo,
  inspectWorkRootTarget,
  openWorkRoot,
  relaunchAfterWorkRootChange,
} from '@/commands/workRoot'
import {
  readWorkRootMoveErrorCode,
  type WorkRootMoveErrorCode,
  type WorkRootMovePhase,
  type WorkRootTarget,
  type WorkRootTargetStatus,
} from '@/platform/contracts/workRoot'

const logger = createLogger('components.Settings.hooks.useDataPath')

export type AlertMessage = {
  key: string
  params?: Record<string, string | number>
}

export interface AlertState {
  open: boolean
  message: AlertMessage
}

export interface MigrationProgress {
  phase: WorkRootMovePhase | null
  current: number
  total: number
  file: string
}

export interface ConfirmMoveState {
  open: boolean
  mode: 'change' | 'reset'
  /** 实际会成为作品目录的文件夹。 */
  targetPath: string
}

export interface UseDataPathResult {
  currentPath: string
  defaultPath: string
  isCustom: boolean
  isMigrating: boolean
  progress: MigrationProgress
  showProgress: boolean
  /** 复制阶段可以取消；切换设置后不可取消。 */
  canCancel: boolean
  alert: AlertState
  confirm: ConfirmMoveState
  selectDirectory: () => Promise<void>
  openResetConfirm: () => Promise<void>
  closeConfirm: () => void
  confirmMove: () => Promise<void>
  cancelMove: () => Promise<void>
  openInFileManager: () => Promise<void>
  closeAlert: () => void
}

const EMPTY_PROGRESS: MigrationProgress = { phase: null, current: 0, total: 0, file: '' }
const CLOSED_CONFIRM: ConfirmMoveState = { open: false, mode: 'change', targetPath: '' }
const CANCELLABLE_PHASES: ReadonlySet<WorkRootMovePhase> = new Set(['preparing', 'copying', 'verifying'])

const TARGET_STATUS_ALERT: Record<Exclude<WorkRootTargetStatus, 'ok' | 'current'>, string> = {
  nested: 'alerts.workRoot.nested',
  notEmpty: 'alerts.workRoot.notEmpty',
  notDirectory: 'alerts.workRoot.notDirectory',
}

const ERROR_ALERT: Partial<Record<WorkRootMoveErrorCode, string>> = {
  nested_root: 'alerts.workRoot.nested',
  target_not_empty: 'alerts.workRoot.notEmpty',
  target_not_directory: 'alerts.workRoot.notDirectory',
  insufficient_space: 'alerts.workRoot.insufficientSpace',
  in_use: 'alerts.workRoot.inUse',
  busy: 'alerts.workRoot.busy',
}

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^[a-z_]+:/, '')
}

/**
 * 作品目录（默认“文档/痕迹AI”）设置：查看、在文件夹中打开、更换位置、恢复默认位置。
 *
 * 更换在应用关闭屏障里进行：先像关闭应用一样保存全部打开的文档与工程并冻结新的写入，
 * 再由主进程整体移动文件夹并切换设置，完成后自动重新启动，让所有界面按新位置重新载入。
 * 任一步失败或取消：主进程保证原目录完整、设置不变，屏障解除，用户继续在原位置工作。
 */
export function useDataPath(enabled = true): UseDataPathResult {
  const [currentPath, setCurrentPath] = useState('')
  const [defaultPath, setDefaultPath] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [isMigrating, setIsMigrating] = useState(false)
  const [progress, setProgress] = useState<MigrationProgress>(EMPTY_PROGRESS)
  const [showProgress, setShowProgress] = useState(false)
  const [alert, setAlert] = useState<AlertState>({ open: false, message: { key: '' } })
  const [confirm, setConfirm] = useState<ConfirmMoveState>(CLOSED_CONFIRM)
  const [pendingTarget, setPendingTarget] = useState<WorkRootTarget | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    void getWorkRootInfo().then((info) => {
      if (!active) return
      setCurrentPath(info.root)
      setDefaultPath(info.defaultRoot)
      setIsCustom(info.isCustom)
    }).catch((error: unknown) => {
      logger.error('读取作品目录失败', error, { event: 'work_root.info.failed' })
    })
    return () => { active = false }
  }, [enabled])

  const showAlert = useCallback((key: string, params?: Record<string, string | number>) => {
    setAlert({ open: true, message: { key, params } })
  }, [])

  /** 检查目标；可以移动时打开确认框。 */
  const prepare = useCallback(async (target: WorkRootTarget, mode: ConfirmMoveState['mode']) => {
    try {
      const inspection = await inspectWorkRootTarget(target)
      if (inspection.status === 'current') return
      if (inspection.status !== 'ok') {
        showAlert(TARGET_STATUS_ALERT[inspection.status], { path: inspection.root })
        return
      }
      setPendingTarget(target)
      setConfirm({ open: true, mode, targetPath: inspection.root })
    } catch (error) {
      logger.warn('检查作品目录新位置失败', { event: 'work_root.inspect.failed', error })
      showAlert('alerts.workRoot.failed', { message: errorDetail(error) })
    }
  }, [showAlert])

  const selectDirectory = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false })
    if (!selected || Array.isArray(selected)) return
    await prepare({ kind: 'custom', folder: selected }, 'change')
  }, [prepare])

  const openResetConfirm = useCallback(async () => {
    await prepare({ kind: 'default' }, 'reset')
  }, [prepare])

  const closeConfirm = useCallback(() => {
    setConfirm(CLOSED_CONFIRM)
    setPendingTarget(null)
  }, [])

  const confirmMove = useCallback(async () => {
    const target = pendingTarget
    setConfirm(CLOSED_CONFIRM)
    setPendingTarget(null)
    if (!target) return
    setIsMigrating(true)
    setShowProgress(true)
    setProgress(EMPTY_PROGRESS)
    logger.info('开始更换作品目录', { event: 'work_root.change.start', context: { kind: target.kind } })
    let closeBusyError: (abstract new (...args: never[]) => Error) | null = null
    try {
      const closeService = await import('@/features/application-control/applicationCloseService')
      closeBusyError = closeService.ApplicationCloseBusyError
      await closeService.closeApplication(async () => {
        const result = await changeWorkRoot(target, (next) => {
          setProgress({ phase: next.phase, current: next.current, total: next.total, file: next.item })
        })
        if (!result.changed) return
        logger.info('作品目录已更换，重新启动', { event: 'work_root.change.completed', context: { mode: result.mode, oldRootRemoved: result.oldRootRemoved } })
        // 仍在写入冻结期间重启：不让任何界面再拿旧位置写东西。
        await relaunchAfterWorkRootChange()
      })
    } catch (error) {
      const code = readWorkRootMoveErrorCode(error)
      if (code === 'cancelled') {
        logger.info('已取消更换作品目录', { event: 'work_root.change.cancelled' })
        showAlert('alerts.workRoot.cancelled')
      } else if (closeBusyError && error instanceof closeBusyError) {
        logger.warn('还有操作在进行，暂不更换作品目录', { event: 'work_root.change.blocked', error })
        showAlert('alerts.workRoot.busy')
      } else {
        logger.warn('更换作品目录未完成', { event: 'work_root.change.failed', error })
        const key = code ? ERROR_ALERT[code] : undefined
        showAlert(key ?? 'alerts.workRoot.failed', { message: errorDetail(error) })
      }
    } finally {
      setIsMigrating(false)
      setShowProgress(false)
    }
  }, [pendingTarget, showAlert])

  const cancelMove = useCallback(async () => {
    try {
      await cancelWorkRootChange()
    } catch (error) {
      logger.warn('取消更换作品目录失败', { event: 'work_root.cancel.failed', error })
    }
  }, [])

  const openInFileManager = useCallback(async () => {
    try {
      await openWorkRoot()
    } catch (error) {
      showAlert('alerts.workRoot.openFailed', { message: errorDetail(error) })
    }
  }, [showAlert])

  return {
    currentPath,
    defaultPath,
    isCustom,
    isMigrating,
    progress,
    showProgress,
    canCancel: progress.phase !== null && CANCELLABLE_PHASES.has(progress.phase),
    alert,
    confirm,
    selectDirectory,
    openResetConfirm,
    closeConfirm,
    confirmMove,
    cancelMove,
    openInFileManager,
    closeAlert: () => setAlert((previous) => ({ ...previous, open: false })),
  }
}
