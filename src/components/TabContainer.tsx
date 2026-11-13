import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useI18n } from '@/hooks/useI18n'
import type { WorkspaceId } from '@/core/types/workspace'
import { UiLoading } from '@/components/ui'
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary'
import { UI_DURATION } from '@/components/ui/motion'
import { useUiPrimaryBudget } from '@/components/ui/actionPriority'
import { prefetchWhenIdle } from '@/utils/idlePrefetch'
import { listPrefetchOrder, workspaceLoaders } from '../workspaces/workspaceLoaders'
import { AppMenuVisibilityContext } from './appMenu/appMenuVisibility'
import { AgentEditingGuard } from '@/features/application-control/AgentEditingGuard'

// 懒加载工作区组件（loader 复用 workspaceLoaders，保证与空闲预取命中同一份模块缓存）
const GenerationWorkspace = lazy(workspaceLoaders.generation)
const CanvasWorkspace = lazy(workspaceLoaders.nodes)
const VideoEditWorkspace = lazy(workspaceLoaders.videoEdit)
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
    const workspaceRef = useRef<HTMLDivElement>(null)
    useUiPrimaryBudget(containerRef)

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

    // 工作区外壳只裁切、永不滚动：停靠面板把未显示面板的内容层停在面板区之外，overflow-hidden
    // 仍允许拖放自动滚动、scrollIntoView 和聚焦把整个工作区顶上去；overflow-clip 连程序滚动也禁止。
    return (
        <div
            ref={containerRef}
            data-ui-workspace-inset-root
            className="flex-1 min-h-0 overflow-clip pt-10 transition-[padding]"
            style={{
                paddingLeft: insetLeft,
                paddingRight: insetRight,
                transitionDuration: `var(--assistant-layout-transition-duration, ${UI_DURATION.base}ms)`,
            }}
        >
            <div ref={workspaceRef} className="relative h-full">
                {visitedTabs.has('generation') && (
                    <div data-application-surface-id="workspace.generation" className={activeTab === 'generation' ? 'h-full' : 'hidden'}>
                        <WorkspaceErrorBoundary surfaceId="workspace.generation"><Suspense fallback={<LoadingPlaceholder />}>
                            <AppMenuVisibilityContext.Provider value={activeTab === 'generation'}><GenerationWorkspace /></AppMenuVisibilityContext.Provider>
                        </Suspense></WorkspaceErrorBoundary>
                    </div>
                )}
                {visitedTabs.has('nodes') && (
                    <div data-application-surface-id="workspace.canvas" className={activeTab === 'nodes' ? 'h-full' : 'hidden'}>
                        <WorkspaceErrorBoundary surfaceId="workspace.canvas"><Suspense fallback={<LoadingPlaceholder />}>
                            <AppMenuVisibilityContext.Provider value={activeTab === 'nodes'}><CanvasWorkspace /></AppMenuVisibilityContext.Provider>
                        </Suspense></WorkspaceErrorBoundary>
                    </div>
                )}
                {visitedTabs.has('tools') && (
                    <div data-application-surface-id="workspace.tools" className={activeTab === 'tools' ? 'h-full' : 'hidden'}>
                        <WorkspaceErrorBoundary surfaceId="workspace.tools"><Suspense fallback={<LoadingPlaceholder />}>
                            <AppMenuVisibilityContext.Provider value={activeTab === 'tools'}><ToolboxWorkspace /></AppMenuVisibilityContext.Provider>
                        </Suspense></WorkspaceErrorBoundary>
                    </div>
                )}
                {activeTab === 'videoEdit' && (
                    <div data-application-surface-id="workspace.video_edit" className="h-full">
                        <WorkspaceErrorBoundary surfaceId="workspace.video_edit"><Suspense fallback={<LoadingPlaceholder />}><VideoEditWorkspace /></Suspense></WorkspaceErrorBoundary>
                    </div>
                )}
                {visitedTabs.has('assets') && (
                    <div data-application-surface-id="workspace.assets" className={activeTab === 'assets' ? 'h-full' : 'hidden'}>
                        <WorkspaceErrorBoundary surfaceId="workspace.assets"><Suspense fallback={<LoadingPlaceholder />}>
                            <AppMenuVisibilityContext.Provider value={activeTab === 'assets'}><AssetLibraryWorkspace /></AppMenuVisibilityContext.Provider>
                        </Suspense></WorkspaceErrorBoundary>
                    </div>
                )}
                <AgentEditingGuard containerRef={workspaceRef} />
            </div>
        </div>
    )
}

export default TabContainer
