import i18n from '@/i18n'
import { useEffect, useRef } from 'react'
import { requestAlertConfirmation } from '@/stores/alertDialogStore'
import type { ExplanationSendRequest } from '../application/explanationGeneration'

export function ExplanationSendConfirmation(props: {
  request?: ExplanationSendRequest; generating: boolean; onCancel(): void; onSend(project?: boolean): void
}): null {
  const latest = useRef(props)
  latest.current = props
  useEffect(() => {
    const request = props.request
    if (!request) return
    const controller = new AbortController()
    let project = false
    void requestAlertConfirmation({ title: i18n.t('paidApproval.sendExplanation', { ns: 'common' }),
      message: i18n.t('paidApproval.explanationContent', { ns: 'common', count: request.imageCount, modelName: request.modelName }),
      paidDetails: request.paidDetails,
      confirmLabel: i18n.t('paidApproval.allowOnce', { ns: 'common' }), paidConfirmation: true, projectConfirmation: request.hasProject,
      onProject: () => { project = true },
    }, controller.signal).then(accepted => {
      if (controller.signal.aborted) return
      if (accepted) latest.current.onSend(project)
      else latest.current.onCancel()
    })
    return () => controller.abort()
  }, [props.request])
  return null
}
