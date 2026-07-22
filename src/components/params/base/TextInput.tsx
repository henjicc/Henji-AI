/**
 * TextInput 组件
 *
 * 支持单行和多行文本输入
 * 支持 i18n 显示名称
 * 支持禁用和条件显示
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TextParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'
import { PromptEditor, UiInput, UiTextAreaField } from '@/components/ui'
import {
  resolveTextParamPromptDocument,
  resolveTextParamPromptVariables,
  serializeTextParamPromptDocument,
} from './promptTextParam'

interface TextInputProps {
  param: TextParamDef
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export const TextInput: React.FC<TextInputProps> = ({
  param,
  value,
  onChange,
  disabled = false
}) => {
  const { i18n } = useTranslation()

  // 获取显示名称（支持 i18n）
  const displayName = getI18nText(param.name, i18n.language)
  const placeholder = getI18nText(param.placeholder || '', i18n.language)
  const promptVariables = useMemo(
    () => resolveTextParamPromptVariables(param, i18n.language),
    [i18n.language, param],
  )
  const promptDocument = useMemo(
    () => resolveTextParamPromptDocument(value || '', promptVariables),
    [promptVariables, value],
  )

  // 处理输入变化
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(e.target.value)
  }

  if (param.editor?.kind === 'prompt') {
    return (
      <div className="w-auto">
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">
          {displayName}
          {param.required && <span className="ml-1 text-red-500">*</span>}
        </label>
        <PromptEditor
          value={promptDocument}
          onChange={(document) => onChange(serializeTextParamPromptDocument(document))}
          preset={param.editor.preset ?? 'plain'}
          variables={promptVariables}
          ariaLabel={displayName}
          placeholder={placeholder}
          disabled={disabled}
          maxCharacters={param.maxLength}
          showCharacterCount={param.maxLength !== undefined}
          editorClassName={param.rows && param.rows > 4 ? 'min-h-[120px]' : 'min-h-[80px]'}
        />
      </div>
    )
  }

  // 多行普通文本输入
  if (param.multiline) {
    return (
      <div className="w-auto">
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          {displayName}
          {param.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <UiTextAreaField
          value={value || ''}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder}
          rows={param.rows || 4}
          className="min-h-[80px] resize-y"
        />
      </div>
    )
  }

  // 单行文本输入
  return (
    <div className="w-auto">
      <label className="block text-sm font-medium text-zinc-300 mb-1.5">
        {displayName}
        {param.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <UiInput
        type="text"
        value={value || ''}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        className="h-[38px]"
      />
    </div>
  )
}
