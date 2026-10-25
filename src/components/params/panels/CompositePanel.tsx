import { createLogger } from '@/core/logging'

const logger = createLogger('components.params.panels.CompositePanel')
/**
 * CompositePanel - 通用可组合面板容器
 *
 * 支持通过配置组合多个子组件，实现灵活的面板布局和组件联动
 */

import React, { useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { componentRegistry } from './composite/ComponentRegistry'
import type { CompositePanelConfig, ComponentConfig } from '@/core/types/CompositePanel'
import { getI18nText } from '@/core/types'
import { UiSpecialPanel } from '@/components/ui'

/** 单行控件：标签放在左边，两列表单（重要记录 021）；比例、档位这类大块子组件仍是标签在上、占满一格 */
const INLINE_COMPONENT_TYPES = new Set(['number-input', 'dropdown', 'switch', 'text-input'])

export interface CompositePanelProps {
  config: CompositePanelConfig
  value: DynamicValueMap
  onChange: (value: DynamicValueMap) => void
  /** 放在特殊面板里时外壳已经留白，组合面板自己不再加 */
  framed?: boolean
}

export const CompositePanel: React.FC<CompositePanelProps> = ({
  config,
  value,
  onChange,
  framed = false
}) => {
  const { i18n } = useTranslation()

  // 处理子组件值变化
  const handleComponentChange = useCallback((componentId: string, componentValue: DynamicValue) => {
    const newValue = { ...value, [componentId]: componentValue }

    // 执行联动
    if (config.linkages) {
      for (const linkage of config.linkages) {
        if (linkage.source === componentId) {
          const targetComponent = config.components.find(c => c.id === linkage.target)
          if (targetComponent) {
            try {
              const updatedValue = linkage.handler(
                componentValue,
                targetComponent.config,
                newValue
              )
              newValue[linkage.target] = updatedValue
            } catch (error) {
              if (import.meta.env.DEV) {
                logger.error(`Linkage error: ${linkage.source} -> ${linkage.target}`, error)
              }
            }
          }
        }
      }
    }

    onChange(newValue)
  }, [value, config.linkages, config.components, onChange])

  // 渲染子组件
  const renderComponent = useCallback((componentConfig: ComponentConfig, column = 0) => {
    // 检查显示条件
    if (componentConfig.showWhen && !componentConfig.showWhen(value)) {
      return null
    }

    // 检查禁用条件
    const isDisabled = componentConfig.disabledWhen
      ? componentConfig.disabledWhen(value)
      : false

    const Component = componentRegistry.get(componentConfig.type)
    if (!Component) {
      if (import.meta.env.DEV) {
        logger.warn(`Unknown component type: ${componentConfig.type}`)
      }
      return null
    }

    const label = componentConfig.label ? getI18nText(componentConfig.label, i18n.language) : ''
    const control = (
      <Component
        config={componentConfig.config}
        value={value[componentConfig.id]}
        onChange={(v: DynamicValue) => handleComponentChange(componentConfig.id, v)}
        disabled={isDisabled}
      />
    )
    if (INLINE_COMPONENT_TYPES.has(componentConfig.type)) {
      // 网格排布时标签与控件各占一格，标签列按这一列最长的标签定宽
      return (
        <React.Fragment key={componentConfig.id}>
          <label className={`whitespace-nowrap text-xs text-text2 ${column > 0 ? 'ml-4' : ''}`}>{label}</label>
          <div className="w-36 min-w-0">{control}</div>
        </React.Fragment>
      )
    }
    return (
      <div key={componentConfig.id} className="col-span-full flex flex-col gap-2">
        {label && <label className="text-xs font-medium text-text2">{label}</label>}
        {control}
      </div>
    )
  }, [value, i18n.language, handleComponentChange])

  // 布局样式
  const gridColumns = config.layout === 'grid' ? (config.gridColumns || 2) : config.layout === 'vertical' ? 1 : config.components.length

  const layoutStyle = useMemo(() => {
    const padding = framed ? 0 : (config.padding ?? 16)
    // 标签在左的表单：每对“标签 | 控件”占两格，标签列按内容宽；多列时一行跨度仍在 720 以内
    const columns = gridColumns
    return {
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, max-content max-content)`,
      columnGap: 8,
      rowGap: 8,
      alignItems: 'center',
      padding: `${padding}px`,
    }
  }, [gridColumns, config.padding, framed])

  return (
    <div style={layoutStyle}>
      {(() => {
        let pair = 0
        return config.components.map((componentConfig) => {
          if (componentConfig.showWhen && !componentConfig.showWhen(value)) return null
          const inline = INLINE_COMPONENT_TYPES.has(componentConfig.type)
          const node = renderComponent(componentConfig, inline ? pair % gridColumns : 0)
          pair = inline ? pair + 1 : 0
          return node
        })
      })()}
    </div>
  )
}

/** 组合面板作为特殊面板浮层打开时的外壳（注册为 `composite`）；内嵌在参数区时直接用 CompositePanel。 */
export const CompositeSpecialPanel: React.FC<CompositePanelProps> = (props) => (
  <UiSpecialPanel>
    <CompositePanel {...props} framed />
  </UiSpecialPanel>
)
