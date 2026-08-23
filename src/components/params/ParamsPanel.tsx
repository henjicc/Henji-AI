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
import { ParamGroupTrigger } from './ParamGroupTrigger'
import { UiEmpty } from '@/components/ui'
import { isParamDisabled, isParamVisible } from './paramVisibility'
import { buildParamPresentationItems } from '@/core/params/paramPresentation'
import type { ParamDef } from '@/core/types'
import './ParamsPanel.css'

interface ParamsPanelProps {
  modelId: string
  onChange?: (params: DynamicValueMap) => void
  className?: string
}

export interface ParamsPanelRef {
  getParams: () => DynamicValueMap
  resetParams: () => void
  setParam: (key: string, value: DynamicValue) => void
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

    const renderSchema = useMemo(() => {
      return visibleSchema.map((param): ParamDef => {
        if (param.type !== 'dropdown' && param.type !== 'radio') {
          return param
        }
        const options = getFilteredOptions(param.id)
        if (!options.length || options === param.options) {
          return param
        }
        return { ...param, options } as ParamDef
      })
    }, [getFilteredOptions, visibleSchema])
    const presentationItems = useMemo(
      () => buildParamPresentationItems(renderSchema, modelDef?.paramPresentation),
      [modelDef?.paramPresentation, renderSchema]
    )

    // 空态统一走 UiEmpty：原先是手写 div + ParamsPanel.css 里的 .params-panel-empty，
    // 那份 CSS 还硬编码了 #a1a1aa（不跟随主题）
    if (!schema || schema.length === 0) {
      return <UiEmpty size="sm" title="该模型没有可配置参数" />
    }

    return (
      <div className={`params-panel ${className || ''}`}>
        {presentationItems.map((item) => item.kind === 'param' ? (
          <ParamRenderer
            key={item.param.id}
            param={item.param}
            value={params[item.param.id]}
            onChange={(value) => setParam(item.param.id, value)}
            allValues={params}
            disabled={isParamDisabled(item.param, params, linkageEngine)}
          />
        ) : (
          <ParamGroupTrigger
            key={item.group.id}
            group={item.group}
            params={item.params}
            values={params}
            onChange={setParam}
            linkageEngine={linkageEngine}
          />
        ))}
      </div>
    )
  }
)

ParamsPanel.displayName = 'ParamsPanel'
