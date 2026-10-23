import { memoryErrorMessage } from './memoryState'
import { useEffect, useState } from 'react'
import { UiButton, UiDisclosurePanel, UiError, UiFormRow, UiGroup, UiLoading, UiRecordItem, UiRecordList, UiSegmented, UiSwitch } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { getPlatform } from '@/platform/runtime'
import type { MemorySnapshot } from '@/core/assistant/memoryEntries'
import { currentDocumentContext } from '@/features/documents/currentDocumentContext'
import { MemoryEntriesEditor } from './MemoryEntriesEditor'
import { refreshMemory, revertMemory, subscribeMemory } from './memoryService'

export function AssistantMemorySection(): JSX.Element {
  const { t } = useI18n('settings')
  const [state, setState] = useState<MemorySnapshot>()
  const [error, setError] = useState('')
  const [tab, setTab] = useState('global')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [projectId] = useState(() => currentDocumentContext().projectId)
  const reload = (): void => { void refreshMemory().then(setState, cause => setError(memoryErrorMessage(cause))) }
  useEffect(() => { reload(); return subscribeMemory(reload) }, [])
  const act = async (action: () => Promise<unknown>): Promise<void> => { setError(''); try { await action(); reload() } catch (cause) { setError(memoryErrorMessage(cause)) } }
  if (!state) return error ? <UiError message={error} /> : <UiLoading />
  return <UiGroup>
    {error ? <UiError message={error} size="sm" /> : null}
    <UiFormRow label={t('memory.enabled')} inline><UiSwitch checked={state.settings.enabled} onCheckedChange={enabled => void act(() => getPlatform().assistant.updateMemorySettings({ ...state.settings, enabled }))} /></UiFormRow>
    {state.settings.enabled ? <>
      <UiFormRow label={t('memory.autoOrganize')} inline><UiSwitch checked={state.settings.autoOrganize} onCheckedChange={autoOrganize => void act(() => getPlatform().assistant.updateMemorySettings({ ...state.settings, autoOrganize }))} /></UiFormRow>
      {projectId ? <UiFormRow label={t('memory.layer')} inline><UiSegmented ariaLabel={t('memory.layer')} value={tab} options={[{ value: 'global', label: t('memory.global') }, { value: 'project', label: t('memory.project') }]} onChange={setTab} /></UiFormRow> : null}
      <MemoryEntriesEditor target={tab === 'project' && projectId ? { layer: 'project', ownerId: projectId } : { layer: 'global' }} />
      <UiButton onClick={() => setHistoryOpen(value => !value)}>{t('memory.history')}</UiButton>
      <UiDisclosurePanel open={historyOpen}><UiRecordList>{[...state.history].reverse().map((change, index) => <UiRecordItem key={change.id} index={index} density="panel" title={change.after?.content ?? change.before?.content} meta={[t(`memory.${change.target.layer}`), change.actor === 'user' ? t('memory.sourceUser') : t('memory.sourceAssistant'), change.reason]} actions={<UiButton size="sm" onClick={() => void act(() => revertMemory(change.id))}>{t('memory.undo')}</UiButton>}><p>{t('memory.before')}：{change.before?.content ?? t('memory.none')}</p><p>{t('memory.after')}：{change.after?.content ?? t('memory.none')}</p></UiRecordItem>)}</UiRecordList></UiDisclosurePanel>
    </> : null}
  </UiGroup>
}
