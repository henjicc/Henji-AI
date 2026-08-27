/**
 * SDK 侧 `defineModel`：纯函数版本，只做规范化 + 运行时校验。
 *
 * 与应用侧 `src/core/defineModel.ts` 的区别：
 * - 不解析 canonical 描述（那是展示层数据，见 `generationModelDescriptions.ts`）
 * - 不改写 i18n key（`applyI18nScope` 是纯展示层行为）
 * - 不注册进任何 registry——没有副作用，多次调用同一入参必须得到等价结果
 *
 * 痕迹AI 将这里的运行时定义与 `ModelPresentation` 合成后，交给应用侧
 * `src/core/defineModel.ts` 完成展示补丁与注册；其他消费方可直接使用本纯函数结果。
 */

import type { ModelRuntimeDefinition } from '../types/model'
import { validateRuntimeModel } from './validate'

/**
 * 定义模型运行时契约：校验通过后原样返回（浅拷贝，避免调用方后续原地修改
 * 入参对象而让已经产出的定义悄悄跟着变）。校验失败抛出 `ModelRuntimeValidationError`。
 */
export function defineModel(model: ModelRuntimeDefinition): ModelRuntimeDefinition {
  const normalized: ModelRuntimeDefinition = {
    ...model,
    meta: { ...model.meta },
    params: [...model.params],
  }

  validateRuntimeModel(normalized)

  return normalized
}
