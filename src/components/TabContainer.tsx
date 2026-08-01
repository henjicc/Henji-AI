import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useI18n } from '@/hooks/useI18n'
import type { WorkspaceId } from '@/core/types/workspace'
import { UiLoading } from '@/components/ui'
import { prefetchWhenIdle } from '@/utils/idlePrefetch'
import { listPrefetchOrder, workspaceLoaders } from '../workspaces/workspaceLoaders'

// 懒加载工作区组件（loader 复用 workspaceLoaders，保证与空闲预取命中同一份模块缓存）
const GenerationWorkspace = lazy(workspaceLoaders.generation)
const CanvasWorkspace = lazy(workspaceLoaders.nodes)
const ToolboxWorkspace = lazy(workspaceLoaders.tools)
const AssetLibraryWorkspace = lazy(workspaceLoaders.assets)

interface TabContainerProps {
    activeTab: WorkspaceId
    containerRef: RefObject<HTMLDivElement>
    insetLeft?: number
    insetRight?: number
}

const LoadingPlaceholder: React.FC = () => {
    const { t } = useI18n()
    return <UiLoading className="h-full" message={t('common:loading')} />
}

/**
 * Tab 工作区容器
 * 每个工作区首次激活后保持挂载，切换 Tab 只用 CSS 隐藏非激活项，
 * 避免反复卸载/重建组件树（DOM、图片、ReactFlow 实例等）导致的切换延迟。
 * 每个工作区使用独立 Suspense 边界，避免某个 Tab 首次懒加载时影响已挂载的其他 Tab。
 */
const TabContainer: React.FC<TabContainerProps> = ({ containerRef, activeTab, insetLeft = 0, insetRight = 0 }) => {
    const [visitedTabs, setVisitedTabs] = useState<Set<WorkspaceId>>(() => new Set([activeTab]))
    const initialTabRef = useRef(activeTab)

    useEffect(() => {
        if (!visitedTabs.has(activeTab)) {
            setVisitedTabs((prev) => new Set(prev).add(activeTab))
        }
    }, [activeTab, visitedTabs])

    // 首屏渲染完成后利用空闲时间把其它工作区的 chunk 拉回来，
    // 让「第一次切 Tab」不再等模块下载/转译。只跑一次，不随 activeTab 重启。
    useEffect(() => prefetchWhenIdle(listPrefetchOrder(initialTabRef.current), {
        strategy: 'idle',
        startDelayMs: import.meta.env.DEV ? 15000 : 0,
    }), [])

    return (
        <div
            ref={containerRef}
            data-ui-workspace-inset-root
            className="flex-1 min-h-0 overflow-hidden pt-10 transition-[padding]"
            style={{
                paddingLeft: insetLeft,
                paddingRight: insetRight,
                transitionDuration: 'var(--assistant-layout-transition-duration, 200ms)',
            }}
        >
            {visitedTabs.has('generation') && (
                <div data-application-surface-id="workspace.generation" className={activeTab === 'generation' ? 'h-full' : 'hidden'}>
                    <Suspense fallback={<LoadingPlaceholder />}>
                        <GenerationWorkspace />
                    </Suspense>
                </div>
            )}
            {visitedTabs.has('nodes') && (
                <div data-application-surface-id="workspace.canvas" className={activeTab === 'nodes' ? 'h-full' : 'hidden'}>
                    <Suspense fallback={<LoadingPlaceholder />}>
                        <CanvasWorkspace />
                    </Suspense>
                </div>
            )}
            {visitedTabs.has('tools') && (
                <div data-application-surface-id="workspace.tools" className={activeTab === 'tools' ? 'h-full' : 'hidden'}>
                    <Suspense fallback={<LoadingPlaceholder />}>
                        <ToolboxWorkspace />
                    </Suspense>
                </div>
            )}
            {visitedTabs.has('assets') && (
                <div data-application-surface-id="workspace.assets" className={activeTab === 'assets' ? 'h-full' : 'hidden'}>
                    <Suspense fallback={<LoadingPlaceholder />}>
                        <AssetLibraryWorkspace />
                    </Suspense>
                </div>
            )}
        </div>
    )
}

export default TabContainer
