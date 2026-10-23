import { cachedMemory, memoryErrorMessage } from '@/services/assistantMemory/memoryState'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Dropdown, UiError, UiGroup, UiIconButton, UiInput, UI_TEXT_META_CLASS } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { memoryEntryInputSchema, type MemoryEntry, type MemoryTarget } from '@/core/assistant/memoryEntries'
import { readMemory, writeMemory, subscribeMemory } from '@/services/assistantMemory/memoryService'

type Section = 'about' | 'creative' | 'habits'
type Group = Section | 'local'
type Precedence = 'ask' | 'style' | 'preference'
/** 正在编辑的输入行：改某一条，或在某个分组末尾新增。 */
type Draft = { kind: 'edit'; entry: MemoryEntry; text: string } | { kind: 'add'; group: Group; text: string }

/** 设置与风格说明书复用同一条目编辑器；所有动作走记忆领域服务。 */
/** `title` 只给项目/风格这类单组记忆用，让新增按钮与标题同行；全局记忆按分区自带标题。 */
export function MemoryEntriesEditor({ target, title, readOnly = false }: { target: MemoryTarget; title?: string; readOnly?: boolean }): JSX.Element {
  const { t } = useI18n('settings')
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  // 回车提交后输入框随即禁用会再触发一次失焦；同一次编辑只提交一次。
  const committing = useRef(false)
  const disabled = readOnly || cachedMemory()?.settings.enabled === false
  const key = JSON.stringify(target)
  const refresh = useCallback(async () => { try { setEntries(await readMemory(JSON.parse(key) as MemoryTarget)) } catch (cause) { setError(memoryErrorMessage(cause)) } }, [key])
  useEffect(() => { void refresh() }, [refresh])
  // 通知只刷新当前列表，读取本身不会发布通知，避免循环。
  useEffect(() => subscribeMemory(() => { if (!busy) void readMemory(JSON.parse(key) as MemoryTarget).then(setEntries, cause => setError(memoryErrorMessage(cause))) }), [key, busy])
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError('')
    try { await action(); setDraft(null); await refresh() } catch (cause) { setError(memoryErrorMessage(cause)) } finally { setBusy(false) }
  }
  const write = (entry: MemoryEntry | undefined, change: Partial<MemoryEntry> | null, reason: string): Promise<unknown> => writeMemory({
    target, id: entry?.id ?? crypto.randomUUID(), expectedRevision: entry?.revision ?? 0, actor: 'user', reason,
    entry: change === null ? null : { content: '', ...(entry ? memoryEntryInputSchema.strip().parse(entry) : {}), ...change, source: 'user', reason },
  })
  const commit = (): void => {
    if (committing.current) return
    const text = draft?.text.trim()
    if (!draft || !text) { setDraft(null); return }
    if (draft.kind === 'edit') { if (text !== draft.entry.content) { committing.current = true; void act(() => write(draft.entry, { content: text }, t('memory.manualReason'))).finally(() => { committing.current = false }) } else setDraft(null); return }
    committing.current = true
    void act(() => write(undefined, { content: text, ...(draft.group === 'local' ? {} : { section: draft.group }) }, t('memory.manualReason'))).finally(() => { committing.current = false })
  }
  const input = (value: string): JSX.Element => <UiInput size="sm" autoFocus value={value} maxLength={200} disabled={busy} placeholder={t('memory.placeholder')}
    onChange={event => setDraft(current => current && { ...current, text: event.target.value })}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit() } else if (event.key === 'Escape') { event.preventDefault(); setDraft(null) } }}
    onBlur={commit} />
  const precedenceOptions = (['ask', 'style', 'preference'] as const).map(value => ({ value, label: t(`memory.precedence_${value}`) }))
  const row = (entry: MemoryEntry): JSX.Element => {
    if (draft?.kind === 'edit' && draft.entry.id === entry.id) return <div key={entry.id} className="py-1.5">{input(draft.text)}</div>
    const creative = target.layer === 'global' && entry.section === 'creative'
    return <div key={entry.id} role="listitem" className="group flex min-h-8 items-start gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm text-text1">{entry.content}</p>
        <div className={`mt-0.5 flex flex-wrap items-center gap-x-2 ${UI_TEXT_META_CLASS}`}>
          <span>{entry.source === 'user' ? t('memory.sourceUser') : t('memory.sourceAssistant')}</span>
          {creative ? disabled ? <span>{t(`memory.precedence_${entry.precedence ?? 'ask'}`)}</span>
            : <Dropdown<Precedence> appearance="text" size="sm" ariaLabel={t('memory.conflict')} value={entry.precedence ?? 'ask'} options={precedenceOptions} disabled={busy}
              buttonClassName="w-auto" minWidthStrategy="none" panelWidthStrategy="options"
              onSelect={value => void act(() => write(entry, { precedence: value === 'ask' ? undefined : value }, t('memory.precedenceReason')))} /> : null}
        </div>
      </div>
      {disabled ? null : <div className="flex shrink-0 opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-within:opacity-100">
        <UiIconButton size="sm" label={t('memory.edit')} tooltip={t('memory.edit')} disabled={busy} onClick={() => setDraft({ kind: 'edit', entry, text: entry.content })}><Pencil /></UiIconButton>
        <UiIconButton size="sm" tone="danger" label={t('memory.delete')} tooltip={t('memory.delete')} disabled={busy} onClick={() => void act(() => write(entry, null, t('memory.deleteReason')))}><Trash2 /></UiIconButton>
      </div>}
    </div>
  }
  const groups: Group[] = target.layer === 'global' ? ['about', 'creative', 'habits'] : ['local']
  const adding = (group: Group): boolean => draft?.kind === 'add' && draft.group === group
  const addButton = (group: Group): JSX.Element | undefined => disabled ? undefined
    : <UiIconButton size="sm" label={t('memory.add')} tooltip={t('memory.add')} disabled={busy || Boolean(draft)} disabledReason={t('memory.finishEditing')} onClick={() => setDraft({ kind: 'add', group, text: '' })}><Plus /></UiIconButton>
  return <div className="flex flex-col gap-4">
    {error ? <UiError message={error} size="sm" /> : null}
    {!entries.length && !draft && (disabled || target.layer === 'global') ? <p className={UI_TEXT_META_CLASS}>{t(cachedMemory()?.settings.enabled === false ? 'memory.disabledHint' : 'memory.empty')}</p> : null}
    <div>{groups.map(group => {
      const values = entries.filter(entry => group === 'local' || entry.section === group)
      // 全局分区始终可见，空分区只留标题与新增；局部记忆（项目/风格）只有一组，不再套标题。
      return <UiGroup key={group} title={group === 'local' ? title : t(`memory.${group}`)} titleTone="compact" actions={addButton(group)}>
        <div role="list" className="flex flex-col">
          {values.map(row)}
          {adding(group) ? <div className="py-1.5">{input(draft!.text)}</div> : null}
          {!values.length && !adding(group) && (group === 'local' || entries.length) ? <p className={`py-1.5 ${UI_TEXT_META_CLASS}`}>{t(group === 'local' && !disabled ? 'memory.localEmpty' : 'memory.noneYet')}</p> : null}
        </div>
      </UiGroup>
    })}</div>
  </div>
}
