import { formatDateTime } from '@/utils/datetimeFormat'

/**
 * 生成记录的“辅助信息行”（设计稿 Generation：类型 · 模型 · 规格 · 时长 · 时间，一行文字代替多个小徽标）。
 * 纯展示格式化，不参与任何业务判断。
 */

const relativeDayFormatters = new Map<string, Intl.RelativeTimeFormat>()

function relativeDay(locale: string, offset: 0 | -1): string {
  let formatter = relativeDayFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    relativeDayFormatters.set(locale, formatter)
  }
  const label = formatter.format(offset, 'day')
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1)
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false }

/** 记录时间：今天/昨天 + 时分；今年内 月日 + 时分；更早带年份。不显示秒。 */
export function formatTaskCreatedAt(value: Date | undefined, locale: string, now: Date = new Date()): string {
  if (!value || Number.isNaN(value.getTime())) return ''
  const time = formatDateTime(value, locale, TIME_OPTIONS)
  const dayDelta = Math.round((startOfDay(now) - startOfDay(value)) / DAY_MS)
  if (dayDelta === 0) return `${relativeDay(locale, 0)} ${time}`
  if (dayDelta === 1) return `${relativeDay(locale, -1)} ${time}`
  const date = formatDateTime(value, locale, value.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' })
  return `${date} ${time}`
}

/** 媒体时长读数：m:ss，满一小时为 h:mm:ss。 */
export function formatMediaDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

/** 把有值的片段用“ · ”连成一行。 */
export function joinTaskMeta(parts: ReadonlyArray<string | null | undefined | false>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' · ')
}
