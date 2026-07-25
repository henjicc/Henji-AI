import React from 'react'
import { UI_SECTION_STACK_CLASS } from '@/components/ui'
import ModelSettingsPanel from '../../ModelSettingsPanel'

interface ModelsTabProps {
  sectionId?: string
}

const ModelsTab: React.FC<ModelsTabProps> = ({ sectionId }) => {
  const currentSectionId = sectionId ?? 'models-visibility'

  return (
    <div className="p-4">
      {currentSectionId === 'models-visibility' && (
        <section className={UI_SECTION_STACK_CLASS}>
          <ModelSettingsPanel />
        </section>
      )}
    </div>
  )
}

export default ModelsTab
