import React from 'react'
import { ChevronRight } from 'lucide-react'
import { UI_TEXT_META_CLASS, UiEmpty, UiOptionButton } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { SettingsSearchResult } from '../settingsSearchIndex'

interface SettingsSearchResultsProps {
  results: readonly SettingsSearchResult[]
  onSelect: (result: SettingsSearchResult) => void
}

/** 搜索结果：每条是一行设置，副标题写出它在哪个大类、哪个分区，点一下跳过去。 */
const SettingsSearchResults: React.FC<SettingsSearchResultsProps> = ({ results, onSelect }) => {
  const { t } = useI18n('settings')
  if (results.length === 0) {
    return <UiEmpty size="sm" title={t('search.empty')} description={t('search.emptyHint')} />
  }
  return (
    <div role="list" aria-label={t('search.resultsLabel')} className="space-y-0.5">
      {results.map((result) => (
        <UiOptionButton
          key={`${result.entry.sectionId}:${result.entry.labelKey}`}
          role="listitem"
          type="button"
          variant="menu"
          size="lg"
          className="w-full justify-between gap-3 text-left"
          onClick={() => onSelect(result)}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm text-text1">{result.label}</span>
            <span className={`block truncate ${UI_TEXT_META_CLASS}`}>
              {t(`tabs.${result.tab}.label`)}
              {t(`tabs.${result.tab}.label`) === t(`navSections.${result.entry.sectionId}`) ? '' : ` › ${t(`navSections.${result.entry.sectionId}`)}`}
            </span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text2" />
        </UiOptionButton>
      ))}
    </div>
  )
}

export default SettingsSearchResults
