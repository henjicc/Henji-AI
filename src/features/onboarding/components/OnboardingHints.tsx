import { CheckCircle2, Sparkles } from 'lucide-react'

import { UI_TEXT_META_CLASS, UI_TEXT_SECTION_CLASS, UiButton, UiPanel } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { onboardingManager } from '../application/onboardingManager'
import { useOnboardingState } from '../application/useOnboardingState'

const FIRST_TASK_HINT_ID = 'first-task-coach'
const FIRST_TASK_SUCCESS_HINT_ID = 'first-task-success'

export function OnboardingHints(): JSX.Element | null {
  const { t } = useI18n('onboarding')
  const state = useOnboardingState()
  const showCoach = state.status === 'in_progress'
    && state.firstTaskPrepared
    && !state.firstTaskCompleted
    && !state.shownHintIds.includes(FIRST_TASK_HINT_ID)
  const showSuccess = state.status === 'completed'
    && state.firstTaskCompleted
    && !state.shownHintIds.includes(FIRST_TASK_SUCCESS_HINT_ID)
  if (!showCoach && !showSuccess) return null

  const hintId = showSuccess ? FIRST_TASK_SUCCESS_HINT_ID : FIRST_TASK_HINT_ID
  return (
    <UiPanel
      variant="glass"
      className="fixed bottom-5 left-1/2 z-toast flex w-[min(92vw,34rem)] -translate-x-1/2 items-start gap-3 p-4"
      role="status"
      aria-live="polite"
    >
      {showSuccess
        ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        : <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-accent" />}
      <div className="min-w-0 flex-1">
        <div className={UI_TEXT_SECTION_CLASS}>{t(showSuccess ? 'coach.successTitle' : 'coach.title')}</div>
        <p className={`mt-1 leading-5 ${UI_TEXT_META_CLASS}`}>{t(showSuccess ? 'coach.successDescription' : 'coach.description')}</p>
      </div>
      <UiButton
        variant="plain"
        size="sm"
        className="shrink-0"
        onClick={() => onboardingManager.markHintShown(hintId)}
      >
        {t('actions.dismiss')}
      </UiButton>
    </UiPanel>
  )
}
