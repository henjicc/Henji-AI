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
import './composite/styles.css'

export interface CompositePanelProps {
  config: CompositePanelConfig
  value: Record<string, any>
  onChange: (value: Record<string, any>) => void
}

export const CompositePanel: React.FC<CompositePanelProps> = ({
  config,
  value,
  onChange
}) => {
  const { i18n } = useTranslation()

  // 处理子组件值变化
  const handleComponentChange = useCallback((componentId: string, componentValue: any) => {
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
  const renderComponent = useCallback((componentConfig: ComponentConfig) => {
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

    return (
      <div key={componentConfig.id} className="composite-panel-component">
        {componentConfig.label && (
          <label className="composite-component-label">
            {getI18nText(componentConfig.label, i18n.language)}
          </label>
        )}
        <Component
          config={componentConfig.config}
          value={value[componentConfig.id]}
          onChange={(v: any) => handleComponentChange(componentConfig.id, v)}
          disabled={isDisabled}
        />
      </div>
    )
  }, [value, i18n.language, handleComponentChange])

  // 布局样式
  const layoutStyle = useMemo(() => {
    if (config.layout === 'grid') {
      return {
        display: 'grid',
        gridTemplateColumns: `repeat(${config.gridColumns || 2}, 1fr)`,
        gap: `${config.gap || 16}px`
      }
    }
    return {
      display: 'flex',
      flexDirection: config.layout === 'vertical' ? 'column' as const : 'row' as const,
      gap: `${config.gap || 16}px`
    }
  }, [config.layout, config.gap, config.gridColumns])

  return (
    <div className="composite-panel" style={layoutStyle}>
      {config.components.map(renderComponent)}
    </div>
  )
}

