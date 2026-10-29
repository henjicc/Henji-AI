import { create } from 'zustand'
import { withApplicationConfirmation, hasApplicationConfirmation, requestApplicationPaidApproval, USER_CONFIRMATION_TIMEOUT_MS } from '@/core/application-control/userConfirmation'
import { paidApprovalMessage, type PaidApprovalDisplay, type PaidApprovalRequest } from '@/core/application-control/paidApproval'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'

import type { SettingsNavigationTarget } from '@/core/types/settingsNavigation'
import type { OperationReviewItem } from '@/core/application-control/operationReview'

export type AlertDialogType = 'info' | 'warning' | 'error'

/**
 * 一次弹窗请求。
 *
 * 动作按钮是声明式的：调用方只描述"这个错误能不能去设置""有没有技术细节可复制"，
 * 具体渲染成哪些按钮、按钮文案、点击后做什么，全部由 GlobalAlertDialog 统一决定。
 * 这样调用方不需要碰 i18n 之外的东西，也不需要知道 uiStore 的存在。
 */
export interface AlertDialogRequest {
  review?: Pick<OperationReviewItem, 'operationId' | 'callerId' | 'preferred'> & { resolve: (decision: 'completed' | 'not_executed' | 'later') => void }
  paidDetails?: PaidApprovalDisplay
  title: string
  message: string
  contentTrustChallenge?: string
  cancelLabel?: string
  onDecision?: (accepted: boolean) => Promise<void>
  type?: AlertDialogType
  /** 只有用户点击明确的确认按钮才接受；关闭、Escape、取消均拒绝。tone=danger 用于删除等破坏性确认（危险实底按钮）。 */
  confirmation?: { label: string; tone?: 'default' | 'danger'; paid?: boolean; alwaysAllowLabel?: string; resolve: (confirmed: boolean, alwaysAllow?: boolean) => void }
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
  confirmCurrent: (alwaysAllow?: boolean) => void
}

export const useAlertDialogStore = create<AlertDialogState>((set, get) => ({
  queue: [],
  show: (request) => set((state) => ({ queue: [...state.queue, request] })),
  dismissCurrent: () => {
    const current = get().queue[0]
    if (current?.confirmation) current.confirmation.resolve(false)
    else if (current?.review) current.review.resolve('later')
    else set((state) => ({ queue: state.queue.slice(1) }))
  },
  confirmCurrent: (alwaysAllow) => get().queue[0]?.confirmation?.resolve(true, alwaysAllow),
}))

/** 全局弹出一个提示/错误弹窗；可在非 React 环境调用 */
export function showAlertDialog(request: AlertDialogRequest): void {
  useAlertDialogStore.getState().show(request)
}

/** 一次性的人机确认；任务中止时精确移除自己的弹窗，不影响其他排队提示。 */
export async function requestAlertConfirmation(
  request: Omit<AlertDialogRequest, 'confirmation'> & { confirmLabel: string; confirmTone?: 'default' | 'danger'; paid?: PaidApprovalRequest; paidConfirmation?: boolean; alwaysAllowLabel?: string; onAlwaysAllow?: () => void },
  signal?: AbortSignal,
): Promise<boolean> {
  if (request.paid && hasApplicationConfirmation(signal)) {
    const paid = request.paid
    const decision = await requestApplicationPaidApproval(signal!, paid)
    if (decision.decision === 'deny') throw new ApplicationPreflightFailure(decision.reason)
    if (decision.decision === 'auto') return true
    const confirmation = { title: request.title, message: request.message, confirmLabel: request.confirmLabel, paid: decision }
    return withApplicationConfirmation(signal, confirmation, async scopedSignal => {
      const accepted = await showAlertConfirmation({ ...request, message: confirmation.message, confirmLabel: confirmation.confirmLabel,
        paidDetails: paidApprovalMessage(decision, paid.category), paidConfirmation: true }, scopedSignal)
      if (accepted) {
        scopedSignal?.throwIfAborted()
        const approved = await requestApplicationPaidApproval(signal!, paid, 'once')
        if (approved.decision === 'deny') throw new ApplicationPreflightFailure(approved.reason)
      }
      return accepted
    })
  }
  if (request.paidConfirmation && !hasApplicationConfirmation(signal)) {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const expiresAt = request.paidDetails?.expiresAt ?? Date.now() + USER_CONFIRMATION_TIMEOUT_MS
    if (expiresAt <= Date.now()) abort()
    const timer = setTimeout(abort, Math.max(0, expiresAt - Date.now()))
    try { return await showAlertConfirmation(request, controller.signal, expiresAt) }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  return withApplicationConfirmation(signal, { title: request.title, message: request.message, confirmLabel: request.confirmLabel }, scopedSignal => showAlertConfirmation(request, scopedSignal))
}

function showAlertConfirmation(
  request: Omit<AlertDialogRequest, 'confirmation'> & { confirmLabel: string; confirmTone?: 'default' | 'danger'; paidConfirmation?: boolean; alwaysAllowLabel?: string; onAlwaysAllow?: () => void },
  signal?: AbortSignal,
  expiresAt?: number,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise<boolean>(resolve => {
    let settled = false
    const finish = (confirmed: boolean, alwaysAllow?: boolean): void => {
      if (settled) return
      settled = true
      confirmed = confirmed && !signal?.aborted && (expiresAt === undefined || Date.now() < expiresAt)
      if (confirmed && alwaysAllow) request.onAlwaysAllow?.()
      signal?.removeEventListener('abort', abort)
      useAlertDialogStore.setState(state => ({ queue: state.queue.filter(item => item.confirmation !== entry.confirmation) }))
      resolve(confirmed && !signal?.aborted)
    }
    const abort = (): void => finish(false)
    const { confirmLabel, confirmTone, paidConfirmation, alwaysAllowLabel, onAlwaysAllow: _onAlwaysAllow, ...rest } = request
    const entry: AlertDialogRequest = { ...rest, confirmation: { label: confirmLabel, tone: confirmTone, paid: paidConfirmation, alwaysAllowLabel, resolve: finish } }
    signal?.addEventListener('abort', abort, { once: true })
    showAlertDialog(entry)
    if (signal?.aborted) abort()
  }).then(async accepted => {
    if (!signal?.aborted) await request.onDecision?.(accepted)
    return accepted
  })
}
