import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './styles/scrollbar.css'
import { DragDropProvider } from './contexts/DragDropContext'
import GlobalContextMenuProvider from './contexts/GlobalContextMenuProvider'
import './i18n'  // 初始化 i18n
import { createLogger, initLoggerConfig } from '@/core/logging'
import { UiErrorBoundary } from '@/components/ui'

initLoggerConfig()

// 渲染层全局兜底错误捕获：未捕获异常/未处理拒绝此前不落日志，界面白屏时无从追查。
// 只记录，不吞错——异常仍按浏览器默认行为继续传播。
const crashLogger = createLogger('app.errors')
window.addEventListener('error', (event) => {
  if (/^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)\.?$/i.test(event.message.trim())) {
    // 浏览器为避免单帧内尺寸回调自激而把剩余通知延后；它不是组件异常，也不会导致白屏。
    // 作为 crash 记录会让真实界面巡检与用户日志产生大量假红。
    event.preventDefault()
    return
  }
  crashLogger.error('渲染层未捕获异常', {
    event: 'app.uncaught_error.captured',
    message: event.message,
    source: `${event.filename ?? ''}:${event.lineno ?? 0}:${event.colno ?? 0}`,
    stack: event.error instanceof Error ? event.error.stack ?? '' : String(event.error ?? ''),
  })
})
window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason
  crashLogger.error('渲染层未处理的 Promise 拒绝', {
    event: 'app.unhandled_rejection.captured',
    stack: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
  })
})

// 独立日志窗口（2.1）与主界面共用同一份渲染产物，通过 `?view=logs` 查询参数在入口处分流：
// 日志窗口只渲染精简的 `LogsShell`，不挂载主界面相关的拖拽/右键菜单等全局 Provider。
const isLogsView = new URLSearchParams(window.location.search).get('view') === 'logs'
const isCameraStageRenderView = new URLSearchParams(window.location.search).get('view') === 'camera-stage-render'

// 日志窗口与三维渲染窗口都只在各自的 `?view=` 分流下挂载，主窗口永远用不到。
// 静态导入会把 three/@react-three 整包压进启动 chunk，主窗口每次启动都要白解析一遍，
// 因此改为按视图懒加载：主窗口启动路径不再包含这两棵子树。
const LogsShell = React.lazy(() => import('./features/logs/LogsShell'))
const CameraStageRenderWorker = React.lazy(
  () => import('./features/cameraStage/render/CameraStageRenderWorker'),
)

ReactDOM.createRoot(document.getElementById('root')!).render(
    isCameraStageRenderView ? (
        <React.Suspense fallback={null}>
            <CameraStageRenderWorker />
        </React.Suspense>
    ) : (
        <React.StrictMode>
            {isLogsView ? (
                <React.Suspense fallback={null}>
                    <LogsShell />
                </React.Suspense>
            ) : (
                // 根级错误边界：没有它时，任意组件在渲染或 layout effect 里抛出的异常
                // 都会把整棵树卸载成一个纯黑窗口，用户既看不到原因也无处可点。
                <UiErrorBoundary
                    loggerDomain="app.root"
                    event="app.ui.crashed"
                    title="界面出现异常"
                >
                    <GlobalContextMenuProvider>
                        <DragDropProvider>
                            <App />
                        </DragDropProvider>
                    </GlobalContextMenuProvider>
                </UiErrorBoundary>
            )}
        </React.StrictMode>
    ),
)
