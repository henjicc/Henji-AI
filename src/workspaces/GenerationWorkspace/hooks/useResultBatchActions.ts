import { useCallback, useMemo, useState } from 'react'
import { notifyUser } from '@/contexts/NotificationContext'
import { createLogger } from '@/core/logging'
import { useI18n } from '@/hooks/useI18n'
import { basename, openDialog, saveDialog, showItemInFolder } from '@/platform/desktopApi'
import { useAddToAssetLibrary } from '@/features/assets/hooks/useAddToAssetLibrary'
import { addGenerationResultsToCanvas } from '@/features/canvas'
import { exportGenerationResults, type GenerationExportDestination, type GenerationResultSelection } from '@/features/generation/application/generationResultExport'
import { prepareVideoEditSendDestination, sendCreativeResultToVideoEdit } from '@/features/videoEdit/application/videoEditResultSend'
import { formatLocalDate } from '@/features/generation/domain/generationExportName'
import { useResultSelectionStore, type SelectableResult } from './resultSelection'

const logger = createLogger('workspaces.generation.batch_actions')

export type ResultBatchAction = 'export' | 'collect' | 'canvas' | 'video_edit' | 'delete'

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 选择带上的批量动作：导出（文件夹 / ZIP）、收进资产库、放到画布、发到剪辑、删除。
 * 每个动作都委托正式领域服务，界面只负责选目标与反馈；部分失败时把失败的留在选择里，可以直接重试。
 */
