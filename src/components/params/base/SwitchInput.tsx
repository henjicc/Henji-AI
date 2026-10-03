/**
 * SwitchInput 组件
 *
 * 支持开关切换（显式双段形态）
 * 支持 i18n 显示名称
 * 支持禁用和条件显示
 */

import React, { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { SwitchParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'
import { UiSwitch, useUiFieldLayout } from '@/components/ui'
import { ParamLabel } from '../ParamLabel'
import { ParamField } from '../ParamField'

interface SwitchInputProps {
  param: SwitchParamDef
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}

export const SwitchInput: React.FC<SwitchInputProps> = ({
  param,
  value,
  onChange,
  disabled = false
}) => {
  const { i18n, t } = useTranslation()

  // 获取显示名称（支持 i18n）
  const displayName = getI18nText(param.name, i18n.language)

  // 获取开关文字
  const onText = t('common:on', '开')
  const offText = t('common:off', '关')
  const labelId = useId()
  const checked = Boolean(value ?? param.default)
  // 工具条排布：参数名在左，开关用胶囊（强调色只进轨道）；表单排布保留显式“关/开”双段
  const toolbar = useUiFieldLayout() === 'toolbar'

  return (
    <ParamField>
      {displayName ? (
        <ParamLabel id={labelId} param={param} language={i18n.language} />
      ) : null}
      {toolbar ? (
        <UiSwitch
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          aria-labelledby={displayName ? labelId : undefined}
          aria-label={displayName ? undefined : checked ? onText : offText}
          title={checked ? onText : offText}
        />
      ) : (
        <UiSwitch
          appearance="segmented"
          checked={checked}
          onCheckedChange={onChange}
          offLabel={offText}
          onLabel={onText}
          disabled={disabled}
          aria-labelledby={displayName ? labelId : undefined}
          aria-label={displayName ? undefined : checked ? onText : offText}
          title={checked ? onText : offText}
        />
      )}
    </ParamField>
  )
}
