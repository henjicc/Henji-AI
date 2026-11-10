/**
 * 分镜列表面板（`panel: 'shot-list'`）：每镜一段提示词与秒数，可增删、拖动镜头标题行改顺序。
 * 生成面板（ParamRenderer）与画布节点（NodeParamControl）都经 PanelTrigger 打开同一个面板、写同一份值：
 * `[{ id, prompt, duration }]`。值为空数组表示不分镜。
 */

import React, { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { UiButton, UiEmpty, UiIconButton, UiInlineStatus, UiRecordItem, UiRecordList, UiSpecialPanel, UiTextArea, UI_TEXT_LABEL_CLASS, UI_TEXT_META_CLASS } from '@/components/ui'
import NumberField from '@/components/ui/NumberInput'
import { useReorderDrag } from '@/components/ui/fileUploader/useReorderDrag'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { getI18nText } from '@/core/types/I18nText'

interface ShotListPanelConfig {
  minShotSeconds: number
  maxShotSeconds: number
  minTotalSeconds: number
  maxTotalSeconds: number
  maxPromptLength: number
  /** 新加一镜的默认秒数 */
  defaultShotSeconds: number
}

interface ShotValue {
  id: string
  prompt: string
  duration: number
}

const TEXT = {
  empty: { zh: '还没有镜头', en: 'No shots yet' },
  add: { zh: '添加镜头', en: 'Add Shot' },
  shot: { zh: '镜头 {n}', en: 'Shot {n}' },
  seconds: { zh: '秒', en: 's' },
  duration: { zh: '镜头 {n} 时长', en: 'Shot {n} duration' },
  prompt: { zh: '镜头 {n} 提示词', en: 'Shot {n} prompt' },
  placeholder: { zh: '这一镜的画面与动作', en: 'What happens in this shot' },
  remove: { zh: '删除镜头 {n}', en: 'Remove shot {n}' },
  drag: { zh: '拖动调整镜头顺序', en: 'Drag to reorder shots' },
  summary: { zh: '{count} 镜 · 共 {total} 秒', en: '{count} shots · {total}s total' },
  outOfRange: { zh: '总时长需在 {min}–{max} 秒，当前 {total} 秒', en: 'Total must be {min}–{max}s, now {total}s' },
  full: { zh: '已到总时长上限', en: 'Total length limit reached' },
} as const

const FALLBACK_CONFIG: ShotListPanelConfig = { minShotSeconds: 1, maxShotSeconds: 30, minTotalSeconds: 3, maxTotalSeconds: 30, maxPromptLength: 512, defaultShotSeconds: 5 }

function format(text: { zh: string; en: string }, language: string, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, String(value)), getI18nText(text, language))
}

function readShotValues(value: DynamicValue): ShotValue[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is DynamicValueMap => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).map((item, index) => ({
    id: typeof item.id === 'string' && item.id ? item.id : `shot-${index}`,
    prompt: typeof item.prompt === 'string' ? item.prompt : '',
    duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : FALLBACK_CONFIG.defaultShotSeconds,
  }))
}

interface ShotListPanelProps {
  value: DynamicValue
  onChange: (value: DynamicValue) => void
  config?: Partial<ShotListPanelConfig>
}

