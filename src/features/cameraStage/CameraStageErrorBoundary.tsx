import React from 'react'
import { UiButton } from '@/components/ui'
import { createLogger } from '@/core/logging'

/**
 * 3D 镜头参考错误边界：子树渲染/卸载阶段的未捕获异常在此兜底——记录结构化日志并给出
 * 可恢复界面，避免异常沿 React 根一路卸载导致整个应用白屏且无迹可查。
 */

const logger = createLogger('features.cameraStage.app')

interface CameraStageErrorBoundaryProps {
  children: React.ReactNode
}

interface CameraStageErrorBoundaryState {
  error: Error | null
}

class CameraStageErrorBoundary extends React.Component<
  CameraStageErrorBoundaryProps,
  CameraStageErrorBoundaryState
> {
  state: CameraStageErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): CameraStageErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logger.error('3D 镜头参考界面崩溃', {
      event: 'camera_stage.ui.crashed',
      message: error.message,
      stack: error.stack ?? '',
      componentStack: info.componentStack ?? '',
    })
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-app">
        <div className="text-sm text-text-muted">3D 镜头参考界面出现异常，错误详情已写入日志</div>
        <UiButton onClick={() => this.setState({ error: null })}>重新加载界面</UiButton>
      </div>
    )
  }
}

export default CameraStageErrorBoundary
