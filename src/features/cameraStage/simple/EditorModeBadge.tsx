import React from 'react'
import { UiButton } from '@/components/ui'
import { useCameraStageStore } from '../store/cameraStageStore'

/** 顶栏工程模式标识；简易转专业入口由 3.2 接入单向烘焙。 */
const EditorModeBadge: React.FC = () => {
  const editorMode = useCameraStageStore((state) => state.editorMode)

  return (
    <div className="flex items-center gap-1.5">
      <span className="rounded-md border border-border-dark bg-layer px-2 py-1 text-xs text-text-muted">
        {editorMode === 'simple' ? '简易' : '专业'}
      </span>
      {editorMode === 'simple' && (
        <UiButton
          size="sm"
          variant="ghost"
          disabled
          title="转为专业工程将在后续阶段开放"
          className="h-6 border-0 px-1.5 text-xs"
        >
          转为专业工程
        </UiButton>
      )}
    </div>
  )
}

export default EditorModeBadge
