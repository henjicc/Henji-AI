export type VoiceSourceTag = 'system' | 'clone'
export type VoiceGenderTag = 'male' | 'female'
export type VoiceAgeTag = 'child' | 'youth' | 'mature'

export interface VoiceFeatureTagInput {
  voiceId?: string
  voiceName?: string
  description?: string
  source?: VoiceSourceTag
}

export interface VoiceFeatureTagMetadata {
  source?: VoiceSourceTag
  gender?: VoiceGenderTag
  age?: VoiceAgeTag
  languages: string[]
  tags: string[]
}

interface LanguageRule {
  code: string
  pattern: RegExp
}

const LANGUAGE_RULES: LanguageRule[] = [
  { code: 'zh', pattern: /(chinese|mandarin|普通话|中文|汉语)/i },
  { code: 'yue', pattern: /(cantonese|粤语)/i },
  { code: 'en', pattern: /\b(english|英(?:语|文))\b/i },
  { code: 'ja', pattern: /(japanese|日语)/i },
  { code: 'ko', pattern: /(korean|韩语)/i },
  { code: 'fr', pattern: /(french|法语)/i },
  { code: 'de', pattern: /(german|德语)/i },
  { code: 'es', pattern: /(spanish|西班牙语)/i },
  { code: 'pt', pattern: /(portuguese|葡萄牙语)/i },
  { code: 'ru', pattern: /(russian|俄语)/i },
  { code: 'ar', pattern: /(arabic|阿拉伯语)/i },
  { code: 'it', pattern: /(italian|意大利语)/i },
  { code: 'tr', pattern: /(turkish|土耳其语)/i },
  { code: 'vi', pattern: /(vietnamese|越南语)/i },
  { code: 'id', pattern: /(indonesian|印尼语|印度尼西亚语)/i },
  { code: 'nl', pattern: /(dutch|荷兰语)/i },
  { code: 'uk', pattern: /(ukrainian|乌克兰语)/i },
  { code: 'th', pattern: /(thai|泰语)/i },
  { code: 'hi', pattern: /(hindi|印地语)/i },
]

const CHILD_AGE_PATTERN = /(child|kid|kids|儿童|童声|童音|男童|女童|萌娃|小朋友|小孩|学童|幼儿|孩童|baby|toddler)/i
const YOUTH_AGE_PATTERN = /(youth|young|teen|teenager|青年|少年|少女|学弟|学妹|大学生|小哥哥|小姐姐)/i
const MATURE_AGE_PATTERN = /(mature|senior|middle.?aged|成熟|中年|稳重|大叔|阿姨|御姐|高管|主播)/i
const FEMALE_PATTERN = /(female|woman|lady|女性|女声|御姐|少女|学妹|女王|姐姐)/i
const MALE_PATTERN = /(male|man|gentleman|男性|男声|男音|学长|少爷|弟弟|男友)/i

