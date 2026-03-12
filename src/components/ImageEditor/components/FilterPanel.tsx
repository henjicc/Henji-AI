/**
 * 滤镜面板组件
 * 职责：提供图片滤镜选择和调整
 */

import React from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiRangeInput } from '@/components/ui'

interface Filter {
  id: string
  name: string
  icon?: string
  preview?: string
}

interface FilterPanelProps {
  filters: Filter[]
  activeFilter?: string
  onFilterSelect: (filterId: string) => void
  onFilterApply: () => void
  onFilterReset: () => void
  filterIntensity: number
  onFilterIntensityChange: (intensity: number) => void
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  filters,
  activeFilter,
  onFilterSelect,
  onFilterApply,
  onFilterReset,
  filterIntensity,
  onFilterIntensityChange
}) => {
  const { t } = useI18n('ui')
  return (
    <div className="filter-panel">
      <div className="panel-header">
        <h3>{t('imageEditor.filterPanel.title')}</h3>
        <UiButton
          type="button"
          size="sm"
          variant="ghost"
          className="reset-btn"
          onClick={onFilterReset}
          disabled={!activeFilter}
        >
          {t('common:actions.reset')}
        </UiButton>
      </div>

      <div className="panel-content">
        <div className="filters-grid">
          {filters.map(filter => (
            <div
              key={filter.id}
              className={`filter-item ${activeFilter === filter.id ? 'active' : ''}`}
              onClick={() => onFilterSelect(filter.id)}
            >
              {filter.preview ? (
                <img
                  src={filter.preview}
                  alt={filter.name}
                  className="filter-preview"
                />
              ) : (
                <div className="filter-icon">
                  {filter.icon || '🎨'}
                </div>
              )}
              <div className="filter-name">{filter.name}</div>
            </div>
          ))}
        </div>

        {activeFilter && (
          <div className="filter-controls">
            <div className="control-group">
              <label>{t('imageEditor.filterPanel.intensity')}</label>
              <UiRangeInput
                min="0"
                max="100"
                value={filterIntensity}
                onChange={(e) => onFilterIntensityChange(Number(e.target.value))}
              />
              <span className="value">{filterIntensity}%</span>
            </div>

            <UiButton
              type="button"
              variant="primary"
              size="sm"
              className="apply-btn primary"
              onClick={onFilterApply}
            >
              {t('imageEditor.filterPanel.apply')}
            </UiButton>
          </div>
        )}
      </div>
    </div>
  )
}
