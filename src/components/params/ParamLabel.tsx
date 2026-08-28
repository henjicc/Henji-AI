import { useId } from 'react'

import Tooltip from '@/components/ui/Tooltip'
import { UI_FIELD_LABEL_CLASS } from '@/components/ui'
import type { BaseParamDef } from '@/core/types/ParamDef'
import { getI18nText } from '@/core/types/I18nText'

interface ParamLabelProps {
  param: Pick<BaseParamDef, 'name' | 'required' | 'tooltip'>
  language: string
  id?: string
  className?: string
}

/**
 * 参数控件的统一标签与用户说明入口。
 *
 * `description` 刻意不在 props 中：它属于助手反射语义，正式界面只消费 `tooltip`。
 */
export function ParamLabel({
  param,
  language,
  id,
  className = '',
}: ParamLabelProps): JSX.Element {
  const tooltipId = useId()
  const label = getI18nText(param.name, language)
  const tooltip = param.tooltip ? getI18nText(param.tooltip, language) : ''

  const labelText = (
    <>
      {label}
      {param.required ? <span className="ml-1 text-danger">*</span> : null}
    </>
  )

  return (
    <div id={id} className={`${UI_FIELD_LABEL_CLASS} ${className}`}>
      {tooltip ? (
        <Tooltip content={tooltip} contentId={tooltipId} delay={200}>
          <span
            tabIndex={0}
            className="inline-block cursor-help rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-accent"
            aria-describedby={tooltipId}
          >
            {labelText}
          </span>
        </Tooltip>
      ) : (
        <span>{labelText}</span>
      )}
    </div>
  )
}
