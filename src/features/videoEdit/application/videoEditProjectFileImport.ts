import type { z } from 'zod'

import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { ApplicationTransactionFailure } from '@/core/application-control/execution/transactionFailure'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { importVideoEditProjectFilesCapability, VIDEO_EDIT_PROJECT_IMPORT_ITEM_LIMIT, VIDEO_EDIT_PROJECT_IMPORT_SKIP_LIMIT } from '@/core/application-control/domains/videoEdit/videoEditProjectFileImportCapability'
import { createLogger } from '@/core/logging'
import { VideoEditOperationFailure } from '@/core/videoEdit/operationFailure'
import { getPlatform } from '@/platform/runtime'
import { importVideoEditPathsAndFolders, isVideoEditImportableFile, VideoEditPartialImportFailure, type VideoEditImportSkip, type VideoEditImportSkipReason } from './videoEditFolderImport'
import { videoEditMediaPathKey } from './videoEditMedia'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.projectFileImport')
type Output = z.infer<typeof importVideoEditProjectFilesCapability.outputSchema>
type DocumentRef = { kind: 'video_edit.document'; id: string }

/**
 * 导入中途失败或取消时已导入的部分保留在剪辑里：先保存，再如实报告“部分执行、不可重放”。
 * 文件夹选择导入与项目文件导入共用这一段收尾，不各写一份。
 */
export async function settleVideoEditPartialImport(error: unknown, owner: VideoEditInstance, documentRef: DocumentRef): Promise<never> {
  if (!(error instanceof VideoEditPartialImportFailure)) throw error
  const id = documentRef.id
  if (requireVideoEditInstance(id) !== owner) throw new Error('原剪辑已关闭，未写入重新打开的剪辑。', { cause: error })
  try { await saveVideoEdit(id) } catch (saveError) {
    throw new ApplicationPersistenceFailure('已导入部分保留在剪辑里，但保存未确认。请重试保存，不要重复导入。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: documentRef, replayMutation: false } }, saveError)
  }
  throw new ApplicationTransactionFailure({ status: 'failed', code: 'EXECUTION_FAILED', message: `${error.message}已保留 ${error.imported} 个素材，可读回当前剪辑或撤销本次导入。`, recoverable: false,
    resultRefs: [documentRef], effects: [{ effect: 'execute', entityType: 'video_edit.document', refs: [documentRef], propertyIds: [], origin: { kind: 'direct' } }],
    partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] },
  })
}

/** 第一次写入之前的拒绝：带上领域事实，并告诉执行层没有改动任何东西，修正输入后可直接重试。 */
function rejectBeforeWrite(message: string, facts: Record<string, unknown>): Error {
  return notExecutedFailure(new VideoEditOperationFailure(message, facts))
}

const SKIP_MESSAGES: Record<VideoEditImportSkipReason, string> = {
  unsupported: '格式不支持，没有导入。',
  duplicate: '同一文件在本次请求里重复出现，只导入一次。',
  unreadable: '读不出或无法解码，已跳过。',
  repeated_folder: '目录回环或同一目录重复给出，已跳过。',
  outside_project: '真实位置不在项目文件夹内（符号链接或联接点指向项目外），已跳过。',
}

/** 项目文件夹（真实路径）以内的位置写成 `/` 分隔的相对路径；不在其中时只给文件名，不外露绝对路径。 */
function projectRelative(root: string, path: string): string {
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/+$/, '')
  if (videoEditMediaPathKey(path).startsWith(`${videoEditMediaPathKey(normalizedRoot)}/`)) return path.replaceAll('\\', '/').slice(normalizedRoot.length + 1)
  return path.split(/[\\/]/).at(-1) || path
}

/**
 * 助手导入项目文件夹里的素材：渲染层只传项目内相对路径，主进程按真实路径判断是否仍在项目内并换成真实路径，
 * 随后交给拖入与文件夹导入共用的正式导入服务（同一队列、素材箱规则、去重、分批出现与一步撤销）；
 * 递归读取以项目文件夹为边界，子文件夹里指向项目外的链接与联接点跳过。日志只记相对路径。
 */
