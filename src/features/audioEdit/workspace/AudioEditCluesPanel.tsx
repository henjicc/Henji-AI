import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ChevronUp, ListChecks, ListFilter, Play } from 'lucide-react'
import { UiButton, UiEmpty, UiOptionButton, UiToolbar } from '@/components/ui'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { buildAudioEditClueRows, chooseAudioEditClueOption, countAudioEditClues, type AudioEditClueRow, type AudioEditClueTier } from '../audioEditClueReview'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'
import { editAudioEditProject } from '../application/audioEditProjectInstances'
import { notificationMessage } from '@/i18n/notifications'
import { useAudioEditWorkspace } from './audioEditWorkspaceContext'

/** 试听从接缝前这么多秒开始，听得到前文怎么接上 */
const AUDITION_PREROLL_SECONDS = 1.5

const TIER_NAME: Partial<Record<AudioEditClueTier, string>> = { decide: '待定', check: '建议抽看' }

function formatTime(frame: number, sampleRate: number): string {
  const seconds = frame / Math.max(1, sampleRate)
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

/** 要人定的是实心点，抽看的是空心点；其余不画，行就退后。 */
function TierMark({ tier }: { tier: AudioEditClueTier }): JSX.Element {
  return <span aria-hidden="true" className="flex w-2 shrink-0 justify-center">
    {tier === 'decide' ? <span className="h-1.5 w-1.5 rounded-full bg-text1" /> : tier === 'check' ? <span className="h-1.5 w-1.5 rounded-full border border-text3" /> : null}
  </span>
}

/**
 * “线索”面板：本地粗剪与助手处理之后，人来过仍要定的几处。每行“这一处的文字 · 为什么 · 现在怎么剪”，
 * 选中后就地列出各种做法，点一下改判（与助手写 chosen_option 同一份操作、进撤销栈），回车试听接缝。
 * 已自动处理的与语气词、停顿提示默认收成一行。
 * 列表是一个焦点（listbox + aria-activedescendant）：上下键移动的是选中行，不是焦点，选中只画中性选中底。
 */
export function AudioEditCluesPanel(): JSX.Element {
  const workspace = useAudioEditWorkspace()
  const { project } = workspace
  const sampleRate = project.source.sampleRate
  const listId = useId().replace(/:/g, '')
  const listRef = useRef<HTMLDivElement>(null)
  // 这次打开作品后改判过的线索固定在原来那一层，过到一半的行不会因为改判跳到别处
  const [pinned, setPinned] = useState<ReadonlyMap<string, AudioEditClueTier>>(new Map())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [onlyDecide, setOnlyDecide] = useState(false)
  const [expanded, setExpanded] = useState<{ auto: boolean; hint: boolean }>({ auto: false, hint: false })
  useEffect(() => { setPinned(new Map()); setSelectedId(null); setExpanded({ auto: false, hint: false }) }, [project.id])
  const rows = useMemo(() => buildAudioEditClueRows(project, pinned), [project, pinned])
  const counts = useMemo(() => countAudioEditClues(project), [project])
  const lead = rows.filter((row) => row.tier === 'decide' || (!onlyDecide && row.tier === 'check'))
  const auto = onlyDecide ? [] : rows.filter((row) => row.tier === 'auto')
  const hints = onlyDecide ? [] : rows.filter((row) => row.tier === 'hint')
  const visible = [...lead, ...(expanded.auto ? auto : []), ...(expanded.hint ? hints : [])]
  const selected = visible.find((row) => row.id === selectedId)
  const rowId = (row: AudioEditClueRow) => `${listId}-${row.id}`

  // 点过的行、做法按钮不留焦点：焦点始终在列表上，选中只靠中性选中底表达
  const focusList = () => listRef.current?.focus({ preventScroll: true })
  const select = (row: AudioEditClueRow) => {
    focusList()
    setSelectedId(row.id)
    workspace.navigateToFrame(row.startFrame)
    requestAnimationFrame(() => document.getElementById(rowId(row))?.scrollIntoView({ block: 'nearest' }))
  }
  const move = (step: 1 | -1) => {
    if (!visible.length) return
    const index = selected ? visible.indexOf(selected) : step > 0 ? -1 : visible.length
    select(visible[Math.max(0, Math.min(visible.length - 1, index + step))])
  }
  const choose = (row: AudioEditClueRow, optionId: string) => {
    focusList()
    if (workspace.disabled || row.blocked || optionId === row.current) return
    let changed = false
    try { editAudioEditProject(project.id, (current) => { const next = chooseAudioEditClueOption(current, row.id, optionId); changed = next !== current; return next }) } catch (error) { workspace.notifyError(error); return }
    if (!changed) { workspace.notify(notificationMessage('audioCuesUnchanged')); return }
    setPinned((current) => new Map(current).set(row.id, row.tier))
    workspace.navigateToFrame(row.startFrame)
  }
  const audition = (row: AudioEditClueRow) => {
    workspace.navigateToFrame(Math.max(0, row.startFrame - Math.round(AUDITION_PREROLL_SECONDS * sampleRate)))
    const playback = useAudioEditPlaybackStore.getState()
    // 原声模式听不到剪过的接缝
    if (playback.mode === 'source') playback.setMode('edited')
    if (!playback.playing) void workspace.togglePlayback()
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1); return }
    if (!selected) return
    if (event.key === 'Enter' && event.target instanceof HTMLElement && (event.target === listRef.current || event.target.closest('[data-clue-focus]'))) { event.preventDefault(); audition(selected); return }
    const options = selected.options
    const index = options.findIndex((option) => option.id === selected.current)
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const step = event.key === 'ArrowRight' ? 1 : -1
      const next = index < 0 ? (step > 0 ? 0 : options.length - 1) : (index + step + options.length) % options.length
      if (options[next]) choose(selected, options[next].id)
      return
    }
    const digit = Number(event.key)
    if (Number.isInteger(digit) && digit >= 1 && digit <= options.length) { event.preventDefault(); choose(selected, options[digit - 1].id) }
  }

  const renderRow = (row: AudioEditClueRow) => {
    const isSelected = row.id === selected?.id
    const current = row.options.find((option) => option.id === row.current)
    const tierName = TIER_NAME[row.tier]
    return <div key={row.id} id={rowId(row)} role="option" aria-selected={isSelected}
      aria-label={[tierName, row.text, row.reason.label, current?.label ?? '未处理'].filter(Boolean).join('，')} className="flex flex-col">
      <UiOptionButton variant="menu" size="sm" active={isSelected} tabIndex={-1} className="w-full gap-2" data-clue-focus=""
        tooltip={`${formatTime(row.startFrame, sampleRate)} · ${row.text} · ${row.reason.detail}`}
        onClick={() => select(row)}>
        <TierMark tier={row.tier} />
        <span className={`min-w-0 flex-1 truncate ${row.tier === 'decide' || row.tier === 'check' ? 'text-text1' : 'text-text2'}`}>{row.text}</span>
        <span className="shrink-0 whitespace-nowrap text-text3">{row.reason.label}</span>
        <span className={`shrink-0 whitespace-nowrap ${current ? 'text-text2' : 'text-text3'}`}>{current?.label ?? '未处理'}</span>
      </UiOptionButton>
      {isSelected && <div className="flex flex-col pl-4">
        <div role="radiogroup" aria-label={`${row.text}：做法`} className="flex flex-col">
          {row.options.map((option, index) => {
            const checked = option.id === row.current
            return <UiOptionButton key={option.id} variant="menu" size="sm" role="radio" aria-checked={checked} tabIndex={-1} className="w-full gap-2" data-clue-focus=""
              disabled={workspace.disabled || Boolean(row.blocked)} disabledReason={workspace.disabled ? '正在处理，请稍候' : row.blocked} tooltip={option.readsAs ? `${option.label}（${index + 1}）：${option.readsAs}` : `${option.label}（${index + 1}）`}
              onClick={() => choose(row, option.id)}>
              <span aria-hidden="true" className="flex w-4 shrink-0 justify-center">{checked ? <Check size={UI_ICON_SIZE.sm} className="text-accent-text" /> : null}</span>
              <span className={`shrink-0 whitespace-nowrap ${checked ? 'text-text1' : 'text-text2'}`}>{option.label}</span>
              {option.readsAs ? <span className="min-w-0 flex-1 truncate text-text3">{option.readsAs}</span> : null}
            </UiOptionButton>
          })}
        </div>
        <UiButton size="sm" tabIndex={-1} className="self-start" tooltip="从这一处前一点播放剪好的声音（回车）" onClick={() => audition(row)}><Play />试听</UiButton>
      </div>}
    </div>
  }
  const renderSummary = (key: 'auto' | 'hint', items: AudioEditClueRow[], label: string) => items.length > 0 && <>
    <div role="presentation">
      <UiOptionButton variant="menu" size="sm" tabIndex={-1} className="w-full gap-2" aria-expanded={expanded[key]} onClick={() => setExpanded((current) => ({ ...current, [key]: !current[key] }))}>
        <span aria-hidden="true" className="flex w-2 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-text3">{label}</span>
        <ChevronRight size={UI_ICON_SIZE.sm} aria-hidden="true" className={`shrink-0 text-text3 transition-transform duration-120 ${expanded[key] ? 'rotate-90' : ''}`} />
      </UiOptionButton>
    </div>
    {expanded[key] && items.map(renderRow)}
  </>

  return <section aria-label="线索" className="flex h-full min-h-0 flex-col bg-panel" data-audio-edit-panel="clues">
    {rows.length === 0
      ? <UiEmpty className="min-h-0 flex-1" size="node" icon={<ListChecks size={UI_ICON_SIZE.hero} aria-hidden="true" />} title="没有要看的线索" />
      : <div ref={listRef} role="listbox" tabIndex={0} aria-label="剪辑线索" aria-activedescendant={selected ? rowId(selected) : undefined}
        className={`min-h-0 flex-1 overflow-y-auto px-2 py-1 outline-none ${selected ? '' : 'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring'}`} onKeyDown={onKeyDown}>
        {lead.map(renderRow)}
        {renderSummary('auto', auto, lead.length ? `另有 ${auto.length} 处已自动处理` : `${auto.length} 处已自动处理`)}
        {renderSummary('hint', hints, `${hints.length} 处语气词与停顿`)}
      </div>}
    <UiToolbar variant="footer" aria-label="线索工具" tools={[
      { kind: 'action', id: 'previous', label: '上一条', tooltip: '上一条线索（↑）', icon: ChevronUp, disabled: !visible.length, disabledReason: '没有可看的线索', onSelect: () => move(-1) },
      { kind: 'action', id: 'next', label: '下一条', tooltip: '下一条线索（↓）', icon: ChevronDown, disabled: !visible.length, disabledReason: '没有可看的线索', onSelect: () => move(1) },
      { kind: 'action', id: 'only-decide', label: '只看待定', icon: ListFilter, on: onlyDecide, onSelect: () => setOnlyDecide((value) => !value) },
    ]}>{`待定 ${counts.decide} · 建议抽看 ${counts.check}`}</UiToolbar>
  </section>
}
