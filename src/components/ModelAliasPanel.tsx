import React, { useMemo, useState } from 'react'
import { getAvailableProviders } from '../utils/modelHelpers'
import { compareModelNamesForSettings } from '../utils/modelNameSort'
import { getModelAliases, setModelAlias } from '../config/modelAliases'
import { useI18n } from '@/hooks/useI18n'
import { UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS, UiInput } from '@/components/ui'
import ModelTypeBadge, { type ModelMediaType } from './ModelTypeBadge'

interface AliasableModel {
  canonicalModelId: string
  originalName: string
  type: ModelMediaType
  providerNames: string[]
}

/**
 * 别名按 canonicalModelId 统一生效，不区分供应商：同一模型在各供应商下的记录
 * 合并成一条，只保留一份原始名称，并收集它实际由哪些供应商提供。
 */
function buildAliasableModels(providers: ReturnType<typeof getAvailableProviders>): AliasableModel[] {
  const map = new Map<string, AliasableModel>()
  providers.forEach(provider => {
    provider.models.forEach(model => {
      const existing = map.get(model.canonicalModelId)
      if (existing) {
        if (!existing.providerNames.includes(provider.name)) existing.providerNames.push(provider.name)
        return
      }
      map.set(model.canonicalModelId, {
        canonicalModelId: model.canonicalModelId,
        originalName: model.originalName,
        type: model.type,
        providerNames: [provider.name],
      })
    })
  })
  // 设置页专用排序：中英文混排统一按 A-Z（中文按拼音）排列，不按类型分组。
  return Array.from(map.values()).sort((a, b) => compareModelNamesForSettings(a.originalName, b.originalName))
}

const ModelAliasPanel: React.FC = () => {
  const { t } = useI18n('settings')
  const aliasableModels = useMemo(() => buildAliasableModels(getAvailableProviders()), [])
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>(() => getModelAliases())

  const commitAlias = (canonicalModelId: string): void => {
    const value = aliasDrafts[canonicalModelId] ?? ''
    setModelAlias(canonicalModelId, value)
    setAliasDrafts(getModelAliases())
  }

  return (
    <div className="divide-y divide-border-dark/60">
      {aliasableModels.map(entry => (
        <div
          key={entry.canonicalModelId}
          className="flex min-h-12 items-center justify-between gap-4 py-2.5"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className={`truncate ${UI_TEXT_BODY_CLASS}`}>{entry.originalName}</span>
            <ModelTypeBadge type={entry.type} />
          </div>
          <span
            className={`hidden max-w-40 truncate sm:block ${UI_TEXT_META_CLASS}`}
            title={entry.providerNames.join('、')}
          >
            {entry.providerNames.join('、')}
          </span>
          <div className="w-40 shrink-0">
            <UiInput
              value={aliasDrafts[entry.canonicalModelId] ?? ''}
              onChange={(e) => {
                const value = e.target.value
                setAliasDrafts(prev => ({ ...prev, [entry.canonicalModelId]: value }))
              }}
              onBlur={() => commitAlias(entry.canonicalModelId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              placeholder={entry.originalName}
              className="h-8 text-xs"
              aria-label={t('modelSettings.alias.inputLabel', { name: entry.originalName })}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export default ModelAliasPanel
