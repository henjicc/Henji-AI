import { create } from 'zustand'

import { createLogger } from '@/core/logging'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import { dirname } from '@/platform/desktopApi'
import { useSettingsStore, type LargeUploadStrategy } from '@/stores/settingsStore'

const logger = createLogger('services.largeUploadPolicy')

/** 大文件阈值：小于等于该值一律复制进数据目录，超过才应用用户策略 */
export const LARGE_UPLOAD_THRESHOLD_BYTES = 100 * 1024 * 1024

export type LargeUploadAction = 'copy' | 'reference'

export interface LargeUploadPromptRequest {
  fileName: string
  sizeMB: number
  resolve: (result: { action: LargeUploadAction; remember: boolean }) => void
}

interface LargeUploadPromptState {
  /** 排队中的询问请求；同时拖入多个大文件时逐个弹出 */
  queue: LargeUploadPromptRequest[]
  enqueue: (request: LargeUploadPromptRequest) => void
  settleCurrent: (action: LargeUploadAction, remember: boolean) => void
}

/** 大文件处理询问弹窗的全局状态（由根层 LargeUploadChoiceDialog 消费） */
export const useLargeUploadPromptStore = create<LargeUploadPromptState>((set, get) => ({
  queue: [],
  enqueue: (request) => set((state) => ({ queue: [...state.queue, request] })),
  settleCurrent: (action, remember) => {
    const current = get().queue[0]
    if (!current) {
      return
    }
    set((state) => ({ queue: state.queue.slice(1) }))
    current.resolve({ action, remember })
  },
}))

function promptUser(fileName: string, sizeBytes: number): Promise<{ action: LargeUploadAction; remember: boolean }> {
  return new Promise((resolve) => {
    useLargeUploadPromptStore.getState().enqueue({
      fileName,
      sizeMB: Math.round(sizeBytes / 1024 / 1024),
      resolve,
    })
  })
}

/**
 * 决定一个本地媒体文件在持久化时是"复制进数据目录"还是"直接引用原路径"。
 *
 * 规则（用户约定）：
 * - 无真实磁盘路径（剪贴板/合成 Blob）或体积 ≤ 100MB：一律复制，不打扰用户
 * - 超过 100MB：按设置执行；设置为"每次询问"时弹窗让用户选择，可记住选择
 */
export async function resolveLargeUploadAction(
  file: File,
  directPath: string | null
): Promise<LargeUploadAction> {
  if (!directPath || file.size <= LARGE_UPLOAD_THRESHOLD_BYTES) {
    return 'copy'
  }

  const strategy: LargeUploadStrategy = useSettingsStore.getState().largeUploadStrategy
  if (strategy === 'copy' || strategy === 'reference') {
    return strategy
  }

  const { action, remember } = await promptUser(file.name, file.size)
  if (remember) {
    useSettingsStore.getState().setLargeUploadStrategy(action)
    logger.info('大文件处理策略已记住', {
      event: 'large_upload.strategy.remembered',
      context: { action },
    })
  }
  return action
}

/**
 * 引用原文件路径前授权其所在目录给 henji-media 协议。
 * 授权在主进程持久化（allowed-media-roots.json），重启后仍可访问。
 */
export async function grantMediaAccessForReference(directPath: string): Promise<void> {
  if (!isDesktopRuntime()) {
    return
  }
  const dir = await dirname(directPath)
  await getPlatform().media.allowRoot(dir)
}
