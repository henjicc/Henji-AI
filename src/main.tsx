import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// 界面字体 Geist / Geist Mono（SIL OFL 1.1，随包离线可用；字体栈见 tailwind.config.js fontFamily）
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import { DragDropProvider } from './contexts/DragDropContext'
import GlobalContextMenuProvider from './contexts/GlobalContextMenuProvider'
import './i18n'  // 初始化 i18n
import { createLogger, initLoggerConfig } from '@/core/logging'
import { UiErrorBoundary } from '@/components/ui'
import { configureGenerationSubmissionConfirmation } from '@/core/services/generationSubmissionConfirmation'
import { requestAlertConfirmation } from '@/stores/alertDialogStore'
import { readDevelopmentLaunchOptions } from '@/core/development/developmentLaunch'
import { isSafeRendererRecovery } from '@/core/applicationLifecycle/rendererRecovery'

initLoggerConfig()
configureGenerationSubmissionConfirmation(requestAlertConfirmation)

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
const isRecordingControlView = new URLSearchParams(window.location.search).get('view') === 'recording-control'
const RecordingControlBar = React.lazy(() => import('./features/screenRecording/RecordingControlBar'))
const isRecordingFrameView = new URLSearchParams(window.location.search).get('view') === 'recording-frame'
const RecordingFrame = React.lazy(() => import('./features/screenRecording/RecordingFrame'))
const isCameraStageRenderView = new URLSearchParams(window.location.search).get('view') === 'camera-stage-render'

// 日志窗口与三维渲染窗口都只在各自的 `?view=` 分流下挂载，主窗口永远用不到。
// 静态导入会把 three/@react-three 整包压进启动 chunk，主窗口每次启动都要白解析一遍，
// 因此改为按视图懒加载：主窗口启动路径不再包含这两棵子树。
const LogsShell = React.lazy(() => import('./features/logs/LogsShell'))
const CameraStageRenderWorker = React.lazy(
  () => import('./features/cameraStage/render/CameraStageRenderWorker'),
)

const developmentLaunch = readDevelopmentLaunchOptions()
// 崩溃后的安全恢复参数在任何启动恢复之前读出并从地址里去掉，本页之后都按记下的结果判断
isSafeRendererRecovery()
// 运行时布局守卫（重要记录 020）：默认不运行，开发运行与正式版一致；`--dev-checks` 时描边，`--dev-layout-guard[=log]` 单独指定。
// 安装包不运行。按需加载，正式启动路径不含它；录制控制条、录制边框与三维渲染这些辅助窗口不跑。
const layoutGuardMode = developmentLaunch.layoutGuard ?? (developmentLaunch.checks ? 'outline' : null)
// React 严格模式（组件挂载两次、副作用跑两遍）只在开发检查时打开，默认开发运行与正式版一致
const RootChecks = developmentLaunch.checks ? React.StrictMode : React.Fragment
if (layoutGuardMode && !isRecordingControlView && !isRecordingFrameView && !isCameraStageRenderView) {
  void import('@/core/uiAudit/layoutGuard').then(({ startLayoutGuard }) => startLayoutGuard(layoutGuardMode))
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    isRecordingControlView ? (
        <React.Suspense fallback={null}><RecordingControlBar /></React.Suspense>
    ) : isRecordingFrameView ? (
        <React.Suspense fallback={null}><RecordingFrame /></React.Suspense>
    ) : isCameraStageRenderView ? (
        <React.Suspense fallback={null}>
            <CameraStageRenderWorker />
        </React.Suspense>
    ) : (
        <RootChecks>
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
        </RootChecks>
    ),
)

// 开发运行改到业务模块会整页重新加载：回到原来的工作区和文档（只在主窗口，正式版不打包）
if (import.meta.env.DEV && !isLogsView && !isRecordingControlView && !isRecordingFrameView && !isCameraStageRenderView) {
  void import('@/features/documents/developmentReloadResume').then(({ installDevelopmentReloadResume }) => installDevelopmentReloadResume())
}
