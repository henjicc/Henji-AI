import zh from '../../i18n/locales/zh-CN/errors.json'
import en from '../../i18n/locales/en-US/errors.json'

export function persistenceMessage(code: keyof typeof zh.persistence, values: Readonly<Record<string, string | number>>, locale = 'zh'): string {
  const messages = locale.startsWith('en') ? en.persistence : zh.persistence
  return messages[code].replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''))
}
