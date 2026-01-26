/**
 * ParamsPanel - 参数面板容器组件
 *
 * 自动渲染模型的所有参数
 */

import React, { forwardRef, useImperativeHandle, useMemo, useEffect } from 'react'
import { useModelParams } from '@/hooks/useModelParams'
import { ParamRenderer } from './ParamRenderer'
import './ParamsPanel.css'

interface ParamsPanelProps {
  modelId: string
  onChange?: (params: Record<string, any>) => void
  className?: string
}

export interface ParamsPanelRef {
  getParams: () => Record<string, any>
  resetParams: () => void
  setParam: (key: string, value: any) => void
}

/**
 * ParamsPanel 组件
 *
 * 根据 modelId 自动加载参数 schema 并渲染所有参数
 */
export const ParamsPanel = forwardRef<ParamsPanelRef, ParamsPanelProps>(
  ({ modelId, onChange, className }, ref) => {
    // 使用 useModelParams 管理状态
    const {
      params,
      setParam,
      resetParams,
      getFilteredOptions,
      schema
    } = useModelParams(modelId)

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      getParams: () => params,
      resetParams,
      setParam
    }), [params, resetParams, setParam])

    // 参数变化时通知父组件
    useEffect(() => {
      onChange?.(params)
    }, [params, onChange])

    // 排序参数
    const sortedSchema = useMemo(() => {
      return [...schema].sort((a, b) => {
        const orderA = a.order ?? Number.MAX_SAFE_INTEGER
        const orderB = b.order ?? Number.MAX_SAFE_INTEGER
        return orderA - orderB
      })
    }, [schema])

    // 加载状态
    if (!schema || schema.length === 0) {
      return (
        <div className="params-panel-empty">
          该模型没有可配置参数
        </div>
      )
    }

    return (
      <div className={`params-panel ${className || ''}`}>
        {sortedSchema.map(paramDef => (
          <ParamRenderer
            key={paramDef.id}
            param={paramDef}
            value={params[paramDef.id]}
            onChange={(value) => setParam(paramDef.id, value)}
            allValues={params}
          />
        ))}
      </div>
    )
  }
)

ParamsPanel.displayName = 'ParamsPanel'
