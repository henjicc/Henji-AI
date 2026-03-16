/**
 * ParameterPanel - 新架构参数面板
 *
 * 基于 ModelRegistry 和 ParamRenderer 的全新实现
 * 完全消除硬编码，支持所有 41 个模型
 */

import React, { useMemo } from 'react'
import { registry } from '@/core/ModelRegistry'
import { getI18nText, type ParamDef } from '@/core/types'
import { ParamRenderer } from '@/components/params/ParamRenderer'
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import AspectResolutionPanel from './AspectResolutionPanel'

interface ParameterPanelProps {
  currentModel: any
  selectedModel: string
  uploadedImages: string[]
  values: Record<string, any>
  onChange: (id: string, value: any) => void
}

const DURATION_PARAM_HINT = /(duration|video[_\s-]?length|时长|秒)/i

function isDurationParam(param: ParamDef): boolean {
  const searchText = [
    param.id,
    param.apiField,
    String(getI18nText(param.name, 'zh') || ''),
    String(getI18nText(param.name, 'en') || ''),
  ]
    .filter(Boolean)
    .join(' ')
  return DURATION_PARAM_HINT.test(searchText)
}

/**
 * 参数配置面板
 * 根据当前选择的模型从 ModelRegistry 获取参数定义并自动渲染
 *
 * 注意：对于还未迁移到 ModelRegistry 的旧模型，此组件会返回 null
 * 保持向后兼容性，不显示错误消息
 */
const ParameterPanel: React.FC<ParameterPanelProps> = ({
  selectedModel,
  uploadedImages,
  values,
  onChange
}) => {
  // 从 ModelRegistry 获取模型定义
  const modelDef = registry.getModel(selectedModel)

  // 模型未在 ModelRegistry 中注册（可能是旧模型）- 静默返回 null
  if (!modelDef) {
    return null
  }

  // 获取参数定义（按 order 排序，便于统一处理）
  const params = useMemo(() => {
    return [...registry.getSchema(selectedModel)].sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER
      return orderA - orderB
    })
  }, [selectedModel])

  // 没有可配置参数 - 静默返回 null
  if (params.length === 0) {
    return null
  }

  const specialPanelSpec = useMemo(() => {
    if (modelDef.meta.provider === 'modelscope') {
      return null
    }
    return analyzeRatioResolutionParams(params, uploadedImages)
  }, [modelDef.meta.provider, params, uploadedImages])

  const consumedParamIds = new Set(specialPanelSpec?.consumedParamIds || [])
  const renderParams = params.filter((param) => !consumedParamIds.has(param.id))
  const orderedRenderParams = useMemo(() => {
    if (!specialPanelSpec) {
      return renderParams
    }
    const durationParams = renderParams.filter(isDurationParam)
    const normalParams = renderParams.filter((param) => !isDurationParam(param))
    return [...durationParams, ...normalParams]
  }, [renderParams, specialPanelSpec])

  // 渲染参数（分辨率/比例特殊面板始终置顶）
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      {specialPanelSpec && (
        <AspectResolutionPanel
          aspectParam={specialPanelSpec.aspectParam}
          resolutionParam={specialPanelSpec.resolutionParam}
          values={values}
          uploadedImages={uploadedImages}
          onChange={onChange}
        />
      )}
      {orderedRenderParams.map((param) => (
        <ParamRenderer
          key={param.id}
          param={param}
          value={values[param.id]}
          onChange={(value) => onChange(param.id, value)}
          allValues={values}
          uploadedImages={uploadedImages}
        />
      ))}
    </div>
  )
}

export default ParameterPanel
