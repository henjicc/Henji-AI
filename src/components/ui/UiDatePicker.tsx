import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { UiButton, UiFieldTrigger, UiIconButton, UiOptionButton } from './primitives'
import { UI_TEXT_META_CLASS, UI_TEXT_PANEL_TITLE_CLASS, UI_TRIGGER_PANEL_CLASS } from './styleTokens'

interface CalendarCell {
  date: Date
  inCurrentMonth: boolean
}

export interface UiDatePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
  clearLabel: string
  todayLabel: string
  locale?: string
  className?: string
}

function parseIsoDate(dateText: string): Date | null {
  if (!dateText) return null
  const matched = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched) return null
  const year = Number.parseInt(matched[1], 10)
  const month = Number.parseInt(matched[2], 10)
  const day = Number.parseInt(matched[3], 10)
  const date = new Date(year, month - 1, day, 0, 0, 0, 0)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toDisplayDate(dateText: string): string {
  const parsed = parseIsoDate(dateText)
  if (!parsed) return ''
  return toIsoDate(parsed).replace(/-/g, '/')
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0)
}

function addDays(date: Date, dayOffset: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + dayOffset)
  return next
}

function buildCalendarCells(viewMonth: Date): CalendarCell[] {
  const monthStart = startOfMonth(viewMonth)
  const weekdayOffset = (monthStart.getDay() + 6) % 7
  const gridStart = addDays(monthStart, -weekdayOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index)
    return {
      date,
      inCurrentMonth: date.getMonth() === viewMonth.getMonth(),
    }
  })
}

function resolveWeekdayLabels(locale: string): string[] {
  if (locale.toLowerCase().startsWith('zh')) {
    return ['一', '二', '三', '四', '五', '六', '日']
  }
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
}

export function UiDatePicker({
  value,
  onChange,
  placeholder,
  ariaLabel,
  clearLabel,
  todayLabel,
  locale = 'zh-CN',
  className = '',
}: UiDatePickerProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const parsedValue = useMemo(() => parseIsoDate(value), [value])
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(parsedValue ?? new Date()))

  useEffect(() => {
    if (!parsedValue) return
    setViewMonth(startOfMonth(parsedValue))
  }, [parsedValue])

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [isOpen])

  const weekdayLabels = useMemo(() => resolveWeekdayLabels(locale), [locale])
  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(viewMonth)
  }, [locale, viewMonth])
  const cells = useMemo(() => buildCalendarCells(viewMonth), [viewMonth])
  const selectedIso = parsedValue ? toIsoDate(parsedValue) : ''
  const today = new Date()
  const todayIso = toIsoDate(today)

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <UiFieldTrigger
        onClick={() => setIsOpen((prev) => !prev)}
        open={isOpen}
        className="w-full"
        title={ariaLabel}
        // 可访问名称是“开始日期 / 结束日期”，不是占位的日期格式（任务 5.3）
        aria-label={selectedIso ? `${ariaLabel}：${toDisplayDate(selectedIso)}` : ariaLabel}
        aria-expanded={isOpen}
      >
        <span className={selectedIso ? 'text-text1' : 'text-text3'}>
          {selectedIso ? toDisplayDate(selectedIso) : placeholder}
        </span>
      </UiFieldTrigger>

      {isOpen && (
        // 与下拉同一浮层表面；非 portal，只需盖住同一层叠上下文里的兄弟内容
        <div className={`absolute left-0 top-[calc(100%+6px)] z-dropdown w-[248px] ${UI_TRIGGER_PANEL_CLASS} p-2`}>
          <div className="mb-2 flex items-center justify-between">
            <span className={UI_TEXT_PANEL_TITLE_CLASS}>{monthLabel}</span>
            <div className="flex items-center gap-1">
              <UiIconButton size="sm"
                type="button"
                onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </UiIconButton>
              <UiIconButton size="sm"
                type="button"
                onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </UiIconButton>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 px-0.5 pb-1">
            {weekdayLabels.map((label) => (
              <span key={label} className={`text-center ${UI_TEXT_META_CLASS}`}>
                {label}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell) => {
              const iso = toIsoDate(cell.date)
              const isSelected = iso === selectedIso
              const isToday = iso === todayIso
              return (
                // 日期格是单选选项：选中中性抬升；今天只用强调文字标出，不另画底
                <UiOptionButton
                  key={iso}
                  type="button"
                  variant="menu"
                  size="sm"
                  active={isSelected}
                  aria-pressed={isSelected}
                  aria-current={isToday ? 'date' : undefined}
                  className="w-8 justify-center !px-0 tabular-nums"
                  onClick={() => {
                    onChange(iso)
                    setIsOpen(false)
                  }}
                >
                  <span className={isToday && !isSelected ? 'font-semibold text-accent-text' : cell.inCurrentMonth ? '' : 'text-text3'}>
                    {cell.date.getDate()}
                  </span>
                </UiOptionButton>
              )
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <UiButton
              type="button"
              size="sm"
              onClick={() => {
                onChange('')
                setIsOpen(false)
              }}
            >
              {clearLabel}
            </UiButton>
            <UiButton
              type="button"
              size="sm"
              onClick={() => {
                onChange(todayIso)
                setViewMonth(startOfMonth(today))
                setIsOpen(false)
              }}
            >
              {todayLabel}
            </UiButton>
          </div>
        </div>
      )}
    </div>
  )
}