function normalizeTag(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeText(value: string | undefined): string {
  if (!value) {
    return ''
  }
  return value.trim()
}

function buildFeatureText(input: VoiceFeatureTagInput): string {
  return [
    normalizeText(input.voiceId),
    normalizeText(input.voiceName),
    normalizeText(input.description),
  ].filter((item) => item.length > 0).join(' ')
}

function normalizeLanguageCode(value: string): string | null {
  const normalized = normalizeTag(value)
  if (!normalized) {
    return null
  }
  if (normalized === 'zh' || normalized === 'chinese' || normalized === 'mandarin') return 'zh'
  if (normalized === 'yue' || normalized === 'cantonese') return 'yue'
  if (normalized === 'en' || normalized === 'english') return 'en'
  if (normalized === 'ja' || normalized === 'japanese') return 'ja'
  if (normalized === 'ko' || normalized === 'korean') return 'ko'
  if (normalized === 'fr' || normalized === 'french') return 'fr'
  if (normalized === 'de' || normalized === 'german') return 'de'
  if (normalized === 'es' || normalized === 'spanish') return 'es'
  if (normalized === 'pt' || normalized === 'portuguese') return 'pt'
  if (normalized === 'ru' || normalized === 'russian') return 'ru'
  if (normalized === 'ar' || normalized === 'arabic') return 'ar'
  if (normalized === 'it' || normalized === 'italian') return 'it'
  if (normalized === 'tr' || normalized === 'turkish') return 'tr'
  if (normalized === 'vi' || normalized === 'vietnamese') return 'vi'
  if (normalized === 'id' || normalized === 'indonesian') return 'id'
  if (normalized === 'nl' || normalized === 'dutch') return 'nl'
  if (normalized === 'uk' || normalized === 'ukrainian') return 'uk'
  if (normalized === 'th' || normalized === 'thai') return 'th'
  if (normalized === 'hi' || normalized === 'hindi') return 'hi'
  return null
}

function detectLanguages(input: VoiceFeatureTagInput): string[] {
  const text = buildFeatureText(input)
  if (!text) {
    return []
  }
  const detected = new Set<string>()
  for (const rule of LANGUAGE_RULES) {
    if (rule.pattern.test(text)) {
      detected.add(rule.code)
    }
  }
  return Array.from(detected)
}

function detectGender(input: VoiceFeatureTagInput): VoiceGenderTag | undefined {
  const text = buildFeatureText(input)
  if (!text) {
    return undefined
  }
  if (FEMALE_PATTERN.test(text)) {
    return 'female'
  }
  if (MALE_PATTERN.test(text)) {
    return 'male'
  }
  return undefined
}

function detectAge(input: VoiceFeatureTagInput): VoiceAgeTag | undefined {
  const text = buildFeatureText(input)
  if (!text) {
    return undefined
  }
  if (CHILD_AGE_PATTERN.test(text)) {
    return 'child'
  }
  if (YOUTH_AGE_PATTERN.test(text)) {
    return 'youth'
  }
  if (MATURE_AGE_PATTERN.test(text)) {
    return 'mature'
  }
  return undefined
}

function parseSourceFromTag(rawTag: string): VoiceSourceTag | undefined {
  const normalized = normalizeTag(rawTag)
  if (normalized === 'custom' || normalized === 'clone' || normalized === 'source:clone') {
    return 'clone'
  }
  if (normalized === 'source:system' || normalized === 'system') {
    return 'system'
  }
  return undefined
}

function parseGenderFromTag(rawTag: string): VoiceGenderTag | undefined {
  const normalized = normalizeTag(rawTag)
  if (normalized === 'male' || normalized === 'gender:male') return 'male'
  if (normalized === 'female' || normalized === 'gender:female') return 'female'
  return undefined
}

function parseAgeFromTag(rawTag: string): VoiceAgeTag | undefined {
  const normalized = normalizeTag(rawTag)
  if (normalized === 'child' || normalized === 'age:child') return 'child'
  if (normalized === 'youth' || normalized === 'age:youth') return 'youth'
  if (normalized === 'mature' || normalized === 'age:mature') return 'mature'
  return undefined
}

function parseLanguageFromTag(rawTag: string): string | undefined {
  const normalized = normalizeTag(rawTag)
  if (normalized.startsWith('lang:')) {
    return normalizeLanguageCode(normalized.slice('lang:'.length)) ?? undefined
  }
  if (normalized.startsWith('language:')) {
    return normalizeLanguageCode(normalized.slice('language:'.length)) ?? undefined
  }
  return normalizeLanguageCode(normalized) ?? undefined
}

export function resolveVoiceFeatureTags(
  rawTags: string[] | undefined,
  input: VoiceFeatureTagInput = {}
): VoiceFeatureTagMetadata {
  const tagSet = new Set<string>()
  const languageSet = new Set<string>()
  let source: VoiceSourceTag | undefined
  let gender: VoiceGenderTag | undefined
  let age: VoiceAgeTag | undefined

  for (const rawTag of rawTags ?? []) {
    if (typeof rawTag !== 'string') {
      continue
    }
    const normalized = normalizeTag(rawTag)
    if (!normalized) {
      continue
    }
    tagSet.add(normalized)
    const parsedSource = parseSourceFromTag(normalized)
    if (parsedSource && !source) {
      source = parsedSource
    }
    const parsedGender = parseGenderFromTag(normalized)
    if (parsedGender && !gender) {
      gender = parsedGender
    }
    const parsedAge = parseAgeFromTag(normalized)
    if (parsedAge && !age) {
      age = parsedAge
    }
    const parsedLanguage = parseLanguageFromTag(normalized)
    if (parsedLanguage) {
      languageSet.add(parsedLanguage)
    }
  }

  if (!source && input.source) {
    source = input.source
  }
  if (!gender) {
    gender = detectGender(input)
  }
  if (!age) {
    age = detectAge(input)
  }
  if (languageSet.size === 0) {
    const inferredLanguages = detectLanguages(input)
    for (const language of inferredLanguages) {
      languageSet.add(language)
    }
  }

  if (source) {
    tagSet.add(`source:${source}`)
  }
  if (gender) {
    tagSet.add(`gender:${gender}`)
  }
  if (age) {
    tagSet.add(`age:${age}`)
  }
  for (const language of languageSet) {
    tagSet.add(`lang:${language}`)
  }

  return {
    source,
    gender,
    age,
    languages: Array.from(languageSet),
    tags: Array.from(tagSet),
  }
}

export function buildVoiceFeatureTags(input: VoiceFeatureTagInput): string[] {
  return resolveVoiceFeatureTags([], input).tags
}
