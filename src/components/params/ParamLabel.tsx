import { UI_FIELD_LABEL_CLASS, UiTooltipText } from '@/components/ui'
import type { BaseParamDef } from '@/core/types/ParamDef'
import { getI18nText } from '@/core/types/I18nText'

interface ParamLabelProps {
  param: Pick<BaseParamDef, 'name' | 'required' | 'tooltip'>
  language: string
  id?: string
  className?: string
}

/**
 * 参数控件的统一标签与用户说明入口：有 `tooltip` 时参数名本身可悬停/聚焦查看（`UiTooltipText`）。
 *
 * `description` 刻意不在 props 中：它属于助手反射语义，正式界面只消费 `tooltip`。
 */
export function ParamLabel({
  param,
  language,
  id,
  className = '',
}: ParamLabelProps): JSX.Element {
  const label = getI18nText(param.name, language)
  const tooltip = param.tooltip ? getI18nText(param.tooltip, language) : ''

  return (
    <div id={id} className={`${UI_FIELD_LABEL_CLASS} ${className}`}>
      <UiTooltipText tooltip={tooltip || undefined}>
        {label}
        {param.required ? <span className="ml-1 text-danger-text">*</span> : null}
      </UiTooltipText>
    </div>
  )
}
