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

  // 渠道字段名与 role 必须一一对应：用了共享「渠道」词表就得声明 role，
  // 声明了 role 就得用共享词表。「渠道」在所有供应商上含义相同（走哪个接入点），
  // 统一走共享 key 才能集中翻译，也防止叫法漂移成「接入点」「线路」。
  // 注意这条只约束字段名，不约束选项——选项是供应商自己的产品叫法，见下方说明。
  model.params.forEach((param) => {
    const usesSharedChannelLabel = i18nKey(param.name) === 'params.fields.apiChannel'
    if (usesSharedChannelLabel && param.role !== 'channel') {
      fail(`Param using the shared Channel label must declare role 'channel': ${param.id}`)
    }
    if (param.role === 'channel' && !usesSharedChannelLabel) {
      fail(`Channel param must use sharedFieldText('apiChannel') as its name: ${param.id}`)
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

    // 刻意不校验选项文案。渠道选项是供应商自己的产品叫法（ext / VIP / CL / VT / 4K-VIP…），
    // 共享「普通 / 官方」词表只在恰好两档、且正好是「第三方 vs 官方」时对得上，
    // 曾因强制这两档逼得多档渠道绕开共享词表，反而把字段名也带偏了。选项交给模型自己定义。
  })
}
