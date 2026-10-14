import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dropdown, UiButton, UiError, UiFormRow, UiGroup, UiInput, UiLoading } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { useNotification } from '@/contexts/NotificationContext'
import { getPlatform } from '@/platform'
import type { RecordingDocument } from '@/core/screenRecording/document'
import type { RecordingScript } from '@/core/screenRecording/script'
import { executeUiApplicationCapability } from '@/features/application-control'
import { readRecordingUnderstanding } from './application/recordingUnderstandingService'
import { showRecordingDocument } from './application/recordingService'
import { UNDERSTANDING_ENTITY, UNDERSTANDING_PROPERTY } from './application/recordingUnderstandingFields'

export function RecordingScriptPanel({ sessionId, recording, disabled }: { sessionId: string; recording: RecordingDocument; disabled: boolean }): React.ReactElement {
  const { t } = useTranslation('ui')
  const { showNotification } = useNotification()
  const [script, setScript] = useState(recording.understanding.operationScript)
  const [stepId, setStepId] = useState('')
  const [documents, setDocuments] = useState<Array<{ value: string; label: string }>>([])
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { setScript(recording.understanding.operationScript) }, [recording])
  useEffect(() => { void getPlatform().documents.listDocuments({ kind: 'video_edit', includeMissing: false }).then(values => setDocuments(values.map(v => ({ value: v.id, label: v.name })))).catch(error => setError(String(error))) }, [sessionId])
  const selected = script.steps.find(v => v.id === stepId)
  const update = (change: Partial<RecordingScript['steps'][number]>): void => setScript(value => ({ steps: value.steps.map(step => step.id === stepId ? { ...step, ...change } : step) }))
  const run = (work: () => Promise<void>): void => { setError(''); setBusy(true); void work().then(() => showNotification(t('recording.scriptDone'))).catch(error => { const message = error instanceof Error ? error.message : String(error); setError(message); showNotification(message, 'error') }).finally(() => setBusy(false)) }
  const invoke = async (id: string, input: Record<string, unknown>): Promise<void> => {
    const result = await executeUiApplicationCapability({ id, version: 1, input }, new AbortController().signal)
    if (!result.ok) throw new Error(result.error.message)
  }
  const save = async (): Promise<void> => {
    const read = await readRecordingUnderstanding(sessionId)
    if (JSON.stringify(read.content.understanding.operationScript) !== JSON.stringify(recording.understanding.operationScript)) throw new Error(t('recording.scriptConflict'))
    const ref = { kind: UNDERSTANDING_ENTITY, id: sessionId }
    const result = await executeUiApplicationCapability({ id: 'change_application_entities', version: 2, expectedRevisions: { screen_recording: read.meta.revision }, input: { summary: t('recording.scriptSave'), changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { [UNDERSTANDING_PROPERTY]: { ...read.content.understanding, operationScript: script } } }] } }, new AbortController().signal)
    if (!result.ok) throw new Error(result.error.message)
    await showRecordingDocument(sessionId)
  }
  const sessionRef = { kind: 'screen_recording.session', id: sessionId }
  return <UiGroup title={t('recording.scriptTitle')} titleTone="compact" labelWidth={96} info={t('recording.scriptScope')} actions={<UiButton size="sm" disabled={disabled || busy} disabledReason={t('recording.movieBusy')} onClick={() => run(async () => {
    if (!recording.understanding.steps.length) await invoke('understand_screen_recording', { sessionRef, transcribe: false, detectVisuals: false })
    await invoke('generate_screen_recording_script', { sessionRef }); await showRecordingDocument(sessionId)
  })}>{t('recording.scriptGenerate')}</UiButton>}>
    {error && <UiError message={error} />}{busy && <UiLoading message={t('recording.scriptBusy')} />}
    {!script.steps.length && !busy && <p className="text-xs text-text3">{t('recording.scriptEmpty')}</p>}
    {script.steps.length > 0 && <>
      <UiFormRow label={t('recording.scriptStep')} density="compact"><Dropdown size="sm" value={stepId} options={[{ value: '', label: t('recording.scriptAll') }, ...script.steps.map((v, i) => ({ value: v.id, label: `${i + 1}. ${v.title}` }))]} onSelect={setStepId} /></UiFormRow>
      {selected && <>
        <UiFormRow label={t('recording.scriptStepTitle')} density="compact"><UiInput size="sm" value={selected.title} onChange={event => update({ title: event.target.value })} maxLength={120} /></UiFormRow>
        <UiFormRow label={t('recording.scriptWait')} density="compact"><NumberInput size="sm" value={selected.wait.settleMs / 1000} min={.1} max={10} step={.1} onChange={value => update({ wait: { kind: 'capability_completed', settleMs: Math.round(value * 1000) } })} /></UiFormRow>
        {selected.operations.flatMap((operation, index) => Object.entries(operation.properties).map(([key, value]) => <UiFormRow key={`${index}:${key}`} label={t(`recording.scriptProperty_${key.split('.').at(-1)}`)} density="compact">
          {typeof value === 'number' ? <NumberInput size="sm" value={value} step={.1} onChange={next => update({ operations: selected.operations.map((item, i) => i === index ? { ...item, properties: { ...item.properties, [key]: next } } : item) })} /> : <UiInput size="sm" value={String(value)} onChange={event => update({ operations: selected.operations.map((item, i) => i === index ? { ...item, properties: { ...item.properties, [key]: event.target.value } } : item) })} />}
        </UiFormRow>))}
        {selected.blockedReason && <p className="text-xs text-text2">{selected.blockedReason}</p>}
      </>}
      <UiFormRow label={t('recording.scriptDestination')} density="compact"><Dropdown size="sm" value={target} options={[{ value: '', label: t('recording.scriptChooseDestination') }, ...documents]} onSelect={setTarget} /></UiFormRow>
      <UiFormRow label="" density="compact"><div className="flex flex-wrap gap-2">
        <UiButton size="sm" disabled={disabled || busy} disabledReason={t('recording.movieBusy')} onClick={() => run(save)}>{t('recording.scriptSave')}</UiButton>
        <UiButton size="sm" disabled={disabled || busy} disabledReason={t('recording.movieBusy')} onClick={() => run(async () => { await save(); await invoke('replay_screen_recording_script', { sessionRef, ...(stepId ? { stepId } : {}) }) })}>{t('recording.scriptReplay')}</UiButton>
        <UiButton size="sm" disabled={disabled || busy || !target} disabledReason={t('recording.scriptChooseDestination')} onClick={() => run(async () => {
          await save()
          const sourceId = await getPlatform().screenRecording.capture({ operation: 'application-source', sessionId })
          await invoke('rerecord_screen_recording_steps', { sessionRef, documentRef: { kind: 'video_edit.document', id: target }, sourceRef: { kind: 'screen_recording.source', id: sourceId }, ...(stepId ? { stepId } : {}) })
        })}>{t('recording.scriptRerecord')}</UiButton>
      </div></UiFormRow>
    </>}
  </UiGroup>
}
