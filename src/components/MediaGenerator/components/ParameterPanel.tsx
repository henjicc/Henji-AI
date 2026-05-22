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

interface ParameterPanelProps {
  currentModel: any
  selectedModel: string
  uploadedImages: string[]
  uploadedVideos: string[]
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

function isPrimaryModeParam(param: ParamDef): boolean {
  const zhName = getI18nText(param.name, 'zh').trim().toLowerCase()
  const enName = getI18nText(param.name, 'en').trim().toLowerCase()
  return zhName === '模式' || enName === 'mode'
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

  const linkageEngine = useMemo(() => {
    if (!modelDef.linkages || modelDef.linkages.length === 0) {
      return null
    }
    return new LinkageEngine(modelDef.linkages)
  }, [modelDef.linkages])

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
    if (modelDef.meta.provider === 'modelscope') {
      return null
    }
    return analyzeRatioResolutionParams(filteredParams, uploadedImages)
  }, [modelDef.meta.provider, filteredParams, uploadedImages])

  const consumedParamIds = new Set(specialPanelSpec?.consumedParamIds || [])
  const renderParams = filteredParams.filter((param) => !consumedParamIds.has(param.id))
  const modeParams = useMemo(
    () => renderParams.filter(isPrimaryModeParam),
    [renderParams]
  )
  const nonModeParams = useMemo(
    () => renderParams.filter((param) => !isPrimaryModeParam(param)),
    [renderParams]
  )
  const orderedRenderParams = useMemo(() => {
    if (!specialPanelSpec) {
      return nonModeParams
    }
    const durationParams = nonModeParams.filter(isDurationParam)
    const normalParams = nonModeParams.filter((param) => !isDurationParam(param))
    return [...durationParams, ...normalParams]
  }, [nonModeParams, specialPanelSpec])

  // 渲染参数：主模式参数始终跟在模型选择器后，分辨率/比例面板保持其余参数前置
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      {modeParams.map((param) => (
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
