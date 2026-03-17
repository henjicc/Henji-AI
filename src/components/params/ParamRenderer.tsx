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
import { getI18nText } from '@/core/types/I18nText'
import type { CompositePanelConfig } from '@/core/types/CompositePanel'

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

/**
 * 格式化面板显示值
 * 用于 PanelTrigger 的 display 属性
 */
function formatPanelDisplayValue(value: any, panel: string): string {
  if (!value) return '未设置'

  // ResolutionPanel 的显示逻辑
  if (panel === 'resolution') {
    if (value.aspectRatio === 'smart') return '智能'
    if (value.aspectRatio) {
      const quality = value.quality ? ` (${value.quality})` : ''
      return `${formatAspectRatioDisplayLabel(String(value.aspectRatio), value.aspectRatio)}${quality}`
    }
    if (value.preset) return value.preset
    if (value.width && value.height) return `${value.width}×${value.height}`
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

  // 默认显示
  return JSON.stringify(value)
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

  // 检查是否应该显示（基于 linkages 中的 Hide 效果）
  const isVisible = useMemo(() => {
    // 这里可以添加基于 linkages 的可见性逻辑
    // 暂时默认显示
    return true
  }, [param, allValues])

  // 如果不可见，返回 null
  if (!isVisible) {
    return null
  }

  // 处理 composite 类型（特殊面板）
  if (param.type === 'composite') {
    const compositeParam = param as CompositePanelDef

    // 如果指定了 panel 字段，使用 PanelRegistry 获取对应的面板组件
    if (compositeParam.panel) {
      const PanelComponent = panelRegistry.get(compositeParam.panel as any)

      if (PanelComponent) {
        const panelWidth = compositeParam.panel === 'modelscope-custom-model' ? 520 : 320
        // 使用 PanelTrigger 包装特殊面板，实现点击展开功能
        const panelContent = (
          <PanelTrigger
            label={getI18nText(param.name, i18n.language) || param.id}
            display={formatPanelDisplayValue(value, compositeParam.panel)}
            className="w-auto min-w-[100px]"
            panelWidth={panelWidth}
            alignment="aboveCenter"
            closeOnPanelClick={false}
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
        console.warn(`Panel "${compositeParam.panel}" not found in registry`)
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

    return (
      <CompositePanel
        config={compositeParam.config}
        value={compositeValue}
        onChange={(nextValue) => onChange(nextValue)}
      />
    )
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
      disabled={externalDisabled}
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
