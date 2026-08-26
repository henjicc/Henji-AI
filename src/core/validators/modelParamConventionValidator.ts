import type { ModelDefinition } from '@/core/types'

type ValidationFailure = (message: string) => never

function i18nKey(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('key' in value)) return undefined
  return typeof value.key === 'string' ? value.key : undefined
}

/**
 * 读取内联字面中文名。刻意不走 getI18nText：那会把 i18n 实例拉进模型注册链路
 * （modelText.ts 顶部已说明这里存在循环 barrel 导入风险），而且 key 形式的名称
 * 由下面的共享词表检查单独覆盖，这里只需要认出手写字面量。
 */
function literalZhName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('zh' in value)) return undefined
  return typeof value.zh === 'string' ? value.zh.trim() : undefined
}

/** 参数名文案 -> 期望的 role，用来兜住「该声明角色却漏写」的情况。 */
const ROLE_HINTS: ReadonlyArray<{ zh: string; role: 'channel' | 'mode' }> = [
  { zh: '渠道', role: 'channel' },
  { zh: '模式', role: 'mode' },
  { zh: '版本', role: 'mode' },
  { zh: '变体', role: 'mode' },
]

/** 验证跨模型共享参数的产品约定。 */
export function validateModelParamConventions(
  model: Pick<ModelDefinition, 'params' | 'paramPresentation'>,
  fail: ValidationFailure
): void {
  const groupedParamIds = new Set<string>()
  for (const group of model.paramPresentation?.groups ?? []) {
    for (const section of group.sections) {
      for (const paramId of section.paramIds) {
        groupedParamIds.add(paramId)
      }
    }
  }

  // 漏写 role 的兜底 1：用了共享「渠道」词表，却没声明自己是渠道。
  model.params.forEach((param) => {
    if (i18nKey(param.name) === 'params.fields.apiChannel' && param.role !== 'channel') {
      fail(`Param using the shared Channel label must declare role 'channel': ${param.id}`)
    }
  })

  // 漏写 role 的兜底 2：名字已经是渠道/模式/版本/变体的顶层选择器，却没声明角色。
  // 不声明不会报错、只会让参数掉回普通排序静默排错位置，所以在注册时直接拦下。
  // 展示分组内的参数从不参与提前渲染，不适用这条。
  model.params.forEach((param) => {
    if (param.role || groupedParamIds.has(param.id)) return
    if (param.type !== 'dropdown' && param.type !== 'radio') return
    const zhName = literalZhName(param.name)
    const hint = ROLE_HINTS.find((item) => item.zh === zhName)
    if (hint) {
      fail(`Param named "${zhName}" must declare role '${hint.role}': ${param.id}`)
    }
  })

  const channelParams = model.params.filter((param) => param.role === 'channel')

  channelParams.forEach((channelParam) => {
    if (groupedParamIds.has(channelParam.id)) {
      fail(`Channel param must remain a top-level param: ${channelParam.id}`)
    }

    const otherOrders = model.params
      .filter((param) => param !== channelParam)
      .map((param) => param.order)
    if (otherOrders.some((order) => channelParam.order >= order)) {
      fail(`Channel param must be ordered before every other param: ${channelParam.id}`)
    }

    if (channelParam.type !== 'dropdown' && channelParam.type !== 'radio') {
      fail(`Channel param must be a dropdown or radio: ${channelParam.id}`)
    }

    // 共享「普通 / 官方」词表只覆盖两档渠道，用了它就必须严格是那两个选项；
    // 渠道多于两档的模型改用自定义标签，选项由模型自己定义，不适用这条。
    if (i18nKey(channelParam.name) === 'params.fields.apiChannel') {
      const optionKeys = channelParam.options.map((option) => i18nKey(option.label)).sort()
      const expectedOptionKeys = ['params.options.official', 'params.options.regular']
      if (optionKeys.length !== expectedOptionKeys.length
        || optionKeys.some((key, index) => key !== expectedOptionKeys[index])) {
        fail(`Channel param options must use shared Regular and Official labels: ${channelParam.id}`)
      }
    }
  })
}
