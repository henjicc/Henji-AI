import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dropdown, UiButton, UiError, UiFormRow, UiGroup, UiLoading } from '@/components/ui'
import { getPlatform } from '@/platform'
import { getDocumentOperations } from '@/features/documents'
import type { RecordingDocument } from '@/core/screenRecording/document'
import type { RecordingProductKind } from '@/core/screenRecording/products'
import { exportRecordingProduct, type RecordingProductExport } from './application/recordingProductService'

export function RecordingProductOptions({ sessionId, recording, disabled, onBusyChange }: { sessionId: string; recording: RecordingDocument; disabled: boolean; onBusyChange: (busy: boolean) => void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const [product, setProduct] = useState<RecordingProductKind>('steps'), [step, setStep] = useState('')
  const [busy, setBusy] = useState(false), [completed, setCompleted] = useState(0), [error, setError] = useState(''), [result, setResult] = useState<RecordingProductExport | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => { controller.current?.abort() }, [])
  const openImage = async (id: string): Promise<void> => {
    const operations = getDocumentOperations()
    const document = (await operations.listDocuments({ kind: 'image_document', includeDrafts: true, includeMissing: false })).find(document => document.id === id)
    if (!document) throw new Error(t('recording.productDocumentMissing'))
    await operations.openDocument(document)
  }
  const run = async (): Promise<void> => {
    if (controller.current || disabled) return
    const abort = new AbortController(); controller.current = abort; setBusy(true); onBusyChange(true); setError(''); setResult(null); setCompleted(0)
    try {
      const selected = product === 'image_document' ? undefined : await getPlatform().system.dialog.open({ directory: true })
      if (selected === null) return
      const result = await exportRecordingProduct(sessionId, { product, ...(step ? { stepIds: [step] } : {}), ...(typeof selected === 'string' ? { directory: selected } : {}) }, abort.signal, setCompleted)
      setResult(result)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { controller.current = null; setBusy(false); onBusyChange(false) }
  }
  return <UiGroup title={t('recording.productsTitle')}>
    <UiFormRow label={t('recording.productType')}><Dropdown size="sm" value={product} options={(['steps', 'gif', 'bug_report', 'image_document'] as const).map(value => ({ value, label: t(`recording.product_${value}`) }))} onSelect={value => setProduct(value as RecordingProductKind)} disabled={disabled || busy} /></UiFormRow>
    <UiFormRow label={t('recording.productSteps')}><Dropdown size="sm" value={step} options={[{ value: '', label: t('recording.allSteps') }, ...recording.understanding.steps.map(step => ({ value: step.id, label: step.title }))]} onSelect={setStep} disabled={disabled || busy} /></UiFormRow>
    <p className="text-xs text-text2">{t(product === 'gif' ? 'recording.gifLimit' : product === 'image_document' ? 'recording.imageDocumentHint' : 'recording.productHint')}</p>
    {error && <UiError message={error} />}
    {busy ? <><UiLoading message={t('recording.productProgress', { count: completed })} /><UiButton onClick={() => controller.current?.abort()}>{t('recording.cancelProduct')}</UiButton></> : <UiButton disabled={disabled || !recording.understanding.steps.length} disabledReason={t('recording.productNeedsSteps')} onClick={() => { void run() }}>{t('recording.exportProduct')}</UiButton>}
    {result && <>
      <p className="text-13 text-text2">{t(result.state === 'completed' ? 'recording.productCompleted' : 'recording.productCancelled', { count: result.completedSteps })}</p>
      {result.warnings.map((warning, index) => <p key={index} className="text-xs text-text2">{warning}</p>)}
      {result.documentRefs.map((ref, index) => <UiButton key={ref.id} onClick={() => { void openImage(ref.id).catch(error => setError(String(error))) }}>{t('recording.editProductStep', { count: index + 1 })}</UiButton>)}
    </>}
  </UiGroup>
}
