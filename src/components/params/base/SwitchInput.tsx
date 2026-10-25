/**
 * SwitchInput 组件
 *
 * 布尔参数：复选框外观
 * 支持 i18n 显示名称
 * 支持禁用和条件显示
 */

import React, { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { SwitchParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'
import { UiSwitch } from '@/components/ui'
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
  // 布尔参数一律用复选框外观（重要记录 018 / 019），工具条与浮层表单相同
  return (
    <ParamField>
      {displayName ? (
        <ParamLabel id={labelId} param={param} language={i18n.language} />
      ) : null}
      <UiSwitch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-labelledby={displayName ? labelId : undefined}
        aria-label={displayName ? undefined : checked ? onText : offText}
        title={checked ? onText : offText}
      />
    </ParamField>
  )
}
