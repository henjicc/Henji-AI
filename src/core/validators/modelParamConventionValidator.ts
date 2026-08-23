import type { ModelDefinition } from '@/core/types'

type ValidationFailure = (message: string) => never

function i18nKey(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('key' in value)) return undefined
  return typeof value.key === 'string' ? value.key : undefined
}

/** 验证跨模型共享参数的产品约定。 */
export function validateModelParamConventions(
  model: Pick<ModelDefinition, 'params' | 'paramPresentation'>,
  fail: ValidationFailure
): void {
  const channelParams = model.params.filter(
    (param) => i18nKey(param.name) === 'params.fields.apiChannel'
  )

  channelParams.forEach((channelParam) => {
    const isGrouped = model.paramPresentation?.groups.some((group) => (
      group.sections.some((section) => section.paramIds.includes(channelParam.id))
    ))
    if (isGrouped) {
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

    const optionKeys = channelParam.options.map((option) => i18nKey(option.label)).sort()
    const expectedOptionKeys = ['params.options.official', 'params.options.regular']
    if (optionKeys.length !== expectedOptionKeys.length
      || optionKeys.some((key, index) => key !== expectedOptionKeys[index])) {
      fail(`Channel param options must use shared Regular and Official labels: ${channelParam.id}`)
    }
  })
}
