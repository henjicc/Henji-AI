import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UI_FIELD_CONTROL_HEIGHT_SM_CLASS, UiButton, UiEmpty, UiError, UiLoading, UiInput, UiOptionButton } from '@/components/ui'
import AudioPlayer from '@/components/AudioPlayer'
import { toFetchableMediaUrl, isLikelyLocalImagePath } from '@/services/imageSource'
import { GenerationService } from '@/core/services/GenerationService'
import {
  buildVoiceFeatureTags,
  resolveVoiceFeatureTags,
  type VoiceAgeTag,
  type VoiceGenderTag,
  type VoiceSourceTag,
} from '@/core/voice/voiceFeatureTags'
import { getI18nText, type I18nText } from '@/core/types'
import { createLogger } from '@/core/logging'
import type { VoiceSelectorConfig } from '@/core/types/PanelTypes'
import { voiceLibraryService, type VoiceLibraryRecord } from '@/services/voiceLibrary/VoiceLibraryService'
import { rememberTtsVoiceNames } from '@/services/voiceLibrary/ttsVoiceNameCache'
import { aiListTtsVoices } from '@/commands/aiRuntime'

const logger = createLogger('components.params.panels.VoiceSelectorPanel')

type VoiceSourceFilter = 'all' | VoiceSourceTag
type VoiceGenderFilter = 'all' | VoiceGenderTag
type VoiceAgeFilter = 'all' | VoiceAgeTag
type VoiceLanguageFilter = 'all' | string

interface VoiceSelectorPanelProps {
  value: string
  onChange: (value: string) => void
  config?: VoiceSelectorConfig
}

interface FilterOption<TValue extends string> {
  value: TValue
  label: string
}

interface VoiceViewItem {
  id: string
  name: string
  description: string
  isCustom: boolean
  source?: VoiceSourceTag
  gender?: VoiceGenderTag
  age?: VoiceAgeTag
  languages: string[]
}

interface HoverScrollTextProps {
  text: string
  active: boolean
}

const SOURCE_FILTER_OPTIONS: Array<FilterOption<VoiceSourceFilter>> = [
  { value: 'all', label: '全部来源' },
  { value: 'system', label: '系统音色' },
  { value: 'clone', label: '克隆音色' },
]

const GENDER_FILTER_OPTIONS: Array<FilterOption<VoiceGenderFilter>> = [
  { value: 'all', label: '全部性别' },
  { value: 'male', label: '男声' },
  { value: 'female', label: '女声' },
]

const AGE_FILTER_OPTIONS: Array<FilterOption<VoiceAgeFilter>> = [
  { value: 'all', label: '全部年龄' },
  { value: 'child', label: '童声' },
  { value: 'youth', label: '青年' },
  { value: 'mature', label: '成熟' },
]

const FILTER_BUTTON_CLASS = '!h-8 !px-3 !py-1 justify-center text-xs leading-tight whitespace-nowrap'

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文 (普通话)',
  yue: '中文 (粤语)',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  pt: '葡萄牙语',
  ru: '俄语',
  ar: '阿拉伯语',
  it: '意大利语',
  tr: '土耳其语',
  vi: '越南语',
  id: '印尼语',
  nl: '荷兰语',
  uk: '乌克兰语',
  th: '泰语',
  hi: '印地语',
}

const LANGUAGE_PRIORITY_ORDER = [
  'zh',
  'yue',
  'ja',
  'ko',
  'en',
  'es',
  'fr',
  'de',
  'ru',
  'pt',
  'ar',
  'it',
  'tr',
  'vi',
  'id',
  'nl',
  'uk',
  'th',
  'hi',
]

function resolveLanguageLabel(code: string): string {
  if (LANGUAGE_LABELS[code]) {
    return LANGUAGE_LABELS[code]
  }
  return code.toUpperCase()
}

function resolveDescriptionText(description: DynamicValue, language: string): string {
  if (typeof description === 'string') {
    return description.trim()
  }
  if (!description || typeof description !== 'object' || Array.isArray(description)) {
    return ''
  }
  return getI18nText(description as I18nText, language).trim()
}

