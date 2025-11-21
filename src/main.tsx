import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './styles/scrollbar.css'
import { DragDropProvider } from './contexts/DragDropContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <DragDropProvider>
            <App />
        </DragDropProvider>
    </React.StrictMode>,
)
