/**
 * ParamsPanel - 参数面板容器组件
 *
 * 自动渲染模型的所有参数
 */

import React, { forwardRef, useImperativeHandle, useMemo, useEffect } from 'react'
import { registry } from '@/core/ModelRegistry'
import { LinkageEngine } from '@/core/linkage'
import { useModelParams } from '@/hooks/useModelParams'
import { ParamRenderer } from './ParamRenderer'
import { isParamDisabled, isParamVisible } from './paramVisibility'
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

    const modelDef = useMemo(() => registry.getModel(modelId), [modelId])
    const linkageEngine = useMemo(() => {
      if (!modelDef?.linkages?.length) {
        return null
      }
      return new LinkageEngine(modelDef.linkages)
    }, [modelDef])

    const visibleSchema = useMemo(
      () => sortedSchema.filter((param) => isParamVisible(param, params, linkageEngine)),
      [linkageEngine, params, sortedSchema]
    )

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
        {visibleSchema.map(paramDef => (
          <ParamRenderer
            key={paramDef.id}
            param={paramDef}
            value={params[paramDef.id]}
            onChange={(value) => setParam(paramDef.id, value)}
            allValues={params}
            disabled={isParamDisabled(paramDef, params, linkageEngine)}
          />
        ))}
      </div>
    )
  }
)

ParamsPanel.displayName = 'ParamsPanel'
