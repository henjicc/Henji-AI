import { z } from 'zod'
import { ApplicationPreflightFailure } from './execution/transactionFailure'
import { type PaidOperationReceipt, paidApprovalDecisionSchema, paidApprovalRequestSchema, type PaidApprovalRequest, type PaidApprovalDecision } from './paidApproval'

// Human response deadline, not a limit on document size or task execution time.
export const USER_CONFIRMATION_TIMEOUT_MS = 5 * 60_000
export const applicationOperationStateSchema = z.enum(['prepared', 'preparing', 'awaiting_user_confirmation', 'executing', 'completed', 'not_executed', 'rolled_back', 'partial', 'unknown'])
export type ApplicationOperationState = z.infer<typeof applicationOperationStateSchema>
export const applicationUserConfirmationSchema = z.object({
  title: z.string(), message: z.string(), confirmLabel: z.string(),
  location: z.string(), expiresAt: z.number().nullable(), continuation: z.string(),
  purpose: z.enum(['execution', 'review']),
  paid: paidApprovalDecisionSchema.optional(),
}).strict()
export type ApplicationUserConfirmation = z.infer<typeof applicationUserConfirmationSchema>
export type ApplicationConfirmationProgress =
  | { phase: 'awaiting_user_confirmation'; confirmation: ApplicationUserConfirmation }
  | { phase: 'executing' }
  | { phase: 'paid_approval'; request: PaidApprovalRequest; consent?: 'once' }
export const paidApprovalProgressSchema = z.object({ phase: z.literal('paid_approval'), request: paidApprovalRequestSchema, consent: z.literal('once').optional() }).strict()
type ProgressSink = (progress: ApplicationConfirmationProgress) => Promise<unknown>
const receipts = new WeakMap<AbortSignal, PaidOperationReceipt>()
export function bindPaidOperationReceipt(signal: AbortSignal, receipt: PaidOperationReceipt, category: PaidApprovalRequest['category']): () => void {
  receipts.set(signal, receipt)
  paidApprovals.set(signal, new Set([category]))
  return () => { receipts.delete(signal); paidApprovals.delete(signal) }
}
export function applicationPaidOperationReceipt(signal: AbortSignal): PaidOperationReceipt | undefined { return receipts.get(signal) }

const scopes = new WeakMap<AbortSignal, ProgressSink>()
const paidApprovals = new WeakMap<AbortSignal, Set<PaidApprovalRequest['category']>>()

/** Scope by the trusted invocation signal; concurrent UI actions never inherit another caller. */
export function bindApplicationConfirmation(signal: AbortSignal, sink: ProgressSink, receipt?: PaidOperationReceipt): () => void {
  scopes.set(signal, sink)
  if (receipt) receipts.set(signal, receipt)
  return () => { scopes.delete(signal); paidApprovals.delete(signal); receipts.delete(signal) }
}
export function hasApplicationPaidApproval(signal: AbortSignal, category: PaidApprovalRequest['category']): boolean {
  return !signal.aborted && !!paidApprovals.get(signal)?.has(category)
}
export function hasApplicationConfirmation(signal?: AbortSignal): boolean { return !!signal && scopes.has(signal) }
/** A cancellable domain subtask keeps its parent's trusted approval sink, never a UI fallback. */
export function inheritApplicationConfirmation(parent: AbortSignal, child: AbortSignal): () => void {
  const sink = scopes.get(parent)
  return sink ? bindApplicationConfirmation(child, sink, receipts.get(parent)) : () => undefined
}
export async function requestApplicationPaidApproval(signal: AbortSignal, request: PaidApprovalRequest, consent?: 'once'): Promise<PaidApprovalDecision> {
  signal.throwIfAborted()
  const sink = scopes.get(signal)
  if (!sink) throw new ApplicationPreflightFailure('付费授权所属的调用已结束。')
  try {
    const result = paidApprovalDecisionSchema.parse(await sink({ phase: 'paid_approval', request, consent }))
    signal.throwIfAborted()
    if (result.decision === 'auto' || result.decision !== 'deny' && consent) {
      const approved = paidApprovals.get(signal) ?? new Set<PaidApprovalRequest['category']>()
      approved.add(request.category); paidApprovals.set(signal, approved)
    }
    return result
  } catch (error) { throw new ApplicationPreflightFailure(error) }
}

export function applicationUserConfirmation(request: { title: string; message: string; confirmLabel: string; paid?: PaidApprovalDecision }, purpose: ApplicationUserConfirmation['purpose'] = 'execution'): ApplicationUserConfirmation {
  return { ...request, purpose, location: '痕迹AI主窗口的确认对话框（如有其他提示，会依次显示）',
    expiresAt: purpose === 'review' ? null : Date.now() + USER_CONFIRMATION_TIMEOUT_MS,
    continuation: purpose === 'review' ? '用户已收到提示，可在应用中处理。稍后处理不会解除保护；用原 operationId 查询 get_application_operation，不要重复提交。'
      : '请用户在应用中确认；确认后应用自动继续。用原 operationId 查询 get_application_operation，不要重复提交。' }
}

/** Acknowledge the durable waiting/executing transition before allowing any paid or modifying continuation. */
export async function withApplicationConfirmation(
  signal: AbortSignal | undefined,
  request: { title: string; message: string; confirmLabel: string; paid?: PaidApprovalDecision },
  prompt: (signal?: AbortSignal) => Promise<boolean>,
): Promise<boolean> {
  const sink = signal && scopes.get(signal)
  if (!sink) return prompt(signal)
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal!.addEventListener('abort', abort, { once: true })
  if (signal!.aborted) abort()
  const timer = setTimeout(abort, USER_CONFIRMATION_TIMEOUT_MS)
  try {
    await sink({ phase: 'awaiting_user_confirmation', confirmation: applicationUserConfirmation(request) })
    if (controller.signal.aborted) throw new ApplicationPreflightFailure('确认已取消或超时；未执行本次操作，也未提交付费请求。')
    const accepted = await prompt(controller.signal)
    if (!accepted || controller.signal.aborted) throw new ApplicationPreflightFailure('用户拒绝、取消或确认已超时；未执行本次操作，也未提交付费请求。')
    await sink({ phase: 'executing' })
    signal!.throwIfAborted()
    return true
  } catch (error) {
    // This boundary is only for consent before side effects; rejection/failed acknowledgement
    // must not be mistaken for an ambiguous paid submission.
    throw error instanceof ApplicationPreflightFailure ? error : new ApplicationPreflightFailure(error)
  } finally {
    clearTimeout(timer)
    signal!.removeEventListener('abort', abort)
    controller.abort()
  }
}
