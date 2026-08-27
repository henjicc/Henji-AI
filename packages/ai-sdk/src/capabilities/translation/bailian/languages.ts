/**
 * Say-It 现有设置保存语言代码，百炼 Qwen-MT API 契约使用英文语言名。
 * 这里只转换 Say-It 当前公开的常用子集；未知值原样保留，避免关闭未来语言扩展。
 */
export const BAILIAN_QWEN_MT_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  en: 'English',
  zh: 'Chinese',
  zh_tw: 'Traditional Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  yue: 'Cantonese',
  ru: 'Russian',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  ms: 'Malay',
  ar: 'Arabic',
  hi: 'Hindi',
  bn: 'Bengali',
  ur: 'Urdu',
  he: 'Hebrew',
  el: 'Greek',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  cs: 'Czech',
  ro: 'Romanian',
  uk: 'Ukrainian',
  hu: 'Hungarian',
  km: 'Khmer',
  lo: 'Lao',
}

export function normalizeBailianQwenMtLanguage(value: string): string {
  const trimmed = value.trim()
  const normalized = trimmed.toLowerCase()
  if (normalized === 'auto') return 'auto'
  return BAILIAN_QWEN_MT_LANGUAGE_ALIASES[normalized] ?? trimmed
}
