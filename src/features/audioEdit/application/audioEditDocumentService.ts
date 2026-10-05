import { AudioEditSourceMissingError } from '@/core/audioEdit/documentContent'
import type { DocumentContainerRef } from '@/core/documents/types'
import { createLogger } from '@/core/logging'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import type { DocumentLeaveOutcome } from '@/features/documents/documentSessionTypes'
import { openDialog } from '@/platform/desktopApi'
import { getPlatform } from '@/platform/runtime'

import { useAudioEditStore } from '../store/audioEditStore'
import {
  abandonAudioEditDocument,
  assignAudioEditSource,
  createAudioEditDraft,
  leaveAudioEditProject,
  loadAudioEditProject,
} from './audioEditProjectInstances'

/*
 * 口播文档的界面入口（3.3）：导入即建草稿、打开、离开（返回列表或切换文档）、编辑器里改名。
 * 列表、移动、副本、回收站都是通用文档操作（src/features/documents），这里不再有。
 */

const logger = createLogger('features.audioEdit.documents')

export const AUDIO_EDIT_MEDIA_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'mp4', 'mov', 'mkv', 'webm']

/** 用户取消了“保存 / 不保存 / 取消”里的取消：留在当前口播，不切换。 */
export class AudioEditLeaveCancelledError extends Error {
  constructor() {
    super('已取消，仍停留在当前口播。')
    this.name = 'AudioEditLeaveCancelledError'
  }
}

/** 选择一个音频或视频文件；取消返回 null。 */
export async function pickAudioEditMedia(title = '音频或视频'): Promise<string | null> {
  const selected = await openDialog({ multiple: false, filters: [{ name: title, extensions: AUDIO_EDIT_MEDIA_EXTENSIONS }] })
  const path = Array.isArray(selected) ? selected[0] : selected
  return path || null
}

/** 界面正在显示的另一份口播先走离开流程（草稿会询问保存）；取消时抛 AudioEditLeaveCancelledError。 */
async function leaveShownBefore(nextId: string | null): Promise<void> {
  const current = useAudioEditStore.getState().project?.id
  if (!current || current === nextId) return
  const outcome = await leaveAudioEditProject(current)
  if (outcome === 'cancelled') throw new AudioEditLeaveCancelledError()
  useAudioEditStore.getState().setProject(null)
}

function show(id: string): void {
  useAudioEditStore.getState().setProject({ id })
}

/**
 * 导入音频或视频即新建草稿（默认在作品目录“口播”文件夹，也可指定所在项目），并进入编辑器。
 * 素材默认引用原文件（重要记录 006）；名称是“未命名口播 N”，离开时起名。
 */
export async function importAudioEditMedia(sourcePath: string, container: DocumentContainerRef = { kind: 'user' }): Promise<string> {
  await leaveShownBefore(null)
  const source = await getPlatform().audioEdit.probeSource(sourcePath)
  const instance = await createAudioEditDraft(source, container)
  show(instance.document.id)
  return instance.document.id
}

/**
 * 打开口播进入编辑器（列表卡片、草稿区“继续编辑”、通用 open_document、工具首页最近文件共用）。
 * 界面正在编辑另一份时先离开它。还没有素材的口播（助手新建的空文档）先请用户导入，取消导入时放弃打开。
 * 返回是否已进入编辑器。
 */
export async function openAudioEditDocument(document: { id: string; path?: string }): Promise<boolean> {
  await leaveShownBefore(document.id)
  try {
    await loadAudioEditProject(document.id, document.path)
  } catch (error) {
    if (!(error instanceof AudioEditSourceMissingError)) throw error
    const sourcePath = await pickAudioEditMedia()
    if (!sourcePath) {
      await abandonAudioEditDocument(document.id)
      return false
    }
    await assignAudioEditSource(document.id, await getPlatform().audioEdit.probeSource(sourcePath))
  }
  show(document.id)
  return true
}

/** 编辑器“返回”：离开当前口播后回到列表；取消时留在编辑器。 */
export async function leaveAudioEditEditor(): Promise<DocumentLeaveOutcome> {
  const current = useAudioEditStore.getState().project?.id
  const outcome = current ? await leaveAudioEditProject(current) : 'closed'
  if (outcome === 'cancelled') return outcome
  useAudioEditStore.getState().setProject(null)
  logger.info('离开口播编辑器', { event: 'audio_edit.editor.leave.completed', context: { outcome } })
  return outcome
}

/** 编辑器文件菜单里的重命名：名称就是文件名，走通用文档改名（同文件夹重名时报错，不加后缀）。 */
export async function renameAudioEditDocument(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  await getDocumentOperations().renameDocument({ id }, trimmed)
}
