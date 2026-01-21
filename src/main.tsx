import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './styles/scrollbar.css'
import { DragDropProvider } from './contexts/DragDropContext'
import GlobalContextMenuProvider from './contexts/GlobalContextMenuProvider'
import './i18n'  // 初始化 i18n

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <GlobalContextMenuProvider>
            <DragDropProvider>
                <App />
            </DragDropProvider>
        </GlobalContextMenuProvider>
    </React.StrictMode>,
)