export function useResultBatchActions({ selectable, deleteRecords }: {
  selectable: readonly SelectableResult[]
  deleteRecords: (recordIds: readonly string[]) => Promise<void>
}) {
  const { t } = useI18n()
  const selected = useResultSelectionStore((state) => state.selected)
  const exitSelection = useResultSelectionStore((state) => state.exit)
  const setMany = useResultSelectionStore((state) => state.setMany)
  const { addMedia } = useAddToAssetLibrary()
  const [running, setRunning] = useState<ResultBatchAction | null>(null)

  const items = useMemo(() => selectable.filter(result => selected.has(result.key)), [selectable, selected])
  /**
   * 删除按整条记录进行：只有这条记录显示的每个结果都选上了才能删，免得把没选的几张一起删掉。
   * 没存到本机的结果不能选，所以有这种结果的记录也删不了，留给单条记录上的删除。
   */
  const deletableRecordIds = useMemo(() => {
    const selectedCount = new Map<string, { count: number; shown: number }>()
    for (const item of items) {
      const entry = selectedCount.get(item.taskId) ?? { count: 0, shown: item.shownCount }
      entry.count += 1
      selectedCount.set(item.taskId, entry)
    }
    return [...selectedCount.values()].every(entry => entry.count >= entry.shown) ? [...selectedCount.keys()] : null
  }, [items])

  /** 只把失败的留在选择里，成功的取消勾选：再点一次同一个动作就是“重试失败的”。 */
  const keepOnlyFailed = useCallback((failed: ReadonlyArray<{ recordId: string; outputIndex: number }>) => {
    const failedKeys = new Set(failed.map(item => `${item.recordId}#${item.outputIndex}`))
    setMany(items.filter(item => !failedKeys.has(item.key)).map(item => item.key), false)
  }, [items, setMany])

  const run = useCallback(async (action: ResultBatchAction, work: () => Promise<void>): Promise<void> => {
    if (running) return
    setRunning(action)
    try {
      await work()
    } catch (error) {
      logger.error('生成结果批量操作失败', { event: 'generation.batch_action.failed', action, count: items.length, error })
      notifyUser(t('ui:generationSelection.actionFailed', { reason: reasonOf(error) }), 'error')
    } finally {
      setRunning(null)
    }
  }, [items.length, running, t])

  const selections = useCallback((): GenerationResultSelection[] => items.map(item => ({ recordId: item.taskId, outputIndex: item.outputIndex })), [items])

  const exportTo = useCallback((destination: GenerationExportDestination) => run('export', async () => {
    const report = await exportGenerationResults(selections(), destination)
    const reveal = report.destination.mode === 'zip' ? report.destination.path : report.savedFiles[0] ?? report.destination.directory
    const open = { label: t('ui:generationSelection.openFolder'), onClick: () => void showItemInFolder(reveal) }
    if (report.failed.length === 0) {
      // 写出的名字可能因同名而顺延（“名称 (2).zip”），提示里写实际位置
      const target = basename(report.destination.mode === 'zip' ? report.destination.path : report.destination.directory)
      notifyUser(t('ui:generationSelection.exportDone', { count: report.savedFiles.length, target }), 'success', open)
      exitSelection()
      return
    }
    keepOnlyFailed(report.failed)
    notifyUser(t('ui:generationSelection.exportPartial', { saved: report.savedFiles.length, failed: report.failed.length, reason: report.failed[0].reason }), 'warning', report.savedFiles.length > 0 ? open : undefined)
  }), [exitSelection, keepOnlyFailed, run, selections, t])

  const exportToFolder = useCallback(async (directory?: string): Promise<void> => {
    const target = directory ?? await openDialog({ directory: true })
    if (typeof target === 'string' && target) await exportTo({ mode: 'folder', directory: target })
  }, [exportTo])

  const exportToZip = useCallback(async (): Promise<void> => {
    const target = await saveDialog({ defaultPath: `${t('ui:generationSelection.zipName')}_${formatLocalDate(new Date())}.zip`, filters: [{ name: 'ZIP', extensions: ['zip'] }] })
    if (!target) return
    await exportTo({ mode: 'zip', path: /\.zip$/i.test(target) ? target : `${target}.zip` })
  }, [exportTo, t])

  const collect = useCallback(() => run('collect', async () => {
    const failed: Array<{ recordId: string; outputIndex: number }> = []
    for (const item of items) {
      try {
        await addMedia({ filePath: item.filePath, mediaType: item.mediaType, source: 'generated' })
      } catch (error) {
        logger.warn('结果收进资产库失败', { event: 'generation.batch_action.collect_item_failed', recordId: item.taskId, outputIndex: item.outputIndex, error })
        failed.push({ recordId: item.taskId, outputIndex: item.outputIndex })
      }
    }
    if (failed.length === 0) {
      notifyUser(t('ui:generationSelection.collectDone', { count: items.length }))
      exitSelection()
      return
    }
    keepOnlyFailed(failed)
    notifyUser(t('ui:generationSelection.collectPartial', { saved: items.length - failed.length, failed: failed.length }), 'warning')
  }), [addMedia, exitSelection, items, keepOnlyFailed, run, t])

  const sendToCanvas = useCallback((projectId: string, name: string) => run('canvas', async () => {
    await addGenerationResultsToCanvas({ projectId, results: selections() })
    notifyUser(t('ui:generationSelection.canvasDone', { count: items.length, name }))
    exitSelection()
  }), [exitSelection, items.length, run, selections, t])

  const sendToVideoEdit = useCallback((projectId: string, name: string) => run('video_edit', async () => {
    // 目标剪辑在后台载入，不切走生成页
    await prepareVideoEditSendDestination(projectId)
    const failed: Array<{ recordId: string; outputIndex: number }> = []
    let firstError = ''
    for (const item of items) {
      try {
        await sendCreativeResultToVideoEdit({ type: 'generation', recordId: item.taskId, outputIndex: item.outputIndex }, { mediaKind: item.mediaType, mode: 'library', projectId })
      } catch (error) {
        firstError ||= reasonOf(error)
        failed.push({ recordId: item.taskId, outputIndex: item.outputIndex })
      }
    }
    if (failed.length === 0) {
      notifyUser(t('ui:generationSelection.videoEditDone', { count: items.length, name }))
      exitSelection()
      return
    }
    keepOnlyFailed(failed)
    notifyUser(t('ui:generationSelection.videoEditPartial', { saved: items.length - failed.length, failed: failed.length, reason: firstError }), 'warning')
  }), [exitSelection, items, keepOnlyFailed, run, t])

  const deleteSelected = useCallback(() => run('delete', async () => {
    if (!deletableRecordIds) return
    await deleteRecords(deletableRecordIds)
    notifyUser(t('ui:generationSelection.deleteDone', { count: deletableRecordIds.length }))
    exitSelection()
  }), [deleteRecords, deletableRecordIds, exitSelection, run, t])

  return { items, running, canDelete: deletableRecordIds !== null, exportToFolder, exportToZip, collect, sendToCanvas, sendToVideoEdit, deleteSelected }
}
