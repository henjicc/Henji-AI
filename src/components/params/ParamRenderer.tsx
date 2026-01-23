/**
 * ParamRenderer - 参数自动渲染器
 *
 * 根据参数定义自动选择和渲染对应的 UI 组件
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParamDef, CompositePanelDef } from '@/core/types/ParamDef'
import { panelRegistry } from '@/core/panels/PanelRegistry'
import { getI18nText } from '@/core/types/I18nText'

// 导入真实的新系统组件
import { TextInput } from './base/TextInput'
import { NumberInput } from './base/NumberInput'
import { SliderInput } from './base/SliderInput'
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
      return `${value.aspectRatio}${quality}`
    }
    if (value.preset) return value.preset
    if (value.width && value.height) return `${value.width}×${value.height}`
  }

  // 默认显示
  return JSON.stringify(value)
}

// 组件映射表
const COMPONENT_MAP = {
  text: TextInput,
  number: NumberInput,
  slider: SliderInput,
  dropdown: DropdownInput,
  switch: SwitchInput,
  radio: RadioInput,
  'image-upload': ImageUpload,
  'video-upload': VideoUpload,
  composite: CompositePanel,
  // 其他特殊组件将在需要时添加
  resolution: null,
  'aspect-ratio': null,
  panel: null,
} as const

interface ParamRendererProps {
  param: ParamDef
  value: any
  onChange: (value: any) => void
  allValues: Record<string, any>
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
        // 使用 PanelTrigger 包装特殊面板，实现点击展开功能
        const panelContent = (
          <PanelTrigger
            label={param.name?.zh || param.name?.en || param.id}
            display={formatPanelDisplayValue(value, compositeParam.panel)}
            className="w-auto min-w-[100px]"
            panelWidth={320}
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
    return (
      <CompositePanel
        config={compositeParam.config}
        value={value || {}}
        onChange={onChange}
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
      param={param as any}
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
