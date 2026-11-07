import { useEffect, useState, type ReactNode } from 'react';
import { PanelRightClose, PanelRightOpen, RotateCcw } from 'lucide-react';
import { UiIconButton, UiResizeHandle } from '@/components/ui';
import {
  clampImageEditorInspectorWidthToViewport,
  IMAGE_EDITOR_INSPECTOR_MAX_WIDTH,
  IMAGE_EDITOR_INSPECTOR_MIN_WIDTH,
  IMAGE_EDITOR_TOOL_RAIL_WIDTH,
  useImageEditorUiStore,
} from '../store/imageEditorUiStore';

export interface ImageEditorShellProps {
  toolbar: ReactNode;
  canvas: ReactNode;
  sidePanel: ReactNode;
  className?: string;
}

export function ImageEditorShell({ toolbar, canvas, sidePanel, className = '' }: ImageEditorShellProps): JSX.Element {
  const persistedWidth = useImageEditorUiStore((state) => state.inspectorWidth);
  const collapsed = useImageEditorUiStore((state) => state.inspectorCollapsed);
  const setInspectorWidth = useImageEditorUiStore((state) => state.setInspectorWidth);
  const setInspectorCollapsed = useImageEditorUiStore((state) => state.setInspectorCollapsed);
  const resetInspector = useImageEditorUiStore((state) => state.resetInspector);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  // 拖动中只改本地宽度，松手才写入偏好；保存的是用户拖出的宽度，显示时再按视口夹紧，窗口缩小再放大后恢复原宽度。
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const width = clampImageEditorInspectorWidthToViewport(draftWidth ?? persistedWidth, viewportWidth);
  const maxWidth = clampImageEditorInspectorWidthToViewport(IMAGE_EDITOR_INSPECTOR_MAX_WIDTH, viewportWidth);

  useEffect(() => {
    const handleViewportResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, []);

  return (
    <div className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${className}`}>
      {/* 命令带 + 从属参数带共用这一块底色与这一条 border-b,不允许在它上下再叠带 */}
      <div className="shrink-0 border-b border-gap bg-panel px-3 py-1.5">
        {toolbar}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {canvas}
        </main>
        {!collapsed && (
          <UiResizeHandle
            label="调整参数面板宽度"
            grow="start"
            value={width}
            min={IMAGE_EDITOR_INSPECTOR_MIN_WIDTH}
            max={maxWidth}
            onChange={setDraftWidth}
            onCommit={(value) => { setInspectorWidth(value); setDraftWidth(null); }}
          />
        )}
        <aside
          className="relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-gap bg-panel"
          style={{
            width: collapsed ? IMAGE_EDITOR_TOOL_RAIL_WIDTH : width,
          }}
        >
          <div className="flex h-10 shrink-0 items-center justify-end gap-1 px-1">
            <UiIconButton size="md"
              type="button"
              tooltip={collapsed ? '展开参数面板' : '折叠参数面板'}
              aria-label={collapsed ? '展开参数面板' : '折叠参数面板'}
              onClick={() => setInspectorCollapsed(!collapsed)}
            >
              {collapsed ? <PanelRightOpen  /> : <PanelRightClose  />}
            </UiIconButton>
            {!collapsed && (
              <UiIconButton size="md"
                type="button"
                tooltip="恢复面板默认值"
                aria-label="恢复面板默认值"
                onClick={resetInspector}
              >
                <RotateCcw  />
              </UiIconButton>
            )}
          </div>
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {sidePanel}
          </div>
        </aside>
      </div>
    </div>
  );
}
