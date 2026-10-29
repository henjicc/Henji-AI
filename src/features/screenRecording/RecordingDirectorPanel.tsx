import { editableRecordingUnderstanding } from './application/recordingUnderstandingFields'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Sparkles } from 'lucide-react'
import { UiButton, UiError, UiGroup, UiLoading, UiTextArea } from '@/components/ui'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { RecordingVoiceControls } from './RecordingVoiceControls'
import { modelDefaultsManager } from '@/features/settings'
import { openAssistant } from '@/features/assistant'
import { executeUiApplicationCapability } from '@/features/application-control'
import type { RecordingDocument } from '@/core/screenRecording/document'
import { recordingVoiceSchema } from '@/core/screenRecording/director'
import { readRecordingUnderstanding } from './application/recordingUnderstandingService'
import { showRecordingDocument } from './application/recordingService'
import { createVideoEditProject, openVideoEditDocument, switchVideoEditSequence } from '@/features/videoEdit'
import { openApplicationSurface } from '@/features/navigation'

const STAGES = ['goal', 'review', 'record', 'movie'] as const
type Stage = typeof STAGES[number]

/** Where the tutorial is in its life: described → script reviewed → recorded by the director → movie. */
function DirectorStages({ stage }: { stage: Stage }): React.ReactElement {
  const { t } = useTranslation('ui')
  const at = STAGES.indexOf(stage)
  return <ol className="flex items-center gap-3" aria-label={t('recording.directorStages')}>
    {/* ui-surface-allow: S4 这是四步进度条，不是记录列表，项之间用连接线而非分隔线（屏幕录制界面重做） */}
    {STAGES.map((value, index) => <li key={value} className={`flex items-center gap-2 text-13 ${index === at ? 'text-text1' : index < at ? 'text-text2' : 'text-text3'}`} aria-current={index === at ? 'step' : undefined}>
      {index > 0 && <span className="h-px w-6 bg-line" aria-hidden />}
      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-2xs font-semibold ${index === at ? 'bg-accent text-on-accent' : index < at ? 'bg-accent-tint text-accent-text' : 'bg-raised'}`}>{index < at ? <Check className={UI_ICON_SIZE_CLASS.xs} aria-hidden /> : index + 1}</span>
      {t(`recording.directorStage_${value}`)}
    </li>)}
  </ol>
}

/** Step 1: say what the tutorial should show; the assistant plans the script against the live app. */
export function RecordingDirectorGoal(): React.ReactElement {
  const { t } = useTranslation('ui')
  const [goal, setGoal] = useState('')
  return <div className="flex min-h-0 flex-1 justify-center overflow-auto px-6 py-8" data-recording-director="goal">
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <DirectorStages stage="goal" />
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-text1">{t('recording.directorTitle')}</h2>
        <p className="text-13 text-text2">{t('recording.directorIntro')}</p>
      </div>
      <UiTextArea aria-label={t('recording.directorGoal')} height="medium" value={goal} onChange={event => setGoal(event.target.value)} placeholder={t('recording.directorGoalPlaceholder')} maxLength={2000} />
      <div><UiButton variant="primary" disabled={!goal.trim()} disabledReason={t('recording.directorGoalFirst')} onClick={() => openAssistant(t('recording.directorPrompt', { goal: goal.trim() }))}><Sparkles />{t('recording.directorPlan')}</UiButton></div>
    </div>
  </div>
}

/** Step 2: the whole script on one screen; narration edits save on their own, one button records the tutorial. */
export function RecordingDirectorScript({ sessionId, recording }: { sessionId: string; recording: RecordingDocument }): React.ReactElement {
  const { t } = useTranslation('ui')
  const saved = recording.understanding.director!
  const steps = recording.understanding.operationScript.steps
  const [narration, setNarration] = useState(saved.narration)
  const [modelId, setModelId] = useState(saved.voice.modelId ?? modelDefaultsManager.resolveModelId('audio'))
  const [options, setOptions] = useState<DynamicValueMap>(saved.voice.options ?? {})
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const running = useRef<AbortController | null>(null)
  useEffect(() => { setNarration(saved.narration); setModelId(saved.voice.modelId); setOptions(saved.voice.options) }, [saved])
  const changed = JSON.stringify(narration) !== JSON.stringify(saved.narration) || modelId !== saved.voice.modelId || JSON.stringify(options) !== JSON.stringify(saved.voice.options)
  const invoke = async (id: string, input: Record<string, unknown>, signal = new AbortController().signal) => {
    const result = await executeUiApplicationCapability({ id, version: 1, input }, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }
  const save = async (): Promise<void> => {
    const read = await readRecordingUnderstanding(sessionId)
    const current = read.content.understanding.director
    if (!current) throw new Error(t('recording.scriptConflict'))
    const ref = { kind: 'screen_recording.understanding', id: sessionId }
    const value = { ...editableRecordingUnderstanding(read.content.understanding), director: { goal: current.goal, narration, voice: recordingVoiceSchema.parse({ modelId, options }) } }
    const result = await executeUiApplicationCapability({ id: 'change_application_entities', version: 2, expectedRevisions: { screen_recording: read.meta.revision }, input: { summary: t('recording.directorSave'), changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'screen_recording.understanding.result': value } }] } }, new AbortController().signal)
    if (!result.ok) throw new Error(result.error.message)
    await showRecordingDocument(sessionId)
  }
  const persist = (): void => { if (changed && !busy) void save().catch(failure => setError(failure instanceof Error ? failure.message : String(failure))) }
  const start = async (): Promise<void> => {
    setBusy(true); setError(''); running.current = new AbortController()
    try {
      if (changed) await save()
      const destination = await createVideoEditProject()
      const output = await invoke('start_screen_recording_director', { sessionRef: { kind: 'screen_recording.session', id: sessionId }, documentRef: { kind: 'video_edit.document', id: destination.document.id } }, running.current.signal)
      const refs = output.sequenceRefs as Array<{ id: string }>
      await openVideoEditDocument({ id: destination.document.id })
      switchVideoEditSequence(destination.document.id, refs[0].id.slice(destination.document.id.length + 1), { fromStart: true })
      openApplicationSurface('workspace.video_edit')
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false); running.current = null }
  }
  const finished = Boolean(recording.directorRun?.movie)
  return <div className="flex min-h-0 flex-1" data-recording-director="review">
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-auto px-8 py-6">
      <DirectorStages stage={busy ? 'record' : finished ? 'movie' : 'review'} />
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text1">{saved.goal}</h2>
        <p className="text-xs text-text2">{t('recording.directorReviewHint', { count: steps.length })}</p>
      </div>
      {error && <UiError message={error} />}
      <ol className="flex flex-col" aria-label={t('recording.directorScript')}>
        {narration.map((line, index) => <li key={line.stepId} className={`grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-2 py-4 ${index > 0 ? 'border-t border-line/60' : ''}`}>
          <span className="pt-0.5 font-mono text-sm text-text3">{index + 1}</span>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-13 font-medium text-text1">{steps[index]?.title ?? ''}</span>
              <span className="text-xs text-text3">{t('recording.directorPicture')}：{line.picture}</span>
            </div>
            <UiTextArea aria-label={t('recording.directorNarrationOf', { index: index + 1 })} height="short" value={line.text} disabled={busy || finished} maxLength={2000}
              onChange={event => setNarration(values => values.map((value, i) => i === index ? { ...value, text: event.target.value } : value))} onBlur={persist} />
          </div>
        </li>)}
      </ol>
    </div>
    <aside className="flex w-80 shrink-0 flex-col gap-6 overflow-auto border-l border-gap bg-panel p-4" aria-label={t('recording.directorVoice')}>
      <UiGroup title={t('recording.directorVoice')} titleTone="compact" labelWidth={72}>
        <RecordingVoiceControls modelId={modelId} options={options} onModelChange={setModelId} onOptionsChange={setOptions} />
      </UiGroup>
      <div className="mt-auto flex flex-col gap-3">
        {busy && <UiLoading message={t('recording.directorBusy')} />}
        <p className="text-xs text-text3">{t(finished ? 'recording.directorFinished' : 'recording.directorHandsOff')}</p>
        {busy
          ? <UiButton onClick={() => { void invoke('cancel_screen_recording_director', { sessionRef: { kind: 'screen_recording.session', id: sessionId } }).catch(failure => setError(String(failure))) }}>{t('recording.cancel')}</UiButton>
          : <UiButton variant="primary" disabled={finished} disabledReason={t('recording.directorConfirmFirst')} onClick={() => { void start() }}>{t('recording.directorStartAll')}</UiButton>}
      </div>
    </aside>
  </div>
}
