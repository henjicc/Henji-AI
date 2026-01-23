/**
 * 滤镜面板组件
 * 职责：提供图像滤镜选择和调整
 */

import React from 'react'

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
  return (
    <div className="filter-panel">
      <div className="panel-header">
        <h3>滤镜</h3>
        <button
          className="reset-btn"
          onClick={onFilterReset}
          disabled={!activeFilter}
        >
          重置
        </button>
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
              <label>强度</label>
              <input
                type="range"
                min="0"
                max="100"
                value={filterIntensity}
                onChange={(e) => onFilterIntensityChange(Number(e.target.value))}
              />
              <span className="value">{filterIntensity}%</span>
            </div>

            <button
              className="apply-btn primary"
              onClick={onFilterApply}
            >
              应用滤镜
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
