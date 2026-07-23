import { AlertTriangle, Check, ShieldCheck, X } from 'lucide-react'

import { UiButton } from '@/components/ui'
import type { AgentApprovalRequest } from '@/core/assistant/events'

interface ApprovalCardProps {
  approval: AgentApprovalRequest
  onDecision: (decision: 'approve' | 'reject') => void
}

export function ApprovalCard({ approval, onDecision }: ApprovalCardProps): JSX.Element {
  const expired = Date.parse(approval.expiresAt) <= Date.now()
  const targets = Object.entries(approval.targetIds)

  return (
    <section className="rounded-xl border border-warning/40 bg-warning/10 p-3" aria-label="等待审批">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 rounded-lg border border-warning/30 bg-warning/10 p-1.5 text-warning">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-text-dark">{approval.title}</h3>
            <span className="rounded border border-warning/30 px-1.5 py-0.5 text-[10px] text-warning">{approval.risk}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-text-muted">{approval.summary}</p>
        </div>
      </div>

      <dl className="mt-3 grid gap-1.5 rounded-lg border border-border-dark bg-app/60 p-2.5 text-[11px] text-text-muted">
        <div className="flex justify-between gap-3"><dt>权限</dt><dd className="break-all text-right text-text-dark">{approval.permission}</dd></div>
        <div className="flex justify-between gap-3"><dt>作用域</dt><dd className="break-all text-right text-text-dark">{approval.scope}</dd></div>
        <div className="flex justify-between gap-3"><dt>可撤销</dt><dd className="text-text-dark">{approval.reversible ? '是' : '否'}</dd></div>
        <div className="flex justify-between gap-3"><dt>有效期</dt><dd className="text-text-dark">{new Date(approval.expiresAt).toLocaleTimeString()}</dd></div>
        {targets.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-3"><dt>{key}</dt><dd className="break-all text-right text-text-dark">{value}</dd></div>
        ))}
      </dl>

      {approval.risk === 'R3' ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
          <AlertTriangle className="h-3.5 w-3.5" />高风险操作仅授权本次，不会被记住。
        </div>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <UiButton type="button" size="sm" variant="muted" disabled={expired} onClick={() => onDecision('reject')} className="gap-1.5">
          <X className="h-3.5 w-3.5" />拒绝
        </UiButton>
        <UiButton type="button" size="sm" variant="primary" disabled={expired} onClick={() => onDecision('approve')} className="gap-1.5">
          <Check className="h-3.5 w-3.5" />仅批准本次
        </UiButton>
      </div>
      {expired ? <div className="mt-2 text-right text-[11px] text-danger">本次审批已过期</div> : null}
    </section>
  )
}
