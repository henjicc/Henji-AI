import React from 'react'
import ModelSettingsPanel from '../../ModelSettingsPanel'

interface ModelsTabProps {
  sectionId?: string
}

const ModelsTab: React.FC<ModelsTabProps> = ({ sectionId }) => {
  const currentSectionId = sectionId ?? 'models-visibility'

  return (
    <div className="p-4">
      {currentSectionId === 'models-visibility' && (
        <section className="space-y-5">
          <ModelSettingsPanel />
        </section>
      )}
    </div>
  )
}

export default ModelsTab
