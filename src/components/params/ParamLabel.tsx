import { Info } from 'lucide-react'
import { useId } from 'react'

import Tooltip from '@/components/ui/Tooltip'
import { UI_FIELD_LABEL_CLASS, UiIconButton } from '@/components/ui'
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
  const infoLabel = language.startsWith('zh')
    ? `查看“${label}”说明`
    : `View help for ${label}`

  return (
    <div id={id} className={`${UI_FIELD_LABEL_CLASS} ${className}`}>
      <span className="inline-flex items-center gap-1">
        <span>
          {label}
          {param.required ? <span className="ml-1 text-danger">*</span> : null}
        </span>
        {tooltip ? (
          <Tooltip content={tooltip} contentId={tooltipId} delay={200}>
            <UiIconButton
              type="button"
              showBorder={false}
              appearance="hover-only"
              className="!h-6 !w-6 shrink-0"
              aria-label={infoLabel}
              aria-describedby={tooltipId}
            >
              <Info className="h-3.5 w-3.5" />
            </UiIconButton>
          </Tooltip>
        ) : null}
      </span>
    </div>
  )
}
