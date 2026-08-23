import { getI18nText, type ParamDef } from '@/core/types'

export function isPrimarySelectorParam(param: ParamDef): boolean {
  const nameKey = typeof param.name === 'object' && 'key' in param.name
    ? param.name.key
    : undefined
  if (nameKey === 'params.fields.apiChannel') return true

  const zhName = getI18nText(param.name, 'zh').trim().toLowerCase()
  const enName = getI18nText(param.name, 'en').trim().toLowerCase()
  return ['模式', '版本', '变体'].includes(zhName) || ['mode', 'version', 'variant'].includes(enName)
}
