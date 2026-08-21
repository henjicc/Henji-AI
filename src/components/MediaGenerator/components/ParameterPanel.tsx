/**
 * ParameterPanel - 新架构参数面板
 *
 * 基于 ModelRegistry 和 ParamRenderer 的全新实现
 * 完全消除硬编码，支持所有 41 个模型
 */

import React, { useMemo } from 'react'
import { registry } from '@/core/ModelRegistry'
import { getI18nText, type ParamDef } from '@/core/types'
import { LinkageEngine } from '@/core/linkage'
import { ParamRenderer } from '@/components/params/ParamRenderer'
import { isParamDisabled, isParamVisible } from '@/components/params/paramVisibility'
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import AspectResolutionPanel from './AspectResolutionPanel'
import { isPrimarySelectorParam } from './parameterOrder'

interface ParameterPanelProps {
  currentModel: DynamicValue
  selectedModel: string
  uploadedImages: string[]
  uploadedVideos: string[]
  values: DynamicValueMap
  onChange: (id: string, value: DynamicValue) => void
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
  uploadedVideos,
  values,
  onChange
}) => {
  // 从 ModelRegistry 获取模型定义
  const modelDef = registry.getModel(selectedModel)

  // 获取参数定义（按 order 排序，便于统一处理）
  const params = useMemo(() => {
    if (!modelDef) {
      return []
    }
    return [...registry.getSchema(selectedModel)].sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER
      return orderA - orderB
    })
  }, [modelDef, selectedModel])

  const linkageEngine = useMemo(() => {
    if (!modelDef?.linkages || modelDef.linkages.length === 0) {
      return null
    }
    return new LinkageEngine(modelDef.linkages)
  }, [modelDef?.linkages])

  const runtimeValues = useMemo(
    () => ({
      ...values,
      uploadedImages,
      uploadedVideos,
    }),
    [uploadedImages, uploadedVideos, values]
  )

  const visibleParams = useMemo(
    () => params.filter((param) => isParamVisible(param, runtimeValues, linkageEngine)),
    [linkageEngine, params, runtimeValues]
  )

  const filteredParams = useMemo(() => {
    if (!linkageEngine) {
      return visibleParams
    }
    return visibleParams.map((param): ParamDef => {
      if (param.type !== 'dropdown' && param.type !== 'radio') {
        return param
      }
      const options = linkageEngine.getFilteredOptions(param.id, runtimeValues, params)
      if (!options.length || options === param.options) {
        return param
      }
      return { ...param, options } as ParamDef
    })
  }, [linkageEngine, params, runtimeValues, visibleParams])

  const specialPanelSpec = useMemo(() => {
    if (!modelDef || modelDef.meta.provider === 'modelscope') {
      return null
    }
    return analyzeRatioResolutionParams(filteredParams, uploadedImages)
  }, [modelDef, filteredParams, uploadedImages])

  const consumedParamIds = new Set(specialPanelSpec?.consumedParamIds || [])
  const renderParams = filteredParams.filter((param) => !consumedParamIds.has(param.id))
  const primarySelectorParams = useMemo(
    () => renderParams.filter(isPrimarySelectorParam),
    [renderParams]
  )
  const remainingParams = useMemo(
    () => renderParams.filter((param) => !isPrimarySelectorParam(param)),
    [renderParams]
  )
  const orderedRenderParams = useMemo(() => {
    if (!specialPanelSpec) {
      return remainingParams
    }
    const durationParams = remainingParams.filter(isDurationParam)
    const normalParams = remainingParams.filter((param) => !isDurationParam(param))
    return [...durationParams, ...normalParams]
  }, [remainingParams, specialPanelSpec])

  // 模型未在 ModelRegistry 中注册（可能是旧模型）或没有参数 - 静默返回 null
  if (!modelDef || params.length === 0) {
    return null
  }

  // 渲染参数：模式/版本/变体选择始终跟在模型选择器后，分辨率/比例面板保持其余参数前置
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      {primarySelectorParams.map((param) => (
        <ParamRenderer
          key={param.id}
          param={param}
          value={values[param.id]}
          onChange={(value) => onChange(param.id, value)}
          allValues={runtimeValues}
          uploadedImages={uploadedImages}
          uploadedVideos={uploadedVideos}
          disabled={isParamDisabled(param, runtimeValues, linkageEngine)}
        />
      ))}
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
          allValues={runtimeValues}
          uploadedImages={uploadedImages}
          uploadedVideos={uploadedVideos}
          disabled={isParamDisabled(param, runtimeValues, linkageEngine)}
        />
      ))}
    </div>
  )
}

export default ParameterPanel
