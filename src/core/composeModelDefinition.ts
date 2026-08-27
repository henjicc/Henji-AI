/**
 * 把 SDK 侧运行时定义（`ModelRuntimeDefinition`）与痕迹AI 侧展示补丁
 * （`ModelPresentation`）合成回现有 `ModelDefinition`。
 *
 * 产出结构与现有 `ModelDefinition` 完全一致（见文件末尾的类型层自检），因此
 * `ModelRegistry`、全部界面代码、`src/core/defineModel.ts` 的注册流程都不需要
 * 因为这次拆分而改动——任务 3.2 把 99 个 `.model.ts` 迁移成"运行时定义 + 展示补丁"
 * 两部分后，最后一步就是调用这个函数拿回 `defineModel()` 原来吃的那个对象。
 *
 * 归属口径见 docs/task/模型SDK抽离/重要记录.md 记录 003。
 */

import type {
  ModelRuntimeDefinition,
  RuntimeParamDef,
  RuntimeSelectOption,
} from '@henjicc/ai-sdk'

import type { I18nText } from './types/I18nText'
import type {
  ModelDefinition,
  ModelMeta,
  ProgressConfig,
} from './types/ModelDefinition'
import type {
  ParamDef,
  TextParamDef,
  NumberParamDef,
  DropdownParamDef,
  SwitchParamDef,
  RadioParamDef,
  PanelParamDef,
  CompositePanelDef,
  ImageUploadParamDef,
  VideoUploadParamDef,
  FileUploadParamDef,
  ResolutionParamDef,
  AspectRatioParamDef,
} from './types/ParamDef'
import type { EndpointConfig } from './types/EndpointConfig'
import type { RequestConfig } from './types/RequestConfig'
import type { PricingConfig } from './types/PricingConfig'
import type { InputLimits } from './types/InputLimits'
import type { GenerationRequirement } from './types/GenerationRequirements'
import type { ModelPresentation, ParamPresentationEntry } from './types/ModelPresentation'

function composeOptions(
  options: RuntimeSelectOption[],
  labels: Record<string, { label: I18nText; description?: I18nText }> | undefined
) {
  return options.map((option) => {
    const key = String(option.value)
    const presented = labels?.[key]
    return {
      value: option.value,
      label: presented?.label ?? String(option.value),
      description: presented?.description,
      disabled: option.disabled,
    }
  })
}

function composePresets(
  presets: Array<{ value: string }>,
  labels: Record<string, I18nText> | undefined
) {
  return presets.map((preset) => ({
    value: preset.value,
    label: labels?.[preset.value] ?? preset.value,
  }))
}

function composeAspectRatioOptions(
  options: Array<{ value: string }>,
  display: Record<string, { label: string; icon?: string }> | undefined
) {
  return options.map((option) => {
    const entry = display?.[option.value]
    return { value: option.value, label: entry?.label ?? option.value, icon: entry?.icon }
  })
}

function requirePresentation(
  presentationParams: Record<string, ParamPresentationEntry>,
  paramId: string
): ParamPresentationEntry {
  const entry = presentationParams[paramId]
  if (!entry) {
    throw new Error(`composeModelDefinition: missing ParamPresentation entry for param "${paramId}"`)
  }
  return entry
}

