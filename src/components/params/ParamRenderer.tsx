import { createLogger } from '@/core/logging'

const logger = createLogger('components.params.ParamRenderer')
/**
 * ParamRenderer - 参数自动渲染器
 *
 * 根据参数定义自动选择和渲染对应的 UI 组件
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatAspectRatioDisplayLabel } from '@/core/params/ratioResolution'
import type { ParamDef, CompositePanelDef } from '@/core/types/ParamDef'
import { panelRegistry } from '@/core/panels/PanelRegistry'
import { getI18nText, type I18nText } from '@/core/types/I18nText'
import type { CompositePanelConfig } from '@/core/types/CompositePanel'
import { isParamDisabled, isParamVisible } from './paramVisibility'

// 导入真实的新系统组件
import { TextInput } from './base/TextInput'
import { NumberInput } from './base/NumberInput'
import { DropdownInput } from './base/DropdownInput'
import { SwitchInput } from './base/SwitchInput'
import { RadioInput } from './base/RadioInput'
import { ImageUpload } from './upload/ImageUpload'
import { VideoUpload } from './upload/VideoUpload'

// 导入特殊面板
import { CompositePanel } from './panels/CompositePanel'

// 导入 UI 组件
import PanelTrigger from '@/components/ui/PanelTrigger'
import Tooltip from '@/components/ui/Tooltip'
import { voiceLibraryService } from '@/services/voiceLibrary/VoiceLibraryService'

/**
 * 格式化面板显示值
 * 用于 PanelTrigger 的 display 属性
 */
function resolvePanelWidth(config: unknown, fallbackWidth: number): number {
  if (!config || typeof config !== 'object') {
    return fallbackWidth
  }
  const record = config as Record<string, unknown>
  const width = typeof record.panelWidth === 'number' ? record.panelWidth : record.width
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
    return width
  }
  return fallbackWidth
}

function formatPanelDisplayValue(
  value: unknown,
  panel: string,
  language: string,
  config?: unknown
): string {
  if (value === undefined || value === null || value === '') return '未设置'

  // ResolutionPanel 的显示逻辑
  if (panel === 'resolution') {
    const record = typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null
    if (!record) {
      return '未设置'
    }
    const quality = typeof record.quality === 'string' ? record.quality : ''
    const joinQuality = (label: string): string => quality ? `${label} / ${quality}` : label
    if (record.aspectRatio === 'smart') return joinQuality('智能')
    if (record.aspectRatio) {
      return joinQuality(formatAspectRatioDisplayLabel(String(record.aspectRatio), String(record.aspectRatio)))
    }
    if (typeof record.preset === 'string') return joinQuality(record.preset)
    if (typeof record.width === 'number' && typeof record.height === 'number') {
      return `${record.width}×${record.height}`
    }
  }

  if (panel === 'modelscope-custom-model') {
    if (typeof value !== 'string') return '未设置'
    const trimmed = value.trim()
    if (!trimmed) return '未设置'

    try {
      const stored = localStorage.getItem('modelscope_custom_models')
      if (!stored) return trimmed
      const parsed = JSON.parse(stored) as unknown
      if (!Array.isArray(parsed)) return trimmed
      const match = parsed.find((item) => {
        if (!item || typeof item !== 'object') return false
        const record = item as Record<string, unknown>
        return record.id === trimmed
      }) as Record<string, unknown> | undefined
      if (!match) return trimmed
      const name = typeof match.name === 'string' ? match.name.trim() : ''
      return name || trimmed
    } catch {
      return trimmed
    }
  }

  if (panel === 'voice-selector' && typeof value === 'string') {
    const configRecord = config && typeof config === 'object'
      ? (config as Record<string, unknown>)
      : null
    const voices = configRecord?.voices
    if (Array.isArray(voices)) {
      const matched = voices.find((item) => {
        if (!item || typeof item !== 'object') {
          return false
        }
        const voice = item as Record<string, unknown>
        return voice.id === value
      })
      if (matched && typeof matched === 'object') {
        const matchedRecord = matched as Record<string, unknown>
        const name = matchedRecord.name
        if (typeof name === 'string' || (name && typeof name === 'object')) {
          return getI18nText(name as I18nText, language)
        }
      }
    }
    const voiceLibrary = configRecord?.voiceLibrary
    if (voiceLibrary && typeof voiceLibrary === 'object') {
      const libraryRecord = voiceLibrary as Record<string, unknown>
      const providerId = typeof libraryRecord.providerId === 'string' ? libraryRecord.providerId : undefined
      const modelId = typeof libraryRecord.modelId === 'string' ? libraryRecord.modelId : undefined
      const cachedName = voiceLibraryService.getCachedVoiceName(value, { providerId, modelId })
      if (cachedName) {
        return cachedName
      }
    }
    return value
  }

  if (panel === 'minimax-voice-clone') {
    return '点击设置'
  }

  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? `${value.length}项` : '未设置'
  }
  if (typeof value === 'object') {
    if (panel === 'composite' || panel === 'minimax-voice-clone') {
      return '点击设置'
    }
    return '已配置'
  }

  // 默认显示
  return String(value)
}

