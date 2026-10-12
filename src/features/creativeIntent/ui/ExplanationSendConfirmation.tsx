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
    void requestAlertConfirmation({ title: '发送讲解给 AI？',
      message: `你将发送讲解文字和 ${request.imageCount} 张画面给 ${request.modelName}。\n\n${request.costMessage}`,
      confirmLabel: '允许本次', paidConfirmation: true, projectConfirmation: request.hasProject,
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