function composeParam(
  runtime: RuntimeParamDef,
  presentationParams: Record<string, ParamPresentationEntry>
): ParamDef {
  const presentation = requirePresentation(presentationParams, runtime.id)

  const base = {
    id: runtime.id,
    order: runtime.order,
    name: presentation.name,
    tooltip: presentation.tooltip,
    description: presentation.description,
    required: runtime.required,
    default: runtime.default,
    api: runtime.api,
    apiField: runtime.apiField,
    apiTransform: runtime.apiTransform,
    apiMapping: runtime.apiMapping,
    transferKey: runtime.transferKey,
    visible: runtime.visible,
    disabled: runtime.disabled,
    socketType: presentation.socketType,
    role: presentation.role,
  }

  switch (runtime.type) {
    case 'text':
    case 'textarea':
      return {
        ...base,
        type: runtime.type,
        valueType: runtime.valueType,
        placeholder: presentation.placeholder,
        multiline: presentation.multiline,
        maxLength: runtime.maxLength,
        rows: presentation.rows,
        editor: presentation.editor,
      } as TextParamDef

    case 'number':
      return {
        ...base,
        type: 'number',
        valueType: runtime.valueType,
        min: runtime.min,
        max: runtime.max,
        step: runtime.step,
        placeholder: presentation.placeholder,
        unit: presentation.unit,
        marks: presentation.marks,
        showInput: presentation.showInput,
      } as NumberParamDef

    case 'dropdown':
      return {
        ...base,
        type: 'dropdown',
        valueType: runtime.valueType,
        options: composeOptions(runtime.options, presentation.optionLabels),
        searchable: presentation.searchable,
        placeholder: presentation.placeholder,
      } as DropdownParamDef

    case 'switch':
      return {
        ...base,
        type: 'switch',
        valueType: runtime.valueType,
        onLabel: presentation.onLabel,
        offLabel: presentation.offLabel,
      } as SwitchParamDef

    case 'radio':
      return {
        ...base,
        type: 'radio',
        valueType: runtime.valueType,
        options: composeOptions(runtime.options, presentation.optionLabels),
        direction: presentation.direction,
      } as RadioParamDef

    case 'panel':
      return {
        ...base,
        type: 'panel',
        valueType: runtime.valueType,
        children: runtime.children.map((child) => composeParam(child, presentationParams)),
        collapsible: presentation.collapsible,
        defaultCollapsed: presentation.defaultCollapsed,
      } as PanelParamDef

    case 'composite':
      return {
        ...base,
        type: 'composite',
        valueType: runtime.valueType,
        panel: presentation.panel,
        config: presentation.config,
      } as CompositePanelDef

    case 'image-upload':
      return {
        ...base,
        type: 'image-upload',
        valueType: runtime.valueType,
        maxCount: runtime.maxCount,
        format: runtime.format,
        base64Prefix: runtime.base64Prefix,
        accept: runtime.accept,
        maxSize: runtime.maxSize,
        smartMatch: runtime.smartMatch,
        uploadButtonText: presentation.uploadButtonText,
      } as ImageUploadParamDef

    case 'video-upload':
      return {
        ...base,
        type: 'video-upload',
        valueType: runtime.valueType,
        maxCount: runtime.maxCount,
        accept: runtime.accept,
        maxSize: runtime.maxSize,
        maxDuration: runtime.maxDuration,
        minDuration: runtime.minDuration,
        uploadButtonText: presentation.uploadButtonText,
      } as VideoUploadParamDef

    case 'file-upload':
      return {
        ...base,
        type: 'file-upload',
        valueType: runtime.valueType,
        maxCount: runtime.maxCount,
        accept: runtime.accept,
        maxSize: runtime.maxSize,
        uploadButtonText: presentation.uploadButtonText,
      } as FileUploadParamDef

    case 'resolution':
      return {
        ...base,
        type: 'resolution',
        valueType: runtime.valueType,
        presets: composePresets(runtime.presets, presentation.presetLabels),
        allowCustom: runtime.allowCustom,
      } as ResolutionParamDef

    case 'aspect-ratio':
      return {
        ...base,
        type: 'aspect-ratio',
        valueType: runtime.valueType,
        options: composeAspectRatioOptions(runtime.options, presentation.aspectRatioDisplay),
      } as AspectRatioParamDef

    default: {
      const exhaustive: never = runtime
      throw new Error(`composeModelDefinition: unknown runtime param type ${JSON.stringify(exhaustive)}`)
    }
  }
}

export function composeModelDefinition(
  runtime: ModelRuntimeDefinition,
  presentation: ModelPresentation
): ModelDefinition {
  const params = runtime.params.map((param) => composeParam(param, presentation.params))

  const meta: ModelMeta = {
    id: runtime.meta.id,
    canonicalModelId: runtime.meta.canonicalModelId,
    provider: runtime.meta.provider,
    type: runtime.meta.type,
    name: presentation.meta.name,
    i18nScope: presentation.meta.i18nScope,
    tags: runtime.meta.tags,
    icon: presentation.meta.icon,
    polling: runtime.meta.polling,
    progress: runtime.meta.progress as ProgressConfig | undefined,
    progressLearning: runtime.meta.progressLearning,
    aliases: runtime.meta.aliases,
    aliasParamDefaults: runtime.meta.aliasParamDefaults,
    aliasParamMappings: runtime.meta.aliasParamMappings,
    seriesId: runtime.meta.seriesId,
    seriesRank: runtime.meta.seriesRank,
  }

  return {
    meta,
    params,
    paramPresentation: presentation.paramPresentation,
    linkages: presentation.linkages,
    requirements: runtime.requirements as GenerationRequirement[] | undefined,
    inputLimits: runtime.inputLimits as InputLimits | undefined,
    alternativeInputParamIds: runtime.alternativeInputParamIds,
    runtimeConstraints: runtime.runtimeConstraints,
    endpoints: runtime.endpoints as EndpointConfig,
    request: runtime.request as RequestConfig | undefined,
    pricing: runtime.pricing as PricingConfig,
  }
}

/**
 * 类型层自检（编译期）：composeModelDefinition 的返回类型必须能赋给现有
 * `ModelDefinition`。这行本身不产生任何运行时行为，只是让 `tsc` 在这个函数签名
 * 与 `ModelDefinition` 结构不一致时直接编译失败——3.1 的验收标准要求的正是这个检查，
 * 按允许改动范围不新增 src 侧测试文件，因此以类型断言的形式留在源文件里。
 */
const _composeModelDefinitionTypeCheck: (
  runtime: ModelRuntimeDefinition,
  presentation: ModelPresentation
) => ModelDefinition = composeModelDefinition
void _composeModelDefinitionTypeCheck
