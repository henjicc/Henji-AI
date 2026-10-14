import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dropdown, UiButton, UiError, UiFormRow, UiGroup, UiInput, UiLoading, UiTextArea } from '@/components/ui'
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

export function RecordingDirectorPanel({ sessionId, recording }: { sessionId?: string; recording?: RecordingDocument }): React.ReactElement {
  const { t } = useTranslation('ui')
  const saved = recording?.understanding.director
  const [goal, setGoal] = useState(''), [selected, setSelected] = useState(0)
  const [narration, setNarration] = useState(saved?.narration ?? [])
  const [modelId, setModelId] = useState(saved?.voice.modelId ?? modelDefaultsManager.resolveModelId('audio'))
  const [options, setOptions] = useState<DynamicValueMap>(saved?.voice.options ?? {})
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { if (saved) { setNarration(saved.narration); setModelId(saved.voice.modelId); setOptions(saved.voice.options) } }, [saved])
  const invoke = async (id: string, input: Record<string, unknown>) => {
    const result = await executeUiApplicationCapability({ id, version: 1, input }, new AbortController().signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }
  const run = (work: () => Promise<unknown>) => { setBusy(true); setError(''); void work().catch(error => setError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false)) }
  const save = async (confirmed: boolean) => {
    if (!sessionId || !saved) return
    const read = await readRecordingUnderstanding(sessionId)
    if (JSON.stringify(saved) !== JSON.stringify(read.content.understanding.director)) throw new Error(t('recording.scriptConflict'))
    const ref = { kind: 'screen_recording.understanding', id: sessionId }
    const value = { ...read.content.understanding, director: { ...saved, narration, voice: recordingVoiceSchema.parse({ modelId, options }), confirmed } }
    const result = await executeUiApplicationCapability({ id: 'change_application_entities', version: 2, expectedRevisions: { screen_recording: read.meta.revision }, input: { summary: t('recording.directorSave'), changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'screen_recording.understanding.result': value } }] } }, new AbortController().signal)
    if (!result.ok) throw new Error(result.error.message)
    await showRecordingDocument(sessionId)
  }
  const changed = saved && (JSON.stringify(narration) !== JSON.stringify(saved.narration) || modelId !== saved.voice.modelId || JSON.stringify(options) !== JSON.stringify(saved.voice.options))
  const start = async () => {
    const destination = await createVideoEditProject()
    const output = await invoke('start_screen_recording_director', { sessionRef: { kind: 'screen_recording.session', id: sessionId }, documentRef: { kind: 'video_edit.document', id: destination.document.id } })
    const refs = output.sequenceRefs as Array<{ id: string }>
    await openVideoEditDocument({ id: destination.document.id })
    switchVideoEditSequence(destination.document.id, refs[0].id.slice(destination.document.id.length + 1), { fromStart: true })
    openApplicationSurface('workspace.video_edit')
  }
  return <UiGroup title={t('recording.directorTitle')} labelWidth={120}>
    {error && <UiError message={error} />}{busy && <UiLoading message={t('recording.directorBusy')} />}
    {!saved ? <>
      <UiFormRow label={t('recording.directorGoal')}><UiInput value={goal} onChange={e => setGoal(e.target.value)} placeholder={t('recording.directorGoalPlaceholder')} /></UiFormRow>
      <UiFormRow label=""><UiButton disabled={!goal.trim()} disabledReason={t('recording.directorGoalPlaceholder')} onClick={() => openAssistant(t('recording.directorPrompt', { goal }))}>{t('recording.directorPlan')}</UiButton></UiFormRow>
    </> : <>
      <p className="text-13 text-text2">{saved.goal}</p>
      <UiFormRow label={t('recording.directorStep')}><Dropdown value={String(selected)} options={narration.map((v, i) => ({ value: String(i), label: `${i + 1}. ${recording!.understanding.operationScript.steps[i]?.title ?? ''}` }))} onSelect={value => setSelected(Number(value))} /></UiFormRow>
      {narration[selected] && <><UiFormRow label={t('recording.directorPicture')}><span className="text-13 text-text2">{narration[selected].picture}</span></UiFormRow>
        <UiFormRow label={t('recording.directorNarration')}><UiTextArea height="short" value={narration[selected].text} disabled={busy} onChange={event => setNarration(values => values.map((value, index) => index === selected ? { ...value, text: event.target.value } : value))} /></UiFormRow></>}
      <RecordingVoiceControls modelId={modelId} options={options} onModelChange={setModelId} onOptionsChange={setOptions} />
      <UiFormRow label=""><div className="flex flex-wrap gap-2">
        <UiButton disabled={busy || !changed} disabledReason={t('recording.directorNoChanges')} onClick={() => run(() => save(false))}>{t('recording.directorSave')}</UiButton>
        <UiButton disabled={busy || Boolean(changed) || saved.confirmed} disabledReason={changed ? t('recording.directorSaveFirst') : t('recording.directorConfirmed')} onClick={() => run(() => save(true))}>{t('recording.directorConfirm')}</UiButton>
        <UiButton disabled={busy || Boolean(changed) || !saved.confirmed || Boolean(recording?.directorRun?.movie)} disabledReason={t('recording.directorConfirmFirst')} onClick={() => run(start)}>{t('recording.directorStart')}</UiButton>
        {busy && <UiButton onClick={() => { void invoke('cancel_screen_recording_director', { sessionRef: { kind: 'screen_recording.session', id: sessionId } }).catch(error => setError(String(error))) }}>{t('recording.cancel')}</UiButton>}
      </div></UiFormRow>
    </>}
  </UiGroup>
}
