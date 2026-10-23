import { memoryErrorMessage } from './memoryState'
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Undo2 } from 'lucide-react'
import { UiButton, UiDisclosurePanel, UiError, UiFormRow, UiGroup, UiIconButton, UiLoading, UiRecordItem, UiRecordList, UiSegmented, UiSwitch, UI_TEXT_META_CLASS } from '@/components/ui'
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
  const [tab, setTab] = useState<'global' | 'project'>('global')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [projectId] = useState(() => currentDocumentContext().projectId)
  const reload = (): void => { void refreshMemory().then(setState, cause => setError(memoryErrorMessage(cause))) }
  useEffect(() => { reload(); return subscribeMemory(reload) }, [])
  const act = async (action: () => Promise<unknown>): Promise<void> => { setError(''); try { await action(); reload() } catch (cause) { setError(memoryErrorMessage(cause)) } }
  if (!state) return error ? <UiError message={error} /> : <UiLoading />
  const history = [...state.history].reverse()
  return <div className="flex flex-col gap-6">
    <UiGroup>
      {error ? <UiError message={error} size="sm" /> : null}
      <UiFormRow label={t('memory.enabled')} inline><UiSwitch checked={state.settings.enabled} onCheckedChange={enabled => void act(() => getPlatform().assistant.updateMemorySettings({ ...state.settings, enabled }))} /></UiFormRow>
      {state.settings.enabled ? <UiFormRow label={t('memory.autoOrganize')} info={t('memory.autoOrganizeInfo')} inline><UiSwitch checked={state.settings.autoOrganize} onCheckedChange={autoOrganize => void act(() => getPlatform().assistant.updateMemorySettings({ ...state.settings, autoOrganize }))} /></UiFormRow> : null}
    </UiGroup>
    {state.settings.enabled ? <>
      {projectId ? <UiSegmented ariaLabel={t('memory.layer')} size="sm" value={tab} options={[{ value: 'global', label: t('memory.global') }, { value: 'project', label: t('memory.project') }]} onChange={setTab} /> : null}
      <MemoryEntriesEditor key={tab} target={tab === 'project' && projectId ? { layer: 'project', ownerId: projectId } : { layer: 'global' }} />
      {history.length ? <div>
        <UiButton size="sm" className="-ml-2" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}>
          {t('memory.history')}{historyOpen ? <ChevronUp /> : <ChevronDown />}
        </UiButton>
        <UiDisclosurePanel open={historyOpen}>
          <UiRecordList className="pt-2">
            {history.map((change, index) => <UiRecordItem key={change.id} index={index} density="compact"><div className="group flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm text-text1">
                  {change.after ? change.after.content : <span className="text-text3 line-through">{change.before?.content}</span>}
                </p>
                <p className={UI_TEXT_META_CLASS}>
                  {[t(change.before ? change.after ? 'memory.changed' : 'memory.removed' : 'memory.added'), t(`memory.${change.target.layer}`), change.actor === 'user' ? t('memory.sourceUser') : t('memory.sourceAssistant'), change.before && change.after ? `${t('memory.before')}：${change.before.content}` : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              <UiIconButton size="sm" className="opacity-0 transition-opacity duration-120 group-hover:opacity-100 focus-visible:opacity-100" label={t('memory.undo')} tooltip={t('memory.undo')} onClick={() => void act(() => revertMemory(change.id))}><Undo2 /></UiIconButton>
            </div></UiRecordItem>)}
          </UiRecordList>
        </UiDisclosurePanel>
      </div> : null}
    </> : null}
  </div>
}
