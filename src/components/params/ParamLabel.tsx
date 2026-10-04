import { UI_FIELD_LABEL_CLASS, UI_FIELD_LABEL_INLINE_CLASS, UiTooltipText, useUiFieldLayout } from '@/components/ui'
import type { BaseParamDef } from '@/core/types/ParamDef'
import { getI18nText } from '@/core/types/I18nText'

interface ParamLabelProps {
  param: Pick<BaseParamDef, 'name' | 'required' | 'tooltip'>
  language: string
  id?: string
  className?: string
  /** 说明提示框位置；一列紧挨着的行（画布节点参数行）传 `left`，避免盖住上一行。默认上方。 */
  tooltipPlacement?: 'top' | 'left'
}

/**
 * 参数控件的统一标签与用户说明入口：有 `tooltip` 时参数名本身可悬停/聚焦查看（`UiTooltipText`）。
 * 工具条排布（`UiFieldLayoutContext` = `toolbar`）下标签放在控件左侧，见 `ParamField`。
 *
 * `description` 刻意不在 props 中：它属于助手反射语义，正式界面只消费 `tooltip`。
 */
export function ParamLabel({
  param,
  language,
  id,
  className = '',
  tooltipPlacement,
}: ParamLabelProps): JSX.Element {
  const toolbar = useUiFieldLayout() === 'toolbar'
  const label = getI18nText(param.name, language)
  const tooltip = param.tooltip ? getI18nText(param.tooltip, language) : ''

  return (
    <div id={id} className={`${toolbar ? UI_FIELD_LABEL_INLINE_CLASS : UI_FIELD_LABEL_CLASS} ${className}`}>
      <UiTooltipText tooltip={tooltip || undefined} placement={tooltipPlacement}>
        {label}
        {param.required ? <span className="ml-1 text-danger-text">*</span> : null}
      </UiTooltipText>
    </div>
  )
}
