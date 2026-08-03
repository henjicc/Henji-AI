import React from 'react'

import { UiErrorBoundary } from '@/components/ui'

/**
 * 3D 镜头参考的错误边界，复用通用实现，只提供本子系统的日志域与文案。
 *
 * 这里不再自己写一个 class：错误边界的行为（记结构化日志、显示原因、给重载入口）
 * 是全局一致的要求，两份实现迟早在其中一份补了东西之后分叉。
 */
export function CameraStageErrorBoundary({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <UiErrorBoundary
      loggerDomain="features.cameraStage.app"
      event="camera_stage.ui.crashed"
      title="3D 镜头参考界面出现异常"
    >
      {children}
    </UiErrorBoundary>
  )
}

export default CameraStageErrorBoundary
