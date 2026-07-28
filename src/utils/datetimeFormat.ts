/**
 * 带缓存的日期时间格式化。
 *
 * `Date.prototype.toLocaleString(locale, options)` 每次调用都会新建一个
 * `Intl.DateTimeFormat`，在历史列表这种一次渲染上百条的地方是可观的开销。
 * 这里按 locale + 选项缓存 formatter 实例，调用方语义不变。
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  const cached = formatterCache.get(key)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat(locale, options)
  formatterCache.set(key, formatter)
  return formatter
}

export function formatDateTime(
  value: Date | number,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return getFormatter(locale, options).format(value)
}
