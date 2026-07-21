import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import LogsShell from './features/logs/LogsShell'
import CameraStageRenderWorker from './features/cameraStage/render/CameraStageRenderWorker'
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

ReactDOM.createRoot(document.getElementById('root')!).render(
    isCameraStageRenderView ? (
        <CameraStageRenderWorker />
    ) : (
        <React.StrictMode>
            {isLogsView ? (
                <LogsShell />
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
