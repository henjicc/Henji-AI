import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, CheckCircle2, Sparkles } from 'lucide-react'

import {
  UI_COLOR_ACCENT_TEXT_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
  UiButton,
  UiPanel,
} from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { onboardingManager } from '../application/onboardingManager'
import { useOnboardingState } from '../application/useOnboardingState'

const FIRST_TASK_SUCCESS_HINT_ID = 'first-task-success'

const COACH_STAGES = [
  {
    id: 'first-task-model',
    target: 'model',
    titleKey: 'coach.modelTitle',
    descriptionKey: 'coach.modelDescription',
  },
  {
    id: 'first-task-prompt',
    target: 'prompt',
    titleKey: 'coach.promptTitle',
    descriptionKey: 'coach.promptDescription',
  },
  {
    id: 'first-task-generate',
    target: 'generate',
    titleKey: 'coach.generateTitle',
    descriptionKey: 'coach.generateDescription',
  },
] as const

interface HighlightGeometry {
  top: number
  left: number
  width: number
  height: number
  popoverTop: number
  popoverLeft: number
  popoverWidth: number
  arrowLeft: number
  popoverAbove: boolean
}

function measureTarget(target: Element): HighlightGeometry | null {
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  const highlightPadding = 6
  const viewportPadding = 16
  const popoverGap = 14
  const estimatedPopoverHeight = 172
  const popoverWidth = Math.min(360, window.innerWidth - viewportPadding * 2)
  const popoverAbove = rect.top >= estimatedPopoverHeight + popoverGap + viewportPadding
  const popoverTop = popoverAbove
    ? Math.max(viewportPadding, rect.top - estimatedPopoverHeight - popoverGap)
    : Math.min(window.innerHeight - estimatedPopoverHeight - viewportPadding, rect.bottom + popoverGap)
  const popoverLeft = Math.max(
    viewportPadding,
    Math.min(
      rect.left + rect.width / 2 - popoverWidth / 2,
      window.innerWidth - popoverWidth - viewportPadding,
    ),
  )
  const arrowLeft = Math.max(24, Math.min(
    rect.left + rect.width / 2 - popoverLeft - 8,
    popoverWidth - 40,
  ))

  return {
    top: rect.top - highlightPadding,
    left: rect.left - highlightPadding,
    width: rect.width + highlightPadding * 2,
    height: rect.height + highlightPadding * 2,
    popoverTop,
    popoverLeft,
    popoverWidth,
    arrowLeft,
    popoverAbove,
  }
}

function useHighlightGeometry(targetId: string | null): HighlightGeometry | null {
  const [geometry, setGeometry] = useState<HighlightGeometry | null>(null)

  useEffect(() => {
    if (!targetId) {
      setGeometry(null)
      return undefined
    }

    let observedTarget: Element | null = null
    let resizeObserver: ResizeObserver | null = null
    const update = (): void => {
      const nextTarget = document.querySelector(`[data-onboarding-target="${targetId}"]`)
      if (nextTarget !== observedTarget) {
        resizeObserver?.disconnect()
        observedTarget = nextTarget
        if (observedTarget) {
          resizeObserver = new ResizeObserver(update)
          resizeObserver.observe(observedTarget)
        }
      }
      setGeometry(observedTarget ? measureTarget(observedTarget) : null)
    }

    update()
    const mutationObserver = new MutationObserver(update)
    mutationObserver.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [targetId])

  return geometry
}

export function OnboardingHints(): JSX.Element | null {
  const { t } = useI18n('onboarding')
  const state = useOnboardingState()
  const stageIndex = useMemo(() => COACH_STAGES.findIndex(
    (stage) => !state.shownHintIds.includes(stage.id),
  ), [state.shownHintIds])
  const stage = stageIndex >= 0 ? COACH_STAGES[stageIndex] : null
  const showCoach = state.status === 'in_progress'
    && state.firstTaskPrepared
    && !state.firstTaskCompleted
    && stage !== null
  const geometry = useHighlightGeometry(showCoach ? stage?.target ?? null : null)
  const showSuccess = state.status === 'completed'
    && state.firstTaskCompleted
    && !state.shownHintIds.includes(FIRST_TASK_SUCCESS_HINT_ID)

  if (!showCoach && !showSuccess) return null

  if (showSuccess) {
    return createPortal(
      <UiPanel
        className="fixed bottom-5 left-1/2 z-toast flex w-[min(92vw,34rem)] -translate-x-1/2 items-start gap-3 p-4"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <div className={UI_TEXT_SECTION_CLASS}>{t('coach.successTitle')}</div>
          <p className={`mt-1 leading-5 ${UI_TEXT_META_CLASS}`}>{t('coach.successDescription')}</p>
        </div>
        <UiButton
          variant="plain"
          size="sm"
          className="shrink-0"
          onClick={() => onboardingManager.markHintShown(FIRST_TASK_SUCCESS_HINT_ID)}
        >
          {t('actions.dismiss')}
        </UiButton>
      </UiPanel>,
      document.body,
    )
  }

  if (!stage || !geometry) return null

  const skipCoach = (): void => {
    COACH_STAGES.forEach((item) => onboardingManager.markHintShown(item.id))
  }
  const advance = (): void => onboardingManager.markHintShown(stage.id)
  const Arrow = geometry.popoverAbove ? ArrowDown : ArrowUp

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-toast rounded-xl border-2 border-accent bg-accent/5 outline outline-4 outline-accent/15"
        style={{
          top: geometry.top,
          left: geometry.left,
          width: geometry.width,
          height: geometry.height,
        }}
      />
      <UiPanel
        className="fixed z-toast p-4"
        style={{
          top: geometry.popoverTop,
          left: geometry.popoverLeft,
          width: geometry.popoverWidth,
        }}
        role="status"
        aria-live="polite"
      >
        <Arrow
          aria-hidden="true"
          className={`absolute h-5 w-5 ${UI_COLOR_ACCENT_TEXT_CLASS} ${geometry.popoverAbove ? '-bottom-7' : '-top-7'}`}
          style={{ left: geometry.arrowLeft }}
        />
        <div className="flex items-start gap-3">
          <Sparkles className={`mt-0.5 h-5 w-5 shrink-0 ${UI_COLOR_ACCENT_TEXT_CLASS}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className={UI_TEXT_SECTION_CLASS}>{t(stage.titleKey)}</div>
              <span className={UI_TEXT_META_CLASS}>{t('coach.progress', {
                current: stageIndex + 1,
                total: COACH_STAGES.length,
              })}</span>
            </div>
            <p className={`mt-1 leading-5 ${UI_TEXT_META_CLASS}`}>{t(stage.descriptionKey)}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <UiButton variant="plain" size="sm" onClick={skipCoach}>
            {t('coach.skip')}
          </UiButton>
          <UiButton
            variant={stageIndex < COACH_STAGES.length - 1 ? 'primary' : 'plain'}
            size="sm"
            onClick={advance}
          >
            {t(stageIndex < COACH_STAGES.length - 1 ? 'coach.next' : 'coach.finish')}
          </UiButton>
        </div>
      </UiPanel>
    </>,
    document.body,
  )
}
