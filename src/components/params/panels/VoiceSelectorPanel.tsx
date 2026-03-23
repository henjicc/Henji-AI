import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UiInput, UiOptionButton } from '@/components/ui'
import { getI18nText, type I18nText } from '@/core/types'
import type { VoiceSelectorConfig } from '@/core/types/PanelTypes'

type VoiceGroup = 'all' | 'male' | 'female' | 'child' | 'other'

interface VoiceSelectorPanelProps {
  value: string
  onChange: (value: string) => void
  config?: VoiceSelectorConfig
}

interface VoiceGroupOption {
  value: VoiceGroup
  label: string
}

interface VoiceViewItem {
  id: string
  name: string
  description: string
}

interface HoverScrollTextProps {
  text: string
  active: boolean
}

const DEFAULT_GROUPS: VoiceGroupOption[] = [
  { value: 'all', label: '全部' },
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'child', label: '童声' },
  { value: 'other', label: '其他' },
]

function normalizeGroup(raw: string | undefined): VoiceGroup {
  if (!raw) {
    return 'other'
  }
  const lowered = raw.trim().toLowerCase()
  if (lowered === 'male' || lowered === 'female' || lowered === 'child' || lowered === 'other') {
    return lowered
  }
  return 'other'
}

function resolveDescriptionText(description: unknown, language: string): string {
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
      className="w-full overflow-hidden whitespace-nowrap text-left text-[11px] leading-tight text-text-muted"
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
  const [selectedGroup, setSelectedGroup] = useState<VoiceGroup>('all')
  const [keyword, setKeyword] = useState('')
  const [hoveredVoiceId, setHoveredVoiceId] = useState<string | null>(null)
  const voices = config?.voices ?? []

  const availableGroups = useMemo(() => {
    const discovered = new Set<VoiceGroup>()
    for (const voice of voices) {
      const firstTag = Array.isArray(voice.tags) ? voice.tags.find((item) => typeof item === 'string') : undefined
      if (!firstTag) {
        continue
      }
      discovered.add(normalizeGroup(firstTag))
    }
    if (discovered.size === 0) {
      return []
    }
    return DEFAULT_GROUPS.filter((group) => group.value === 'all' || discovered.has(group.value))
  }, [voices])

  const normalizedKeyword = keyword.trim().toLowerCase()

  const filteredVoices = useMemo((): VoiceViewItem[] => {
    return voices.flatMap((voice) => {
      const voiceName = getI18nText(voice.name, i18n.language)
      const voiceDescription = resolveDescriptionText(voice.description, i18n.language)
      const firstTag = Array.isArray(voice.tags) ? voice.tags.find((item) => typeof item === 'string') : undefined
      const group = normalizeGroup(firstTag)
      const matchesGroup = selectedGroup === 'all' || group === selectedGroup
      if (!matchesGroup) {
        return []
      }
      if (!normalizedKeyword) {
        return [{ id: voice.id, name: voiceName, description: voiceDescription }]
      }
      const nameMatched = voiceName.toLowerCase().includes(normalizedKeyword)
      const descriptionMatched = voiceDescription.toLowerCase().includes(normalizedKeyword)
      if (!nameMatched && !descriptionMatched) {
        return []
      }
      return [{ id: voice.id, name: voiceName, description: voiceDescription }]
    })
  }, [i18n.language, normalizedKeyword, selectedGroup, voices])

  return (
    <div className="h-full min-h-[300px] max-h-[420px] w-full min-w-[520px] max-w-[720px] p-4">
      {availableGroups.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {availableGroups.map((group) => (
            <UiOptionButton
              key={group.value}
              type="button"
              variant="flat"
              active={selectedGroup === group.value}
              className="!h-8 !px-3 !py-1 text-xs"
              onClick={() => setSelectedGroup(group.value)}
            >
              {group.label}
            </UiOptionButton>
          ))}
        </div>
      )}

      {config?.allowSearch !== false && (
        <div className="mb-3">
          <UiInput
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索音色名称或描述"
            className="h-[38px] w-full"
          />
        </div>
      )}

      <div className="max-h-[290px] overflow-y-auto">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {filteredVoices.map((voice) => {
            const active = value === voice.id
            const hasDescription = voice.description.length > 0
            return (
              <UiOptionButton
                key={voice.id}
                type="button"
                variant="card"
                active={active}
                onClick={() => onChange(voice.id)}
                onMouseEnter={() => setHoveredVoiceId(voice.id)}
                onMouseLeave={() => setHoveredVoiceId(null)}
                className={
                  hasDescription
                    ? 'h-auto min-h-[58px] w-full flex-col items-start justify-center gap-1 px-3 py-2'
                    : 'h-[52px] w-full flex-col items-start justify-center px-3 py-2'
                }
              >
                <span className="w-full truncate text-left text-sm leading-tight">{voice.name}</span>
                {hasDescription && (
                  <HoverScrollText
                    text={voice.description}
                    active={hoveredVoiceId === voice.id}
                  />
                )}
              </UiOptionButton>
            )
          })}
        </div>

        {filteredVoices.length === 0 && (
          <div className="py-6 text-center text-xs text-text-muted">
            未找到匹配音色
          </div>
        )}
      </div>
    </div>
  )
}

export default VoiceSelectorPanel
