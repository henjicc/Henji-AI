import React, { Suspense, lazy, useEffect, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'

// 懒加载工作区组件
const GenerationWorkspace = lazy(() => import('../workspaces/GenerationWorkspace'))
const CanvasWorkspace = lazy(() => import('../workspaces/CanvasWorkspace'))
const ToolboxWorkspace = lazy(() => import('../workspaces/ToolboxWorkspace'))

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
 * 每个工作区首次激活后保持挂载，切换 Tab 只用 CSS 隐藏非激活项，
 * 避免反复卸载/重建组件树（DOM、图片、ReactFlow 实例等）导致的切换延迟。
 * 每个工作区使用独立 Suspense 边界，避免某个 Tab 首次懒加载时影响已挂载的其他 Tab。
 */
const TabContainer: React.FC<TabContainerProps> = ({ activeTab }) => {
    const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([activeTab]))

    useEffect(() => {
        if (!visitedTabs.has(activeTab)) {
            setVisitedTabs((prev) => new Set(prev).add(activeTab))
        }
    }, [activeTab, visitedTabs])

    return (
        <div className="flex-1 min-h-0 overflow-hidden pt-10">
            {visitedTabs.has('generation') && (
                <div className={activeTab === 'generation' ? 'h-full' : 'hidden'}>
                    <Suspense fallback={<LoadingPlaceholder />}>
                        <GenerationWorkspace />
                    </Suspense>
                </div>
            )}
            {visitedTabs.has('nodes') && (
                <div className={activeTab === 'nodes' ? 'h-full' : 'hidden'}>
                    <Suspense fallback={<LoadingPlaceholder />}>
                        <CanvasWorkspace />
                    </Suspense>
                </div>
            )}
            {visitedTabs.has('tools') && (
                <div className={activeTab === 'tools' ? 'h-full' : 'hidden'}>
                    <Suspense fallback={<LoadingPlaceholder />}>
                        <ToolboxWorkspace />
                    </Suspense>
                </div>
            )}
        </div>
    )
}

export default TabContainer
