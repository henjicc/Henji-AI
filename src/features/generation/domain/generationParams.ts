import { LinkageEngine } from '@/core/linkage'
import type { Linkage, ParamDef } from '@/core/types'
import { validateParamValue } from '@/hooks/utils/defaultExtractor'

/*
 * 参数联动的纯领域层（5.2）。
 *
 * 读代码发现联动的核心算法早就是纯函数/纯类了——src/core/linkage/LinkageEngine.ts
 * 与 src/hooks/utils/{defaultExtractor,paramUtils}.ts 都不 import React，本任务不是
 * "把逻辑从 React 里挖出来"，而是给这些已经存在的纯函数搭一层稳定的领域层入口，供
 * useModelParams.ts（渲染层）与 5.3/5.4 的 store 写入路径共用同一套调用方式，不再各自
 * 直接 new LinkageEngine(...)——这正是任务文档强调的"助手和人走同一条联动路径"。
 *
 * 任务文档给的三个函数签名只有 `schema`，没有 `linkages`——但 LinkageEngine 的算法
 * 天然需要 linkages（联动规则数组）才能跑，schema（参数定义）和 linkages（联动规则）
 * 是模型定义里两个独立字段（分别是 registry.getSchema(id) 与
 * registry.getModel(id).linkages）。这里的签名把 linkages 加回来，不是可选项。
 */

export interface GenerationParamIssue {
  paramId: string
  reason: string
}

export interface GenerationParamValidation {
  valid: boolean
  issues: GenerationParamIssue[]
}

/**
 * 算出每个 dropdown/radio 参数在当前参数状态下的可选项。
 *
 * 对应 useModelParams.ts 里 getFilteredOptions 的逐参数版本；这里一次性算出全部参数的
 * 选项表，而不是按需查询单个参数——是因为 5.3 之后 store 侧需要在写入后一次性知道
 * "哪些参数的选项跟着变了"，逐个查询效率低也容易漏查。
 */
export function resolveGenerationParamOptions(
  schema: ParamDef[],
  params: DynamicValueMap,
  linkages: Linkage[],
): Record<string, DynamicValue[]> {
  const engine = new LinkageEngine(linkages)
  const options: Record<string, DynamicValue[]> = {}
  for (const param of schema) {
    if (param.type !== 'dropdown' && param.type !== 'radio') continue
    options[param.id] = engine.getFilteredOptions(param.id, params, schema)
  }
  return options
}

/** 逐参数跑 validateParamValue，收集不合法的参数与原因。未出现在 params 里的参数不校验。 */
export function validateGenerationParams(
  schema: ParamDef[],
  params: DynamicValueMap,
): GenerationParamValidation {
  const issues: GenerationParamIssue[] = []
  for (const param of schema) {
    if (!(param.id in params)) continue
    if (!validateParamValue(param, params[param.id])) {
      issues.push({ paramId: param.id, reason: `参数 ${param.id} 的当前值不在 schema 允许的范围/选项内` })
    }
  }
  return { valid: issues.length === 0, issues }
}

/**
 * 参数变更后把因联动而非法的其他参数拉回合法值。
 *
 * `changedKeys` 省略时对 params 里出现过的每一个 key 都跑一遍 LinkageEngine.execute——
 * 这是给"整体状态可能来自任意来源"的场景兜底用的（例如 5.3 之后助手一次性写入多个
 * 参数、或加载预设后的全量校正），不知道具体是哪个 key 触发的，就假设每个 key 都可能是
 * 触发源，逐一跑一遍。LinkageEngine.execute 对没有命中任何联动规则的 key 是无操作的
 * （shouldTrigger 找不到匹配直接跳过），所以多跑不会产生副作用，只是比精确指定
 * changedKeys 更保守一些。
 *
 * 传入 changedKeys 时只跑这几个 key——对应 setParam(key, value) 这种明确知道触发源的
 * 场景，与 useModelParams.ts 原来的行为完全一致。
 */
export function reconcileGenerationParams(
  schema: ParamDef[],
  params: DynamicValueMap,
  linkages: Linkage[],
  changedKeys?: readonly string[],
): DynamicValueMap {
  if (linkages.length === 0) return params
  const engine = new LinkageEngine(linkages)
  const keys = changedKeys && changedKeys.length > 0 ? changedKeys : Object.keys(params)
  let result = params
  for (const key of keys) {
    result = engine.execute(key, result, schema)
  }
  return result
}
