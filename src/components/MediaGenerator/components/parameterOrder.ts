import { getI18nText, type ParamDef } from '@/core/types'

export function isPrimarySelectorParam(param: ParamDef): boolean {
  const nameKey = typeof param.name === 'object' && 'key' in param.name
    ? param.name.key
    : undefined
  if (nameKey === 'params.fields.apiChannel') return true

  const zhName = getI18nText(param.name, 'zh').trim().toLowerCase()
  const enName = getI18nText(param.name, 'en').trim().toLowerCase()
  // 只认中文「渠道」，不认英文 channel：音频「声道」的英文名同样是 Channel，
  // 若把英文 channel 也收进白名单会把声道参数误判成产品渠道提前。
  if (zhName === '渠道') return true
  return ['模式', '版本', '变体'].includes(zhName) || ['mode', 'version', 'variant'].includes(enName)
}
