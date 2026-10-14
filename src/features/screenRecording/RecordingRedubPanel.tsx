import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dropdown, UiButton, UiError, UiFormRow, UiGroup, UiLoading, UiSwitch, UiTextArea } from '@/components/ui'
import { getPlatform } from '@/platform'
import { modelDefaultsManager } from '@/features/settings'
import { executeUiApplicationCapability } from '@/features/application-control'
import { openVideoEditDocument, switchVideoEditSequence } from '@/features/videoEdit'
import { openApplicationSurface } from '@/features/navigation'
import type { RecordingDocument } from '@/core/screenRecording/document'
import { recordingVoiceSchema } from '@/core/screenRecording/director'
import { RecordingVoiceControls } from './RecordingVoiceControls'

export function RecordingRedubPanel({ sessionId, recording }: { sessionId: string; recording: RecordingDocument }): React.ReactElement {
  const { t } = useTranslation('ui')
  const [documents, setDocuments] = useState<Array<{ value: string; label: string }>>([]), [documentId, setDocumentId] = useState('')
  const [sentences, setSentences] = useState<Array<{ value: string; label: string; sequenceId: string }>>([]), [clipId, setClipId] = useState(''), [text, setText] = useState('')
  const [modelId, setModelId] = useState(recording.understanding.director?.voice.modelId ?? modelDefaultsManager.resolveModelId('audio'))
  const [options, setOptions] = useState<DynamicValueMap>(recording.understanding.director?.voice.options ?? {})
  const [rerecord, setRerecord] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const controller = useRef<AbortController>()
  const savedVoice = recording.understanding.director?.voice
  useEffect(() => {
    if (savedVoice) { setModelId(savedVoice.modelId); setOptions(savedVoice.options) }
    else { setModelId(modelDefaultsManager.resolveModelId('audio')); setOptions({}) }
  }, [sessionId, savedVoice])
  useEffect(() => { void getPlatform().documents.listDocuments({ kind: 'video_edit', includeMissing: false }).then(values => setDocuments(values.map(v => ({ value: v.id, label: v.name })))).catch(error => setError(String(error))) }, [])
  useEffect(() => {
    let live = true
    setSentences([]); setClipId(''); setText('')
    if (documentId) void openVideoEditDocument({ id: documentId }, { focus: false }).then(owner => {
      if (live) setSentences(owner.document.sequences.flatMap(sequence => sequence.clips.filter(clip => clip.kind === 'audio' && clip.creativeSource?.type === 'document' && clip.creativeSource.docRef.docId === sessionId && clip.creativeSource.part?.startsWith('recording-narration:')).map(clip => ({ value: clip.id, label: clip.text || clip.name, sequenceId: sequence.id }))))
    }).catch(error => { if (live) setError(String(error)) })
    return () => { live = false }
  }, [documentId, sessionId])
  const run = async () => {
    setBusy(true); setError(''); controller.current = new AbortController()
    try {
      const result = await executeUiApplicationCapability({ id: 'redub_screen_recording_sentence', version: 1, input: { sessionRef: { kind: 'screen_recording.session', id: sessionId }, clipRef: { kind: 'video_edit.clip', id: `${documentId}:${clipId}` }, text, voice: recordingVoiceSchema.parse({ modelId, options }), rerecord } }, controller.current.signal)
      if (!result.ok) throw new Error(result.error.message)
      await openVideoEditDocument({ id: documentId })
      switchVideoEditSequence(documentId, sentences.find(v => v.value === clipId)!.sequenceId)
      openApplicationSurface('workspace.video_edit')
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false); controller.current = undefined }
  }
  return <UiGroup title={t('recording.redubTitle')} titleTone="compact" labelWidth={72} info={t('recording.redubHint')}>
    {error && <UiError message={error} />}{busy && <UiLoading message={t('recording.redubBusy')} />}
    <UiFormRow label={t('recording.scriptDestination')} density="compact"><Dropdown size="sm" value={documentId} display={documentId ? undefined : t('recording.redubChooseDocument')} emptyLabel={t('recording.redubNoDocument')} options={documents} onSelect={setDocumentId} /></UiFormRow>
    {documentId && <>
      <UiFormRow label={t('recording.redubSentence')} density="compact"><Dropdown size="sm" value={clipId} display={clipId ? undefined : t('recording.redubChooseSentence')} emptyLabel={t('recording.redubNoSentence')} options={sentences} onSelect={id => { setClipId(id); setText(sentences.find(v => v.value === id)!.label) }} /></UiFormRow>
      {clipId && <>
        <UiFormRow label={t('recording.directorNarration')} density="compact"><UiTextArea height="short" value={text} maxLength={2000} disabled={busy} onChange={e => setText(e.target.value)} /></UiFormRow>
        <RecordingVoiceControls modelId={modelId} options={options} onModelChange={setModelId} onOptionsChange={setOptions} />
        <UiFormRow label={t('recording.redubRerecordShort')} density="compact"><UiSwitch checked={rerecord} onCheckedChange={setRerecord} /></UiFormRow>
        <UiFormRow label="" density="compact"><div className="flex gap-2"><UiButton variant="secondary" size="sm" disabled={busy || !text.trim()} disabledReason={t('recording.redubChoose')} onClick={() => { void run() }}>{t('recording.redubRun')}</UiButton>{busy && <UiButton size="sm" onClick={() => controller.current?.abort()}>{t('recording.cancel')}</UiButton>}</div></UiFormRow>
      </>}
    </>}
  </UiGroup>
}
