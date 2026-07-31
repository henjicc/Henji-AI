import React from 'react'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS } from '../settingsLayout'
import ModelSettingsPanel from '../../ModelSettingsPanel'

/**
 * 模型大类只有一个分节，且模型列表需要横向铺开，
 * 所以不套 `SETTINGS_CONTENT_MAX_WIDTH_CLASS` 的限宽。
 */
const ModelsTab: React.FC = () => (
  <div className={SETTINGS_CONTENT_CLASS}>
    <SettingsSection id="models-visibility">
      <ModelSettingsPanel />
    </SettingsSection>
  </div>
)

export default ModelsTab
