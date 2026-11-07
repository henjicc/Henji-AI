import { registry } from '@/core/ModelRegistry'
import type { ParamDef } from '@/core/types'
import { resolveInputLimits } from './inputLimits'

export interface MediaCounts {
  images: number
  videos: number
  audios: number
}

type OptionParamDef = Extract<ParamDef, { type: 'dropdown' | 'radio' }>

/** 同一模型可以有多个主选择器（如“版本”和“模式”都声明为 mode），按声明顺序全部返回。 */
function findRoleParams(params: readonly ParamDef[], role: 'mode' | 'channel'): OptionParamDef[] {
  return params.flatMap((param): OptionParamDef[] => {
    if ((param.type === 'dropdown' || param.type === 'radio') && param.role === role && param.options?.length) return [param]
    return param.type === 'panel' ? findRoleParams(param.children, role) : []
  })
}

function fits(modelId: string, params: DynamicValueMap, counts: MediaCounts): boolean {
  const limits = resolveInputLimits(modelId, params, { imagesCount: counts.images, videosCount: counts.videos })
  return (['images', 'videos', 'audios'] as const).every((kind) => counts[kind] >= limits[kind].min && counts[kind] <= limits[kind].max)
}

/** 各参数的取值组合：每个参数当前值排第一、其余按声明顺序，越靠后的参数越先变；没有参数时只有“不改”。 */
function choices(roleParams: readonly OptionParamDef[], params: DynamicValueMap): Array<DynamicValueMap> {
  return roleParams.reduce<Array<DynamicValueMap>>((combos, param) => {
    const current = params[param.id]
    const values = [current, ...(param.options ?? []).map((option) => option.value).filter((value) => value !== current)]
    return combos.flatMap((combo) => values.map((value) => ({ ...combo, [param.id]: value })))
  }, [{}])
}

/**
 * 按实际带的素材选模式：当前设置收不下这些素材（或缺了必需的素材）时，换到第一个收得下的组合。
 * 文生模式不收图、图生模式必须给图这类模型，画布和助手带图调用时不用逐个模型写联动。
 * 先只换模式；当前渠道下所有模式都不行才换渠道（渠道关系到路由与价格，真实付费仍走付费策略）。
 * 都收不下时原样返回，交给数量校验报错。
 */
export function resolveModeForMedia(modelId: string, params: DynamicValueMap, counts: MediaCounts): DynamicValueMap {
  const model = registry.getModel(modelId)
  if (!model || fits(modelId, params, counts)) return params
  const modeParams = findRoleParams(model.params, 'mode')
  const channelParams = findRoleParams(model.params, 'channel')
  if (!modeParams.length && !channelParams.length) return params
  for (const channel of choices(channelParams, params)) {
    for (const mode of choices(modeParams, params)) {
      const candidate = { ...params, ...channel, ...mode }
      if (fits(modelId, candidate, counts)) return candidate
    }
  }
  return params
}
