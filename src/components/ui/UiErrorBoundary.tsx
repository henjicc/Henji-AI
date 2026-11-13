import React from 'react'

import { createLogger } from '@/core/logging'

import { UiError } from './states'

/**
 * 通用错误边界。**唯一实现**，各处只传标题与日志域，不要再各写一个类。
 *
 * 为什么必须有根级的一份：React 在渲染、layout effect 或卸载阶段抛出的异常，如果一路没有
 * 边界接住，会把整棵树卸载掉。用户看到的是纯黑窗口，没有任何提示，也没有任何可点的东西——
 * 实测就发生过：PromptEditor 的一个 layout effect 读到已销毁的编辑器实例抛了 TypeError，
 * 启动动画走完后整个应用直接黑屏。
 *
 * 根级之外，每个工作区、浮层与停靠面板各包一层（`scope`）：一处渲染出错只换掉那一块，
 * 标题栏、工作区导航、助手和其他工作区照常可用。重新加载只重新挂载这一块；文档、撤销栈与
 * 录音都在组件之外的正式实例里，重新挂载后原样接回。
 *
 * `main.tsx` 里的 window.onerror 只负责记日志，它接不住 React 的卸载，也变不出界面。
 */

/** 出错的范围：决定缺省文案、按钮名与兜底区域是否自带窗口底色。 */
export type UiErrorBoundaryScope = 'app' | 'workspace' | 'panel'

const SCOPE_COPY: Record<UiErrorBoundaryScope, { title: string; message: string; retryLabel: string; frame: string }> = {
  app: { title: '界面出现异常', message: '错误已写入日志，可以先重新加载界面。', retryLabel: '重新加载界面', frame: 'bg-window p-6' },
  workspace: { title: '这个工作区出了问题', message: '错误已写入日志，重新加载后可以接着做。', retryLabel: '重新加载工作区', frame: 'p-6' },
  // 工作区与面板兜底不铺底色：沿用所在区域的表面，不在玻璃浮层或面板里再叠一层实底
  panel: { title: '这个面板出了问题', message: '错误已写入日志，其他地方照常可用。', retryLabel: '重新加载面板', frame: 'p-4' },
}

interface UiErrorBoundaryFallbackContext {
  error: Error
  retry: () => void
}

interface UiErrorBoundaryProps {
  children: React.ReactNode
  /** 日志域，用于把崩溃归到具体子系统 */
  loggerDomain: string
  /** 结构化日志事件名 */
  event: string
  /** 出错范围，缺省 `app` */
  scope?: UiErrorBoundaryScope
  /** 展示给用户的一句话；不传时按 `scope` 取缺省标题 */
  title?: string
  /** 一并写进日志的定位字段（工作区、面板标识等） */
  logFields?: Readonly<Record<string, string>>
  /** 重试之外的离开动作（如返回工具箱），放在重试按钮前 */
  actions?: React.ReactNode
  /** 任一值变化后清除已捕获错误，用于切换文档或重新载入权威快照。 */
  resetKeys?: readonly unknown[]
  /** 用户主动重试时调用；错误状态会先被清除。 */
  onReset?: () => void
  /** 子系统可提供局部恢复界面，但不得再实现另一套 ErrorBoundary。 */
  fallback?: React.ReactNode | ((context: UiErrorBoundaryFallbackContext) => React.ReactNode)
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
    const scope = this.props.scope ?? 'app'
    createLogger(this.props.loggerDomain).error(this.props.title ?? SCOPE_COPY[scope].title, {
      event: this.props.event,
      scope,
      ...this.props.logFields,
      message: error.message,
      stack: error.stack ?? '',
      componentStack: info.componentStack ?? '',
    })
  }

  componentDidUpdate(previousProps: UiErrorBoundaryProps): void {
    if (!this.state.error || !this.props.resetKeys) return
    const previous = previousProps.resetKeys ?? []
    const current = this.props.resetKeys
    const changed = previous.length !== current.length
      || current.some((value, index) => !Object.is(value, previous[index]))
    if (changed) this.setState({ error: null })
  }

  private readonly retry = (): void => {
    this.props.onReset?.()
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback({ error: this.state.error, retry: this.retry })
        : this.props.fallback
    }
    const copy = SCOPE_COPY[this.props.scope ?? 'app']
    return (
      <div className={`flex h-full w-full items-center justify-center ${copy.frame}`}>
        <UiError
          title={this.props.title ?? copy.title}
          message={copy.message}
          // 原始信息放进可复制的详情：只写"出错了"等于无从追查，但原始信息不当正文
          detail={this.state.error.message}
          actions={this.props.actions}
          onRetry={this.retry}
          retryLabel={copy.retryLabel}
          size={this.props.scope === 'panel' ? 'sm' : 'md'}
        />
      </div>
    )
  }
}
