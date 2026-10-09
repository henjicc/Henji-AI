import { createElement } from 'react'
import type { ToolboxToolEntry, ToolboxToolProps } from '../../toolboxRuntime'

export default {
  loadComponent: async () => {
    const { default: CameraStageApp } = await import('@/features/cameraStage/CameraStageApp')
    return { default: ({ onBack }: ToolboxToolProps) => createElement(CameraStageApp, { onBackToToolbox: onBack }) }
  },
  openRecentFile: async (id) => {
    const { openCameraStageDocument } = await import('@/features/cameraStage/projects/cameraStageProjectService')
    await openCameraStageDocument({ id })
  },
} satisfies ToolboxToolEntry