const HoverScrollText: React.FC<HoverScrollTextProps> = ({ text, active }) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cycleRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const cycle = cycleRef.current
    if (!container || !cycle) {
      return
    }
    container.scrollLeft = 0
    if (!active) {
      return
    }
    const cycleWidth = cycle.offsetWidth
    if (cycleWidth <= container.clientWidth + 1) {
      return
    }

    let rafId = 0
    const run = (): void => {
      const current = containerRef.current
      if (!current) {
        return
      }
      const next = current.scrollLeft + 0.45
      current.scrollLeft = next >= cycleWidth ? next - cycleWidth : next
      rafId = requestAnimationFrame(run)
    }
    rafId = requestAnimationFrame(run)
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [active, text])

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden whitespace-nowrap text-left text-2xs leading-tight text-text-muted"
    >
      <div className="inline-flex items-center">
        <span ref={cycleRef} className="inline-block pr-8">{text}</span>
        <span className="inline-block pr-8" aria-hidden="true">{text}</span>
      </div>
    </div>
  )
}

export const VoiceSelectorPanel: React.FC<VoiceSelectorPanelProps> = ({
  value,
  onChange,
  config,
}) => {
  const { i18n } = useTranslation()
  const [selectedSource, setSelectedSource] = useState<VoiceSourceFilter>('all')
  const [selectedGender, setSelectedGender] = useState<VoiceGenderFilter>('all')
  const [selectedAge, setSelectedAge] = useState<VoiceAgeFilter>('all')
  const [selectedLanguage, setSelectedLanguage] = useState<VoiceLanguageFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [hoveredVoiceId, setHoveredVoiceId] = useState<string | null>(null)
  const [customVoices, setCustomVoices] = useState<VoiceSelectorConfig['voices']>([])
  const [libraryRecords, setLibraryRecords] = useState<VoiceLibraryRecord[]>([])
  const [libraryError, setLibraryError] = useState('')
  const [refreshingVoiceId, setRefreshingVoiceId] = useState<string | null>(null)
  const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null)
  const refreshController = useRef<AbortController | null>(null)
  const [remoteVoices, setRemoteVoices] = useState<VoiceSelectorConfig['voices']>([])
  const remoteRequestRef = useRef(0)
  const [remoteStatus, setRemoteStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [remoteError, setRemoteError] = useState('')
  const [customIdOpen, setCustomIdOpen] = useState(false)
  const [customId, setCustomId] = useState('')
  const [deletingVoiceId, setDeletingVoiceId] = useState<string | null>(null)
  const configuredVoices = useMemo(() => config?.voices ?? [], [config?.voices])
  const voiceLibraryScope = config?.voiceLibrary
  const remoteModelId = config?.remoteModelId

  const loadRemoteVoices = useCallback(async (): Promise<void> => {
    if (!remoteModelId) return
    const requestId = ++remoteRequestRef.current
    setRemoteStatus('loading')
    setRemoteError('')
    try {
      const records = await aiListTtsVoices(remoteModelId)
      if (requestId !== remoteRequestRef.current) return
      rememberTtsVoiceNames(remoteModelId, records)
      setRemoteVoices(records.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        tags: buildVoiceFeatureTags({
          voiceId: item.id,
          voiceName: item.name,
          description: item.description,
          source: item.source ?? 'clone',
        }),
      })))
      setRemoteStatus('ready')
    } catch (error) {
      if (requestId !== remoteRequestRef.current) return
      logger.warn('load remote voices failed', { modelId: remoteModelId, error })
      setRemoteError(error instanceof Error ? error.message : '音色列表加载失败')
      setRemoteStatus('failed')
    }
  }, [remoteModelId])

  useEffect(() => {
    setRemoteVoices([])
    setRemoteStatus('idle')
    void loadRemoteVoices()
    return () => { remoteRequestRef.current += 1 }
  }, [loadRemoteVoices])

  useEffect(() => {
    let cancelled = false
    const loadCustomVoices = async (): Promise<void> => {
      if (!voiceLibraryScope?.providerId) {
        setCustomVoices([])
        setLibraryRecords([])
        return
      }
      const records = await voiceLibraryService.listVoices({
        providerId: voiceLibraryScope.providerId,
        modelId: voiceLibraryScope.modelId,
      })
      if (cancelled) {
        return
      }
      setLibraryRecords(records)
      setLibraryError('')
      const mapped: VoiceSelectorConfig['voices'] = records.map((item) => ({
        id: item.voiceId,
        name: item.voiceName,
        description: item.description,
        tags: buildVoiceFeatureTags({
          voiceId: item.voiceId,
          voiceName: item.voiceName,
          description: item.description,
          source: 'clone',
        }),
      }))
      setCustomVoices(mapped)
    }

    const reload = (): void => { void loadCustomVoices().catch((error) => {
      if (!cancelled) {
        logger.warn('load custom voices failed', error)
        setLibraryError(error instanceof Error ? error.message : '音色库读取失败')
      }
    }) }
    reload()
    const unsubscribe = voiceLibraryService.subscribe(reload)

    return () => {
      cancelled = true
      unsubscribe()
      refreshController.current?.abort()
    }
  }, [voiceLibraryScope?.modelId, voiceLibraryScope?.providerId])

  const voices = useMemo(() => {
    const merged = new Map<string, VoiceSelectorConfig['voices'][number]>()
    for (const voice of configuredVoices) {
      merged.set(voice.id, voice)
    }
    for (const voice of remoteVoices) {
      merged.set(voice.id, voice)
    }
    for (const voice of customVoices) {
      merged.set(voice.id, voice)
    }
    return Array.from(merged.values())
  }, [configuredVoices, customVoices, remoteVoices])

  const voiceItems = useMemo((): VoiceViewItem[] => {
    return voices.map((voice) => {
      const voiceName = getI18nText(voice.name, i18n.language)
      const voiceDescription = resolveDescriptionText(voice.description, i18n.language)
      const featureTags = resolveVoiceFeatureTags(voice.tags, {
        voiceId: voice.id,
        voiceName,
        description: voiceDescription,
      })
      return {
        id: voice.id,
        name: voiceName,
        description: voiceDescription,
        isCustom: featureTags.source === 'clone',
        source: featureTags.source,
        gender: featureTags.gender,
        age: featureTags.age,
        languages: featureTags.languages,
      }
    })
  }, [i18n.language, voices])

  const languageFilterOptions = useMemo((): Array<FilterOption<VoiceLanguageFilter>> => {
    const discovered = new Set<string>()
    for (const voice of voiceItems) {
      for (const language of voice.languages) {
        discovered.add(language)
      }
    }
    const options: Array<FilterOption<VoiceLanguageFilter>> = [{ value: 'all', label: '全部语言' }]
    const sortedLanguages = Array.from(discovered).sort((left, right) => {
      const leftIndex = LANGUAGE_PRIORITY_ORDER.indexOf(left)
      const rightIndex = LANGUAGE_PRIORITY_ORDER.indexOf(right)
      const leftPriority = leftIndex >= 0 ? leftIndex : Number.MAX_SAFE_INTEGER
      const rightPriority = rightIndex >= 0 ? rightIndex : Number.MAX_SAFE_INTEGER
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority
      }
      return resolveLanguageLabel(left).localeCompare(resolveLanguageLabel(right), 'zh-Hans-CN')
    })
    for (const language of sortedLanguages) {
      options.push({ value: language, label: resolveLanguageLabel(language) })
    }
    return options
  }, [voiceItems])

  useEffect(() => {
    if (selectedLanguage === 'all') {
      return
    }
    const languageExists = languageFilterOptions.some((item) => item.value === selectedLanguage)
    if (!languageExists) {
      setSelectedLanguage('all')
    }
  }, [languageFilterOptions, selectedLanguage])

  const normalizedKeyword = keyword.trim().toLowerCase()

  const filteredVoices = useMemo((): VoiceViewItem[] => {
    return voiceItems.filter((voice) => {
      if (selectedSource !== 'all' && voice.source !== selectedSource) {
        return false
      }
      if (selectedGender !== 'all' && voice.gender !== selectedGender) {
        return false
      }
      if (selectedAge !== 'all' && voice.age !== selectedAge) {
        return false
      }
      if (selectedLanguage !== 'all' && !voice.languages.includes(selectedLanguage)) {
        return false
      }
      if (!normalizedKeyword) {
        return true
      }
      const nameMatched = voice.name.toLowerCase().includes(normalizedKeyword)
      const idMatched = voice.id.toLowerCase().includes(normalizedKeyword)
      const descriptionMatched = voice.description.toLowerCase().includes(normalizedKeyword)
      return nameMatched || idMatched || descriptionMatched
    })
  }, [normalizedKeyword, selectedAge, selectedGender, selectedLanguage, selectedSource, voiceItems])

  const handleWheelCapture = useCallback((event: React.WheelEvent<HTMLDivElement>): void => {
    event.stopPropagation()
  }, [])

  const handleDeleteCustomVoice = async (voiceId: string): Promise<void> => {
    if (!voiceLibraryScope?.providerId || deletingVoiceId) {
      return
    }
    setDeletingVoiceId(voiceId)
    try {
      await voiceLibraryService.deleteVoice(voiceId, {
        providerId: voiceLibraryScope.providerId,
        modelId: voiceLibraryScope.modelId,
      })
      setCustomVoices((prev) => prev.filter((item) => item.id !== voiceId))
      if (value === voiceId) {
        const fallback = configuredVoices[0]?.id ?? ''
        onChange(fallback)
      }
    } catch (error) {
      logger.warn('remove local voice failed', error)
      setLibraryError(error instanceof Error ? error.message : '移除音色失败')
    } finally {
      setDeletingVoiceId(null)
    }
  }

  const refreshVoice = async (record: VoiceLibraryRecord): Promise<void> => {
    if (!record.taskId || !record.modelId || refreshingVoiceId) return
    const controller = new AbortController()
    refreshController.current = controller
    setRefreshingVoiceId(record.voiceId)
    setLibraryError('')
    try {
      await GenerationService.getInstance().continuePolling(record.modelId, record.taskId, {}, undefined, { signal: controller.signal })
    } catch (error) {
      if (!controller.signal.aborted) {
        logger.warn('refresh cloned voice failed', error)
        setLibraryError(error instanceof Error ? error.message : '音色状态查询失败，请稍后重试')
      }
    } finally {
      if (refreshController.current === controller) {
        refreshController.current = null
        setRefreshingVoiceId(null)
      }
    }
  }

  const preview = libraryRecords.find(item => item.voiceId === previewVoiceId)?.previewPath

  return (
    <div
      className="flex h-[460px] w-full min-w-[520px] max-w-[720px] flex-col overflow-hidden overscroll-contain p-4"
      onWheelCapture={handleWheelCapture}
    >
      <div className="mb-3 shrink-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {SOURCE_FILTER_OPTIONS.map((option) => (
            <UiOptionButton
              key={option.value}
              type="button"
              variant="flat"
              active={selectedSource === option.value}
              className={FILTER_BUTTON_CLASS}
              onClick={() => setSelectedSource(option.value)}
            >
              {option.label}
            </UiOptionButton>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {GENDER_FILTER_OPTIONS.map((option) => (
            <UiOptionButton
              key={option.value}
              type="button"
              variant="flat"
              active={selectedGender === option.value}
              className={FILTER_BUTTON_CLASS}
              onClick={() => setSelectedGender(option.value)}
            >
              {option.label}
            </UiOptionButton>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {AGE_FILTER_OPTIONS.map((option) => (
            <UiOptionButton
              key={option.value}
              type="button"
              variant="flat"
              active={selectedAge === option.value}
              className={FILTER_BUTTON_CLASS}
              onClick={() => setSelectedAge(option.value)}
            >
              {option.label}
            </UiOptionButton>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {languageFilterOptions.map((option) => (
            <UiOptionButton
              key={option.value}
              type="button"
              variant="flat"
              active={selectedLanguage === option.value}
              className={FILTER_BUTTON_CLASS}
              onClick={() => setSelectedLanguage(option.value)}
            >
              {option.label}
            </UiOptionButton>
          ))}
        </div>
      </div>

      {config?.allowSearch !== false && (
        <div className="mb-3 flex shrink-0 items-center gap-2">
          <UiInput
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索音色名称或描述"
            className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} min-w-0 flex-1`}
          />
          {remoteModelId && (
            <UiButton type="button" variant="ghost" size="sm" disabled={remoteStatus === 'loading'} onClick={() => void loadRemoteVoices()}>
              刷新音色
            </UiButton>
          )}
        </div>
      )}

      {remoteStatus === 'loading' && <UiLoading size="xs" message="正在读取账号音色…" />}
      {remoteStatus === 'failed' && <UiError size="xs" message={remoteError} onRetry={() => void loadRemoteVoices()} />}
      {libraryError && <UiError size="xs" message={libraryError} />}
      {config?.customIdHint && voices.length === 0 && remoteStatus !== 'loading' && (
        <p className="mb-2 text-xs text-text-muted">{config.customIdHint}</p>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto overscroll-contain pr-1">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {filteredVoices.map((voice) => {
              const active = value === voice.id
              const hasDescription = voice.description.length > 0
              const record = libraryRecords.find(item => item.voiceId === voice.id)
              const canDelete = Boolean(record) && voice.isCustom && voiceLibraryScope?.allowDelete === true
              const training = record?.status === 'training'
              const failed = record?.status === 'failed'
              const expired = !record?.activated && Boolean(record?.expiresAt && Date.parse(record.expiresAt) <= Date.now())
              return (
                <div key={voice.id} className="relative">
                  <UiOptionButton
                    type="button"
                    variant="menu"
                    active={active}
                    disabled={training || failed || expired}
                    onClick={() => onChange(voice.id)}
                    onMouseEnter={() => setHoveredVoiceId(voice.id)}
                    onMouseLeave={() => setHoveredVoiceId(null)}
                    // 二维网格：静息态留一层极淡底色撑出格子形状，不再叠边框
                    className={`${active ? '' : 'bg-veil-faint'} ${
                      hasDescription
                        ? 'h-auto min-h-[58px] w-full flex-col items-start justify-center gap-1 px-3 py-2'
                        : 'h-[52px] w-full flex-col items-start justify-center px-3 py-2'
                    }`}
                  >
                    <span className="w-full truncate text-left text-sm leading-tight">{voice.name}</span>
                    {(training || failed || expired) && <span className="text-xs text-text-muted">{failed ? '训练失败或音色已失效' : expired ? '有效期已过，请刷新确认' : '等待训练结果'}</span>}
                    {hasDescription && (
                      <HoverScrollText
                        text={voice.description}
                        active={hoveredVoiceId === voice.id}
                      />
                    )}
                  </UiOptionButton>
                  {canDelete && (
                    <UiButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={deletingVoiceId === voice.id}
                      title="仅从本地列表移除，不删除供应商音色或取消计费"
                      className="absolute right-1 top-1 !h-6 !px-2 text-2xs"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void handleDeleteCustomVoice(voice.id)
                      }}
                    >
                      移除
                    </UiButton>
                  )}
                  {record && <div className="flex flex-wrap gap-1">
                    {record.previewPath && !training && <UiButton type="button" variant="ghost" size="sm" onClick={() => setPreviewVoiceId(previewVoiceId === voice.id ? null : voice.id)}>试听</UiButton>}
                    {record.taskId && <UiButton type="button" variant="ghost" size="sm" disabled={refreshingVoiceId !== null} onClick={() => void refreshVoice(record)}>
                      {refreshingVoiceId === voice.id ? '正在查询…' : training ? '查看训练结果' : '刷新状态'}
                    </UiButton>}
                    {refreshingVoiceId === voice.id && <UiButton type="button" variant="ghost" size="sm" onClick={() => refreshController.current?.abort()}>停止等待</UiButton>}
                  </div>}
                </div>
              )
            })}
          </div>

          {filteredVoices.length === 0 && (
            <UiEmpty size="xs" title="未找到匹配音色" />
          )}
        </div>
      </div>

      {preview && <div className="mt-2 shrink-0"><AudioPlayer compact surface="plain" src={toFetchableMediaUrl(preview)} filePath={isLikelyLocalImagePath(preview) ? preview : undefined} /></div>}

      {config?.allowCustomId && (
        <div className="mt-3 shrink-0">
          {customIdOpen ? (
            <div className="flex items-center gap-2">
              <UiInput
                value={customId}
                onChange={(event) => setCustomId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && customId.trim()) onChange(customId.trim())
                }}
                placeholder="输入列表中没有的音色 ID"
                className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} min-w-0 flex-1`}
              />
              <UiButton type="button" variant="primary" size="sm" disabled={!customId.trim()} onClick={() => onChange(customId.trim())}>
                使用 ID
              </UiButton>
            </div>
          ) : (
            <UiButton type="button" variant="ghost" size="sm" onClick={() => { setCustomId(value); setCustomIdOpen(true) }}>
              使用其他音色 ID
            </UiButton>
          )}
        </div>
      )}
    </div>
  )
}

export default VoiceSelectorPanel
