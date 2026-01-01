import React, { Suspense, lazy } from 'react'

// 懒加载工作区组件
const ConversationWorkspace = lazy(() => import('../workspaces/ConversationWorkspace'))
const CanvasPlaceholder = lazy(() => import('../workspaces/CanvasPlaceholder'))
const ToolboxPlaceholder = lazy(() => import('../workspaces/ToolboxPlaceholder'))

interface TabContainerProps {
    activeTab: string
}

// Loading 占位组件
const LoadingPlaceholder: React.FC = () => (
    <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
    </div>
)

/**
 * Tab 工作区容器
 * 根据 activeTab 渲染对应的工作区组件
 */
const TabContainer: React.FC<TabContainerProps> = ({ activeTab }) => {
    return (
        <div className="flex-1 overflow-hidden" style={{ marginTop: '40px' }}>
            <Suspense fallback={<LoadingPlaceholder />}>
                {activeTab === 'conversation' && <ConversationWorkspace />}
                {activeTab === 'nodes' && <CanvasPlaceholder />}
                {activeTab === 'tools' && <ToolboxPlaceholder />}
            </Suspense>
        </div>
    )
}

export default TabContainer
