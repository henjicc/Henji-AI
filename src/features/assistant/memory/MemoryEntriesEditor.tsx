import { cachedMemory, memoryErrorMessage } from './memoryState'
import { useCallback, useEffect, useState } from 'react'
import { UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiInput, UiRecordItem, UiRecordList, UiSegmented, UiSelect, UI_TEXT_META_CLASS } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { memoryEntryInputSchema, type MemoryEntry, type MemoryTarget } from '@/core/assistant/memoryEntries'
import { readMemory, writeMemory, subscribeMemory } from './memoryService'

/** 设置与风格说明书复用同一条目编辑器；所有动作走记忆领域服务。 */
export function MemoryEntriesEditor({ target, readOnly = false }: { target: MemoryTarget; readOnly?: boolean }): JSX.Element {
  const { t } = useI18n('settings')
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [section, setSection] = useState<'about' | 'creative' | 'habits'>('creative')
  const [busy, setBusy] = useState(false)
  const disabled = readOnly || cachedMemory()?.settings.enabled === false
  const key = JSON.stringify(target)
  const refresh = useCallback(async () => { try { setEntries(await readMemory(JSON.parse(key) as MemoryTarget)) } catch (cause) { setError(memoryErrorMessage(cause)) } }, [key])
  useEffect(() => { void refresh() }, [refresh])
  // 通知只刷新当前列表，读取本身不会发布通知，避免循环。
  useEffect(() => subscribeMemory(() => { if (!busy) void readMemory(JSON.parse(key) as MemoryTarget).then(setEntries, cause => setError(memoryErrorMessage(cause))) }), [key, busy])
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError('')
    try { await action(); setEditing(null); setDraft(''); await refresh() } catch (cause) { setError(memoryErrorMessage(cause)) } finally { setBusy(false) }
  }
  const save = (entry?: MemoryEntry): Promise<unknown> => writeMemory({ target, id: entry?.id ?? crypto.randomUUID(), expectedRevision: entry?.revision ?? 0,
    entry: { ...(entry ? memoryEntryInputSchema.strip().parse(entry) : {}), ...(target.layer === 'global' ? { section: entry?.section ?? section } : {}), content: draft, source: 'user', reason: t('memory.manualReason') }, actor: 'user', reason: t('memory.manualReason') })
  const groups = target.layer === 'global' ? ['about', 'creative', 'habits'] as const : ['local'] as const
  return <div className="flex flex-col gap-4">
    {error ? <UiError message={error} size="sm" /> : null}
    {!entries.length ? <UiEmpty title={t(cachedMemory()?.settings.enabled === false ? 'memory.disabledHint' : 'memory.empty')} size="sm" /> : null}
    {groups.map(group => {
      const values = entries.filter(entry => group === 'local' || entry.section === group)
      if (!values.length) return null
      return <UiGroup key={group} title={group === 'local' ? undefined : t(`memory.${group}`)} titleTone="overline">
        <UiRecordList>{values.map((entry, index) => <UiRecordItem key={entry.id} index={index} density="panel" meta={[entry.source === 'user' ? t('memory.sourceUser') : t('memory.sourceAssistant')]}
          actions={disabled ? undefined : <><UiButton size="sm" disabled={busy} onClick={() => { setEditing(entry.id); setDraft(entry.content) }}>{t('memory.edit')}</UiButton><UiButton size="sm" variant="danger" disabled={busy} onClick={() => void act(() => writeMemory({ target, id: entry.id, expectedRevision: entry.revision, entry: null, actor: 'user', reason: t('memory.deleteReason') }))}>{t('memory.delete')}</UiButton></>}>
          {editing === entry.id ? <UiFormRow label={t('memory.content')}><UiInput value={draft} maxLength={200} onChange={event => setDraft(event.target.value)} /><UiButton size="sm" disabled={busy || !draft.trim()} onClick={() => void act(() => save(entry))}>{t('memory.save')}</UiButton><UiButton size="sm" onClick={() => { setEditing(null); setDraft('') }}>{t('memory.cancel')}</UiButton></UiFormRow> : <p>{entry.content}</p>}
          {target.layer === 'global' && entry.section === 'creative' && !disabled ? <UiFormRow label={t('memory.conflict')} inline><UiSegmented ariaLabel={t('memory.conflict')} value={entry.precedence ?? 'ask'} options={[{ value: 'ask', label: t('memory.askFirst') }, { value: 'style', label: t('memory.styleFirst') }, { value: 'preference', label: t('memory.preferenceFirst') }]} onChange={value => void act(() => writeMemory({ target, id: entry.id, expectedRevision: entry.revision, entry: { ...memoryEntryInputSchema.strip().parse(entry), precedence: value === 'ask' ? undefined : value as 'style' | 'preference', source: 'user', reason: t('memory.precedenceReason') }, actor: 'user', reason: t('memory.precedenceReason') }))} /></UiFormRow> : null}
          {entry.reason ? <span className={UI_TEXT_META_CLASS}>{entry.reason}</span> : null}
        </UiRecordItem>)}</UiRecordList>
      </UiGroup>
    })}
    {!disabled ? <UiGroup title={t('memory.add')} titleTone="overline">
      {target.layer === 'global' ? <UiFormRow label={t('memory.section')} inline><UiSelect value={section} onChange={event => setSection(event.target.value as typeof section)}><option value="about">{t('memory.about')}</option><option value="creative">{t('memory.creative')}</option><option value="habits">{t('memory.habits')}</option></UiSelect></UiFormRow> : null}
      <UiFormRow label={t('memory.content')}><UiInput value={editing ? '' : draft} disabled={Boolean(editing)} maxLength={200} onChange={event => setDraft(event.target.value)} /></UiFormRow>
      <UiButton variant="secondary" disabled={busy || Boolean(editing) || !draft.trim()} onClick={() => void act(() => save())}>{t('memory.add')}</UiButton>
    </UiGroup> : null}
  </div>
}
