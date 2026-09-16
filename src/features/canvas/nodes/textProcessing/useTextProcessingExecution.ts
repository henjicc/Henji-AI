import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { attachCanvasGenerationFeedback } from '../../application/canvasDomainExecutors'
import { useProjectStore } from '@/stores/projectStore'
import { showAlertDialog } from '@/stores/alertDialogStore'

/** Views expose validation feedback; project executors own streaming and persistence. */
export function useTextProcessingExecution({ nodeId, setPromptInvalid }: {
  nodeId: string
  setPromptInvalid: (invalid: boolean) => void
}): void {
  const { t } = useTranslation()
  const latest = useRef({ setPromptInvalid, t })
  latest.current = { setPromptInvalid, t }
  const projectId = useProjectStore(state => state.currentProjectId)
  useEffect(() => projectId ? attachCanvasGenerationFeedback(projectId, nodeId,
    invalid => latest.current.setPromptInvalid(invalid), () => showAlertDialog({
      title: latest.current.t('common:error'),
      message: latest.current.t('node.textProcessing.noModelConfigured'),
      type: 'warning', settingsTarget: { tab: 'models', sectionId: 'models-providers' },
    })) : undefined, [projectId, nodeId])
}
