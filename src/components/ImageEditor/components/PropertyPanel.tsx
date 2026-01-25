/**
 * 属性面板组件
 * 职责：显示和调整图像属性
 */

import React from 'react'
import { useI18n } from '@/hooks/useI18n'

interface PropertyPanelProps {
  brightness: number
  contrast: number
  saturation: number
  scale: number
  rotation: number
  onBrightnessChange: (value: number) => void
  onContrastChange: (value: number) => void
  onSaturationChange: (value: number) => void
  onScaleChange: (value: number) => void
  onRotationChange: (value: number) => void
  onReset: () => void
}

export const PropertyPanel: React.FC<PropertyPanelProps> = ({
  brightness,
  contrast,
  saturation,
  scale,
  rotation,
  onBrightnessChange,
  onContrastChange,
  onSaturationChange,
  onScaleChange,
  onRotationChange,
  onReset
}) => {
  const { t } = useI18n('ui')
  return (
    <div className="property-panel">
      <div className="panel-header">
        <h3>{t('imageEditor.propertyPanel.title')}</h3>
        <button className="reset-btn" onClick={onReset}>
          {t('common:actions.reset')}
        </button>
      </div>

      <div className="panel-content">
        <div className="property-group">
          <label>{t('imageEditor.propertyPanel.brightness')}</label>
          <input
            type="range"
            min="0"
            max="200"
            value={brightness}
            onChange={(e) => onBrightnessChange(Number(e.target.value))}
          />
          <span className="value">{brightness}%</span>
        </div>

        <div className="property-group">
          <label>{t('imageEditor.propertyPanel.contrast')}</label>
          <input
            type="range"
            min="0"
            max="200"
            value={contrast}
            onChange={(e) => onContrastChange(Number(e.target.value))}
          />
          <span className="value">{contrast}%</span>
        </div>

        <div className="property-group">
          <label>{t('imageEditor.propertyPanel.saturation')}</label>
          <input
            type="range"
            min="0"
            max="200"
            value={saturation}
            onChange={(e) => onSaturationChange(Number(e.target.value))}
          />
          <span className="value">{saturation}%</span>
        </div>

        <div className="property-group">
          <label>{t('imageEditor.propertyPanel.scale')}</label>
          <input
            type="range"
            min="10"
            max="300"
            value={scale * 100}
            onChange={(e) => onScaleChange(Number(e.target.value) / 100)}
          />
          <span className="value">{(scale * 100).toFixed(0)}%</span>
        </div>

        <div className="property-group">
          <label>{t('imageEditor.propertyPanel.rotation')}</label>
          <input
            type="range"
            min="0"
            max="360"
            value={rotation}
            onChange={(e) => onRotationChange(Number(e.target.value))}
          />
          <span className="value">{rotation}°</span>
        </div>
      </div>
    </div>
  )
}
