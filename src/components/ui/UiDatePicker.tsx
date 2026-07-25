import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { UiButton, UiIconButton } from './primitives'

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
      <UiButton
        type="button"
        variant="muted"
        size="sm"
        onClick={() => setIsOpen((prev) => !prev)}
        className="!h-8 !w-full !justify-between !rounded-md !px-2 !text-xs"
        title={ariaLabel}
      >
        <span className={`truncate ${selectedIso ? 'text-text-dark' : 'text-zinc-400'}`}>
          {selectedIso ? toDisplayDate(selectedIso) : placeholder}
        </span>
        <Calendar className="h-3.5 w-3.5 text-zinc-400" />
      </UiButton>

      {isOpen && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[248px] rounded-lg border border-border-dark bg-panel p-2 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-text-dark">{monthLabel}</span>
            <div className="flex items-center gap-1">
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                className="!h-6 !w-6"
                onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </UiIconButton>
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                className="!h-6 !w-6"
                onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </UiIconButton>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 px-0.5 pb-1">
            {weekdayLabels.map((label) => (
              <span key={label} className="text-center text-2xs text-zinc-400">
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
                <UiButton
                  key={iso}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`!h-8 !w-8 !min-h-0 !rounded-md !px-0 !text-sm !font-normal ${
                    isSelected
                      ? '!border-accent !bg-brand-600 !text-white hover:!brightness-110'
                      : isToday
                        ? '!border-border-dark !bg-layer !text-text-dark'
                        : '!border-transparent !bg-transparent hover:!bg-layer'
                  } ${cell.inCurrentMonth ? 'opacity-100' : 'opacity-45'}`}
                  onClick={() => {
                    onChange(iso)
                    setIsOpen(false)
                  }}
                >
                  {cell.date.getDate()}
                </UiButton>
              )
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-border-dark pt-2">
            <UiButton
              type="button"
              variant="ghost"
              size="sm"
              className="!h-7 !px-2 text-xs"
              onClick={() => {
                onChange('')
                setIsOpen(false)
              }}
            >
              {clearLabel}
            </UiButton>
            <UiButton
              type="button"
              variant="ghost"
              size="sm"
              className="!h-7 !px-2 text-xs"
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
