import React from 'react'

import { createLogger } from '@/core/logging'

import { UiButton } from './primitives'

/**
 * 通用错误边界。**唯一实现**，各处只传标题与日志域，不要再各写一个类。
 *
 * 为什么必须有根级的一份：React 在渲染、layout effect 或卸载阶段抛出的异常，如果一路没有
 * 边界接住，会把整棵树卸载掉。用户看到的是纯黑窗口，没有任何提示，也没有任何可点的东西——
 * 实测就发生过：PromptEditor 的一个 layout effect 读到已销毁的编辑器实例抛了 TypeError，
 * 启动动画走完后整个应用直接黑屏。
 *
 * `main.tsx` 里的 window.onerror 只负责记日志，它接不住 React 的卸载，也变不出界面。
 */

interface UiErrorBoundaryProps {
  children: React.ReactNode
  /** 日志域，用于把崩溃归到具体子系统 */
  loggerDomain: string
  /** 结构化日志事件名 */
  event: string
  /** 展示给用户的一句话 */
  title: string
}

interface UiErrorBoundaryState {
  error: Error | null
}

export class UiErrorBoundary extends React.Component<UiErrorBoundaryProps, UiErrorBoundaryState> {
  state: UiErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): UiErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    createLogger(this.props.loggerDomain).error(this.props.title, {
      event: this.props.event,
      message: error.message,
      stack: error.stack ?? '',
      componentStack: info.componentStack ?? '',
    })
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-app p-6 text-center">
        <div className="text-sm text-text-muted">{this.props.title}，错误详情已写入日志</div>
        {/* 崩溃信息直接显示出来：黑屏加一句"出错了"仍然等于无从追查 */}
        <div className="max-w-xl break-words text-xs text-text-muted opacity-70">
          {this.state.error.message}
        </div>
        <UiButton onClick={() => this.setState({ error: null })}>重新加载界面</UiButton>
      </div>
    )
  }
}

export default UiErrorBoundary
