import { createLogger } from '@/core/logging'

const logger = createLogger('components.params.ParamRenderer')
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
import type { CompositePanelConfig } from '@/core/types/CompositePanel'
import { isParamDisabled, isParamVisible } from './paramVisibility'
import { formatPanelDisplayValue, resolvePanelWidth } from './panelDisplay'

// 导入真实的新系统组件
import { TextInput } from './base/TextInput'
import { NumberInput } from './base/NumberInput'
import { DropdownInput } from './base/DropdownInput'
import { SwitchInput } from './base/SwitchInput'
import { RadioInput } from './base/RadioInput'
import { ImageUpload } from './upload/ImageUpload'
import { VideoUpload } from './upload/VideoUpload'
import { FileUpload } from './upload/FileUpload'

// 导入特殊面板
import { CompositePanel } from './panels/CompositePanel'

// 导入 UI 组件
import PanelTrigger from '@/components/ui/PanelTrigger'
import Tooltip from '@/components/ui/Tooltip'

function isCompositePanelConfig(value: DynamicValue): value is CompositePanelConfig {
  if (!value || typeof value !== 'object') return false
  const record = value as DynamicValueMap
  return Array.isArray(record.components)
}

// 组件映射表
const COMPONENT_MAP: Partial<Record<string, React.ComponentType<DynamicValue>>> = {
  text: TextInput,
  textarea: TextInput,
  number: NumberInput,
  dropdown: DropdownInput,
  switch: SwitchInput,
  radio: RadioInput,
  'image-upload': ImageUpload,
  'video-upload': VideoUpload,
  'file-upload': FileUpload,
  composite: CompositePanel,
}

interface ParamRendererProps {
  param: ParamDef
  value: DynamicValue
  onChange: (value: DynamicValue) => void
  allValues: DynamicValueMap
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
      const PanelComponent = panelRegistry.get(compositeParam.panel as DynamicValue)

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
      value && typeof value === 'object' ? (value as DynamicValueMap) : {}

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
