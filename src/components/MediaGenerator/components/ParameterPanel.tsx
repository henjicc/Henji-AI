/**
 * ParameterPanel - 新架构参数面板
 *
 * 基于 ModelRegistry 和 ParamRenderer 的全新实现
 * 完全消除硬编码，支持所有 41 个模型
 */

import React from 'react'
import { registry } from '@/core/ModelRegistry'
import { ParamRenderer } from '@/components/params/ParamRenderer'

interface ParameterPanelProps {
  currentModel: any
  selectedModel: string
  uploadedImages: string[]
  values: Record<string, any>
  onChange: (id: string, value: any) => void
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

  // 获取参数定义（已按 order 排序）
  const params = registry.getSchema(selectedModel)

  // 没有可配置参数 - 静默返回 null
  if (params.length === 0) {
    return null
  }

  // 渲染所有参数
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      {params.map((param) => (
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