export async function importVideoEditProjectFiles(raw: unknown, signal: AbortSignal): Promise<Output> {
  const input = importVideoEditProjectFilesCapability.inputSchema.parse(raw)
  const documentRef: DocumentRef = input.documentRef; const id = documentRef.id
  const owner = requireVideoEditInstance(id)
  const container = owner.session.documentMeta.container
  if (container.kind !== 'project') throw rejectBeforeWrite('这份剪辑不在项目里，没有可导入的项目文件夹。请先用 move_document 把剪辑移进项目，或改用 import_video_edit_folder 请用户选择文件夹。', { reason: 'not_in_project' })
  let binId: string | undefined
  if (input.binRef) {
    const childId = input.binRef.id.startsWith(`${id}:`) ? input.binRef.id.slice(id.length + 1) : undefined
    if (!childId || !owner.document.bins.some(bin => bin.id === childId)) throw rejectBeforeWrite(`目标素材箱 ${input.binRef.id} 不属于这份剪辑或已不存在；请重新读取 video_edit.bin 列表，或省略 binRef 放在顶层。`, { reason: 'reference_missing', binRef: input.binRef })
    binId = childId
  }
  logger.info('项目文件导入开始', { event: 'video_edit.media.project_import.start', context: { documentId: id, projectId: container.projectId, count: input.paths.length } })
  try {
    // 解析只读文件系统；失败（项目被移走、无权访问）时还没有写入任何东西。
    const resolution = await getPlatform().documents.resolveProjectFiles({ projectId: container.projectId, paths: input.paths }).catch((error: unknown) => { throw notExecutedFailure(error) })
    signal.throwIfAborted()
    const rejected = resolution.entries.flatMap(entry => entry.status === 'rejected' ? [entry] : [])
    if (rejected.length) {
      logger.info('项目文件导入被拒绝', { event: 'video_edit.media.project_import.rejected', context: { documentId: id, rejected: rejected.map(entry => entry.reason) } })
      throw rejectBeforeWrite(`有 ${rejected.length} 条路径不能导入，本次没有导入任何内容：${rejected.map(entry => entry.message).join('；')}`, {
        reason: 'project_path_rejected', rejected: rejected.map(entry => ({ path: entry.input, reason: entry.reason, message: entry.message })),
      })
    }
    const unsupported: Output['skipped'] = []; const paths: string[] = []
    for (const entry of resolution.entries) {
      if (entry.status !== 'resolved') continue
      if (entry.kind === 'file' && !isVideoEditImportableFile(entry.path)) unsupported.push({ relativePath: entry.relativePath, reason: 'unsupported', message: SKIP_MESSAGES.unsupported })
      else paths.push(entry.path)
    }
    if (requireVideoEditInstance(id) !== owner) throw notExecutedFailure(new Error('原剪辑已关闭，未写入重新打开的剪辑。'))
    const existingItems = new Set(owner.document.items.map(item => item.id))
    const skips: VideoEditImportSkip[] = []
    let itemIds: string[] = []
    if (paths.length) {
      try {
        itemIds = (await importVideoEditPathsAndFolders(id, paths, binId, undefined, { signal, boundary: resolution.root, skipUnreadableFiles: true, onSkipped: value => skips.push(value) })).itemIds
      } catch (error) { await settleVideoEditPartialImport(error, owner, documentRef) }
    }
    await saveVideoEdit(id)
    const current = requireVideoEditInstance(id)
    if (current !== owner) throw new Error('原剪辑已关闭，导入回执不会写入重新打开的剪辑。')
    const verified = await verifyVideoEditSaved(id, current.document)
    const items = new Map(current.document.items.map(item => [item.id, item])); const media = new Map(current.document.media.map(value => [value.id, value]))
    const entry = (itemId: string, status: 'imported' | 'reused'): Output['items'][number] | undefined => {
      const item = items.get(itemId); const source = item?.mediaId ? media.get(item.mediaId) : undefined
      if (!item || !source) return undefined
      return { itemRef: { kind: 'video_edit.item', id: `${id}:${item.id}` }, mediaRef: { kind: 'video_edit.media', id: `${id}:${source.id}` }, binRef: item.binId ? { kind: 'video_edit.bin', id: `${id}:${item.binId}` } : null,
        relativePath: projectRelative(resolution.root, source.path), status }
    }
    // 去重跳过带回的是目标素材箱里原有的素材项（可能来自排在前面的导入请求），一律算复用。
    const statuses = new Map<string, 'imported' | 'reused'>()
    for (const itemId of itemIds) if (!statuses.has(itemId)) statuses.set(itemId, existingItems.has(itemId) ? 'reused' : 'imported')
    for (const value of skips) if (value.reason === 'duplicate' && value.itemId && !statuses.has(value.itemId)) statuses.set(value.itemId, 'reused')
    const listed = [...statuses].flatMap(([itemId, status]) => entry(itemId, status) ?? [])
    const all = [...listed.filter(value => value.status === 'imported'), ...listed.filter(value => value.status === 'reused')]
    const skipped = [...unsupported, ...skips.filter(value => !(value.reason === 'duplicate' && value.itemId)).map(value => ({ relativePath: projectRelative(resolution.root, value.path), reason: value.reason, message: SKIP_MESSAGES[value.reason] }))]
    const importedCount = all.filter(value => value.status === 'imported').length; const reusedCount = all.length - importedCount
    const truncated = all.length > VIDEO_EDIT_PROJECT_IMPORT_ITEM_LIMIT || skipped.length > VIDEO_EDIT_PROJECT_IMPORT_SKIP_LIMIT
    logger.info('项目文件导入完成', { event: 'video_edit.media.project_import.completed', context: { documentId: id, relativePaths: resolution.entries.flatMap(value => value.status === 'resolved' ? [value.relativePath] : []), imported: importedCount, reused: reusedCount, skipped: skipped.length } })
    return {
      resultRef: documentRef, items: all.slice(0, VIDEO_EDIT_PROJECT_IMPORT_ITEM_LIMIT), skipped: skipped.slice(0, VIDEO_EDIT_PROJECT_IMPORT_SKIP_LIMIT),
      importedCount, reusedCount, skippedCount: skipped.length, truncated,
      message: `已导入 ${importedCount} 个素材${reusedCount ? `，${reusedCount} 个已在素材箱里（复用原素材项）` : ''}${skipped.length ? `，跳过 ${skipped.length} 项` : ''}。${truncated ? '回执只逐项列出一部分，其余可读 video_edit.item 列表。' : ''}`,
      verification: { verified, target: documentRef, condition: '已从剪辑文件回读并核对导入的素材与素材箱。' },
    }
  } catch (error) {
    if (!(error instanceof VideoEditOperationFailure)) logger.info('项目文件导入未完成', { event: 'video_edit.media.project_import.failed', error, context: { documentId: id, cancelled: signal.aborted } })
    throw error
  }
}
