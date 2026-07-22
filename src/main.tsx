import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './styles/scrollbar.css'
import { DragDropProvider } from './contexts/DragDropContext'
import GlobalContextMenuProvider from './contexts/GlobalContextMenuProvider'
import './i18n'  // 初始化 i18n
import { createLogger, initLoggerConfig } from '@/core/logging'

initLoggerConfig()

// 渲染层全局兜底错误捕获：未捕获异常/未处理拒绝此前不落日志，界面白屏时无从追查。
// 只记录，不吞错——异常仍按浏览器默认行为继续传播。
const crashLogger = createLogger('app.errors')
window.addEventListener('error', (event) => {
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
const isPromptEditorPrototypeView = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('view') === 'prompt-editor-prototype'

// 日志窗口与三维渲染窗口都只在各自的 `?view=` 分流下挂载，主窗口永远用不到。
// 静态导入会把 three/@react-three 整包压进启动 chunk，主窗口每次启动都要白解析一遍，
// 因此改为按视图懒加载：主窗口启动路径不再包含这两棵子树。
const LogsShell = React.lazy(() => import('./features/logs/LogsShell'))
const CameraStageRenderWorker = React.lazy(
  () => import('./features/cameraStage/render/CameraStageRenderWorker'),
)
const PromptEditorPrototypeView = import.meta.env.DEV
  ? React.lazy(() => import('./components/ui/PromptEditor/prototype/PromptEditorPrototypeView'))
  : null

ReactDOM.createRoot(document.getElementById('root')!).render(
    isCameraStageRenderView ? (
        <React.Suspense fallback={null}>
            <CameraStageRenderWorker />
        </React.Suspense>
    ) : isPromptEditorPrototypeView && PromptEditorPrototypeView ? (
        <React.Suspense fallback={null}>
            <PromptEditorPrototypeView />
        </React.Suspense>
    ) : (
        <React.StrictMode>
            {isLogsView ? (
                <React.Suspense fallback={null}>
                    <LogsShell />
                </React.Suspense>
            ) : (
                <GlobalContextMenuProvider>
                    <DragDropProvider>
                        <App />
                    </DragDropProvider>
                </GlobalContextMenuProvider>
            )}
        </React.StrictMode>
    ),
)