function isCompositePanelConfig(value: unknown): value is CompositePanelConfig {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.components)
}

// 组件映射表
const COMPONENT_MAP: Partial<Record<string, React.ComponentType<any>>> = {
  text: TextInput,
  textarea: TextInput,
  number: NumberInput,
  dropdown: DropdownInput,
  switch: SwitchInput,
  radio: RadioInput,
  'image-upload': ImageUpload,
  'video-upload': VideoUpload,
  composite: CompositePanel,
}

interface ParamRendererProps {
  param: ParamDef
  value: unknown
  onChange: (value: unknown) => void
  allValues: Record<string, unknown>
  uploadedImages?: string[]
  uploadedVideos?: string[]
  disabled?: boolean
}

/**
 * ParamRenderer 组件
 *
 * 根据参数定义自动渲染对应的 UI 组件
 */
export const ParamRenderer: React.FC<ParamRendererProps> = React.memo(({
  param,
  value,
  onChange,
  allValues,
  uploadedImages = [],
  uploadedVideos = [],
  disabled: externalDisabled = false
}) => {
  const { i18n } = useTranslation()

  const visible = useMemo(
    () => isParamVisible(param, allValues, null),
    [allValues, param]
  )
  const disabled = useMemo(
    () => externalDisabled || isParamDisabled(param, allValues, null),
    [allValues, externalDisabled, param]
  )

  // 如果不可见，返回 null
  if (!visible) {
    return null
  }

  // 处理 composite 类型（特殊面板）
  if (param.type === 'composite') {
    const compositeParam = param as CompositePanelDef

    // 如果指定了 panel 字段，使用 PanelRegistry 获取对应的面板组件
    if (compositeParam.panel) {
      const PanelComponent = panelRegistry.get(compositeParam.panel as any)

      if (PanelComponent) {
        const defaultPanelWidth = (() => {
          if (compositeParam.panel === 'modelscope-custom-model') {
            return 520
          }
          if (compositeParam.panel === 'resolution') {
            return 400
          }
          return 320
        })()
        const panelWidth = resolvePanelWidth(compositeParam.config, defaultPanelWidth)
        // 使用 PanelTrigger 包装特殊面板，实现点击展开功能
        const panelContent = (
          <PanelTrigger
            label={getI18nText(param.name, i18n.language) || param.id}
            display={formatPanelDisplayValue(value, compositeParam.panel, i18n.language, compositeParam.config)}
            className="w-auto min-w-[100px]"
            panelWidth={panelWidth}
            alignment="aboveCenter"
            closeOnPanelClick={false}
            freezePositionOnOpen={compositeParam.panel === 'voice-selector'}
            renderPanel={() => (
              <PanelComponent
                value={value}
                onChange={onChange}
                config={compositeParam.config}
              />
            )}
          />
        )

        // 如果有 tooltip，包装 Tooltip
        if (param.tooltip) {
          return (
            <Tooltip
              content={getI18nText(param.tooltip, i18n.language)}
              delay={500}
            >
              {panelContent}
            </Tooltip>
          )
        }

        return panelContent
      } else {
        logger.warn(`Panel "${compositeParam.panel}" not found in registry`)
      }
    }

    // 如果没有指定 panel 或找不到，使用默认的 CompositePanel
    if (!isCompositePanelConfig(compositeParam.config)) {
      return (
        <div className="param-renderer-error" data-param-id={param.id}>
          <span>Invalid composite panel config: {param.id}</span>
        </div>
      )
    }

    const compositeValue =
      value && typeof value === 'object' ? (value as Record<string, any>) : {}

    const compositePanel = (
      <CompositePanel
        config={compositeParam.config}
        value={compositeValue}
        onChange={(nextValue) => onChange(nextValue)}
      />
    )

    if (param.tooltip) {
      return (
        <Tooltip
          content={getI18nText(param.tooltip, i18n.language)}
          delay={500}
        >
          {compositePanel}
        </Tooltip>
      )
    }

    return compositePanel
  }

  // 获取组件
  const Component = COMPONENT_MAP[param.type as keyof typeof COMPONENT_MAP]

  if (!Component) {
    return (
      <div className="param-renderer-error" data-param-id={param.id}>
        <span>Unknown component type: {param.type}</span>
      </div>
    )
  }

  // 渲染普通组件（传递 param 对象）
  const renderedComponent = (
    <Component
      param={param}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  )

  // 如果有 tooltip，包装 Tooltip
  if (param.tooltip) {
    return (
      <Tooltip
        content={getI18nText(param.tooltip, i18n.language)}
        delay={500}
      >
        {renderedComponent}
      </Tooltip>
    )
  }

  return renderedComponent
})

ParamRenderer.displayName = 'ParamRenderer'

