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
  /** 有值时渲染「去设置」按钮并定位到该分节 */
  settingsTarget?: SettingsNavigationTarget
  /** 有值时渲染「复制错误详情」按钮；放完整技术信息（堆栈、响应体等） */
  detail?: string
}

interface AlertDialogState {
  /** 队列头即当前展示的弹窗；排队避免连续报错互相顶掉 */
  queue: AlertDialogRequest[]
  show: (request: AlertDialogRequest) => void
  dismissCurrent: () => void
}

export const useAlertDialogStore = create<AlertDialogState>((set) => ({
  queue: [],
  show: (request) => set((state) => ({ queue: [...state.queue, request] })),
  dismissCurrent: () => set((state) => ({ queue: state.queue.slice(1) })),
}))

/** 全局弹出一个提示/错误弹窗；可在非 React 环境调用 */
export function showAlertDialog(request: AlertDialogRequest): void {
  useAlertDialogStore.getState().show(request)
}
