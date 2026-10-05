import { create } from 'zustand'

import type { SettingsNavigationTarget } from '@/core/types/settingsNavigation'

export type AlertDialogType = 'info' | 'warning' | 'error'

/**
 * 一次弹窗请求。
 *
 * 动作按钮是声明式的：调用方只描述"这个错误能不能去设置""有没有技术细节可复制"，
 * 具体渲染成哪些按钮、按钮文案、点击后做什么，全部由 GlobalAlertDialog 统一决定。
 * 这样调用方不需要碰 i18n 之外的东西，也不需要知道 uiStore 的存在。
 */
export interface AlertDialogRequest {
  title: string
  message: string
  type?: AlertDialogType
  /** 只有用户点击明确的确认按钮才接受；关闭、Escape、取消均拒绝。tone=danger 用于删除等破坏性确认（危险实底按钮）。 */
  confirmation?: { label: string; tone?: 'default' | 'danger'; resolve: (confirmed: boolean) => void }
  /** 有值时渲染设置动作并定位到该分节；API 密钥分节会显示「去配置」 */
  settingsTarget?: SettingsNavigationTarget
  /** 有值时渲染「复制错误详情」按钮；放完整技术信息（堆栈、响应体等） */
  detail?: string
  /** 可选诊断关联信息；完整技术详情不会自动发送给模型。 */
  diagnostic?: {
    requestId?: string
    taskId?: string
    errorCode?: string
    domain?: string
    occurredAt?: string
  }
}

interface AlertDialogState {
  /** 队列头即当前展示的弹窗；排队避免连续报错互相顶掉 */
  queue: AlertDialogRequest[]
  show: (request: AlertDialogRequest) => void
  dismissCurrent: () => void
  confirmCurrent: () => void
}

export const useAlertDialogStore = create<AlertDialogState>((set, get) => ({
  queue: [],
  show: (request) => set((state) => ({ queue: [...state.queue, request] })),
  dismissCurrent: () => {
    const current = get().queue[0]
    if (current?.confirmation) current.confirmation.resolve(false)
    else set((state) => ({ queue: state.queue.slice(1) }))
  },
  confirmCurrent: () => get().queue[0]?.confirmation?.resolve(true),
}))

/** 全局弹出一个提示/错误弹窗；可在非 React 环境调用 */
export function showAlertDialog(request: AlertDialogRequest): void {
  useAlertDialogStore.getState().show(request)
}

/** 一次性的人机确认；任务中止时精确移除自己的弹窗，不影响其他排队提示。 */
export function requestAlertConfirmation(
  request: Omit<AlertDialogRequest, 'confirmation'> & { confirmLabel: string; confirmTone?: 'default' | 'danger' },
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise(resolve => {
    let settled = false
    const finish = (confirmed: boolean): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      useAlertDialogStore.setState(state => ({ queue: state.queue.filter(item => item !== entry) }))
      resolve(confirmed && !signal?.aborted)
    }
    const abort = (): void => finish(false)
    const { confirmLabel, confirmTone, ...rest } = request
    const entry: AlertDialogRequest = { ...rest, confirmation: { label: confirmLabel, tone: confirmTone, resolve: finish } }
    signal?.addEventListener('abort', abort, { once: true })
    showAlertDialog(entry)
    if (signal?.aborted) abort()
  })
}
