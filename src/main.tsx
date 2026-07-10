import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import LogsShell from './features/logs/LogsShell'
import './index.css'
import './styles/scrollbar.css'
import { DragDropProvider } from './contexts/DragDropContext'
import GlobalContextMenuProvider from './contexts/GlobalContextMenuProvider'
import './i18n'  // 初始化 i18n
import { initLoggerConfig } from '@/core/logging'

initLoggerConfig()

// 独立日志窗口（2.1）与主界面共用同一份渲染产物，通过 `?view=logs` 查询参数在入口处分流：
// 日志窗口只渲染精简的 `LogsShell`，不挂载主界面相关的拖拽/右键菜单等全局 Provider。
const isLogsView = new URLSearchParams(window.location.search).get('view') === 'logs'

ReactDOM.createRoot(document.getElementById('root')!).render(
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
    </React.StrictMode>,
)
