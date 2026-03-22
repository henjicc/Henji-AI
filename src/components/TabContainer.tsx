import React, { Suspense, lazy } from 'react'
import { useI18n } from '@/hooks/useI18n'

// 懒加载工作区组件
const GenerationWorkspace = lazy(() => import('../workspaces/GenerationWorkspace'))
const CanvasWorkspace = lazy(() => import('../workspaces/CanvasWorkspace'))
const ToolboxPlaceholder = lazy(() => import('../workspaces/ToolboxPlaceholder'))

interface TabContainerProps {
    activeTab: string
}

// Loading 占位组件
const LoadingPlaceholder: React.FC = () => {
    const { t } = useI18n()
    return (
        <div className="flex-1 flex items-center justify-center">
            <div className="text-gray-400">{t('common:loading')}</div>
        </div>
    )
}

/**
 * Tab 工作区容器
 * 根据 activeTab 渲染对应的工作区组件
 */
const TabContainer: React.FC<TabContainerProps> = ({ activeTab }) => {
    return (
        <div className="flex-1 min-h-0 overflow-hidden pt-10">
            <Suspense fallback={<LoadingPlaceholder />}>
                {activeTab === 'generation' && <GenerationWorkspace />}
                {activeTab === 'nodes' && <CanvasWorkspace />}
                {activeTab === 'tools' && <ToolboxPlaceholder />}
            </Suspense>
        </div>
    )
}

export default TabContainer