export const ShotListPanel: React.FC<ShotListPanelProps> = ({ value, onChange, config }) => {
  const { i18n } = useTranslation()
  const language = i18n.language
  const limits = { ...FALLBACK_CONFIG, ...config }
  const shots = useMemo(() => readShotValues(value), [value])
  const listRef = useRef<HTMLDivElement>(null)
  const total = shots.reduce((sum, shot) => sum + shot.duration, 0)
  const remaining = limits.maxTotalSeconds - total
  const write = useCallback((next: ShotValue[]) => onChange(next as unknown as DynamicValue), [onChange])
  const update = (index: number, patch: Partial<ShotValue>): void => write(shots.map((shot, at) => at === index ? { ...shot, ...patch } : shot))
  const add = (): void => write([...shots, {
    id: crypto.randomUUID(), prompt: '',
    duration: Math.max(limits.minShotSeconds, Math.min(limits.defaultShotSeconds, remaining)),
  }])
  const reorder = useCallback((from: number, to: number): void => {
    const next = shots.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    write(next)
  }, [shots, write])
  const ids = useMemo(() => shots.map(shot => shot.id), [shots])
  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({ disabled: false, isCustomDragging: false, files: ids, layout: 'vertical', onReorder: reorder, dragBoundaryRef: listRef, dragThreshold: 4 })

  const outOfRange = shots.length > 0 && (total < limits.minTotalSeconds || total > limits.maxTotalSeconds)
  const status = shots.length === 0 ? null : outOfRange
    ? <UiInlineStatus truncate>{format(TEXT.outOfRange, language, { min: limits.minTotalSeconds, max: limits.maxTotalSeconds, total })}</UiInlineStatus>
    : <span className={UI_TEXT_META_CLASS}>{format(TEXT.summary, language, { count: shots.length, total })}</span>

  return (
    <UiSpecialPanel
      bodyWidth={360}
      status={status}
      action={(
        <UiButton
          size="sm" variant="secondary" onClick={add}
          disabled={remaining < limits.minShotSeconds} disabledReason={getI18nText(TEXT.full, language)}
        >
          <Plus />{getI18nText(TEXT.add, language)}
        </UiButton>
      )}
    >
      {shots.length === 0 ? <UiEmpty size="xs" title={getI18nText(TEXT.empty, language)} /> : (
        <div ref={listRef}>
          <UiRecordList>
            {shots.map((shot, index) => {
              const n = index + 1
              const insertion = (dragState.isDragging || dragState.isDropping) && dragState.toIndex === index && dragState.fromIndex !== index
                ? (dragState.fromIndex! < index ? 'bottom' : 'top') : null
              return (
                <UiRecordItem
                  key={shot.id} index={index} density="compact"
                  ref={element => { itemRefs.current[index] = element }}
                  className={`relative ${dragState.isDragging && dragState.fromIndex === index ? 'opacity-50' : ''}`}
                >
                  {insertion && <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 z-raised h-0.5 bg-accent ${insertion === 'bottom' ? 'bottom-0' : 'top-0'}`} />}
                  <div
                    className="flex cursor-grab items-center gap-2"
                    onMouseDown={event => {
                      if ((event.target as HTMLElement).closest('button,input,textarea')) return
                      handleMouseDown(index, event)
                    }}
                  >
                    <GripVertical aria-label={getI18nText(TEXT.drag, language)} size={UI_ICON_SIZE.sm} className="shrink-0 text-text3" />
                    <span className={`min-w-0 flex-1 truncate ${UI_TEXT_LABEL_CLASS}`}>{format(TEXT.shot, language, { n })}</span>
                    <NumberField
                      size="sm" widthStrategy="content" ariaLabel={format(TEXT.duration, language, { n })}
                      value={shot.duration} min={limits.minShotSeconds} max={limits.maxShotSeconds} step={1} precision={0}
                      onChange={duration => update(index, { duration: Math.round(duration) })}
                    />
                    <span className={UI_TEXT_META_CLASS}>{getI18nText(TEXT.seconds, language)}</span>
                    <UiIconButton size="sm" tone="danger" aria-label={format(TEXT.remove, language, { n })} tooltip={format(TEXT.remove, language, { n })} onClick={() => write(shots.filter((_, at) => at !== index))}>
                      <Trash2 />
                    </UiIconButton>
                  </div>
                  <UiTextArea
                    height="short" aria-label={format(TEXT.prompt, language, { n })}
                    placeholder={getI18nText(TEXT.placeholder, language)}
                    maxLength={limits.maxPromptLength} value={shot.prompt}
                    onChange={event => update(index, { prompt: event.target.value })}
                  />
                </UiRecordItem>
              )
            })}
          </UiRecordList>
        </div>
      )}
    </UiSpecialPanel>
  )
}
