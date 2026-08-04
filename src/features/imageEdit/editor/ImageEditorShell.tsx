import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { GripVertical, PanelRightClose, PanelRightOpen, RotateCcw } from 'lucide-react';
import { UiIconButton } from '@/components/ui';
import {
  clampImageEditorInspectorWidth,
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
  const [draftWidth, setDraftWidth] = useState(() => clampImageEditorInspectorWidth(persistedWidth));
  const resizeActiveRef = useRef(false);
  const draftWidthRef = useRef(draftWidth);
  draftWidthRef.current = draftWidth;

  const clampWidthToViewport = useCallback((width: number): number => {
    return clampImageEditorInspectorWidthToViewport(width, window.innerWidth);
  }, []);

  useEffect(() => {
    setDraftWidth(clampWidthToViewport(persistedWidth));
    const handleViewportResize = () => {
      setDraftWidth((previous) => clampWidthToViewport(previous));
    };
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, [clampWidthToViewport, persistedWidth]);

  const handlePointerMove = useCallback((event: globalThis.PointerEvent) => {
    if (!resizeActiveRef.current) return;
    const nextWidth = clampWidthToViewport(window.innerWidth - event.clientX);
    setDraftWidth(nextWidth);
  }, [clampWidthToViewport]);

  const stopResize = useCallback(() => {
    if (!resizeActiveRef.current) return;
    resizeActiveRef.current = false;
    setInspectorWidth(draftWidthRef.current);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
  }, [handlePointerMove, setInspectorWidth]);

  const startResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    event.preventDefault();
    resizeActiveRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  }, [collapsed, handlePointerMove, stopResize]);

  const adjustWidthByKeyboard = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? 16 : -16;
    const nextWidth = clampWidthToViewport(draftWidthRef.current + delta);
    setDraftWidth(nextWidth);
    setInspectorWidth(nextWidth);
  }, [clampWidthToViewport, setInspectorWidth]);

  useEffect(() => () => stopResize(), [stopResize]);

  return (
    <div className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${className}`}>
      {/* 命令带 + 从属参数带共用这一块底色与这一条 border-b,不允许在它上下再叠带 */}
      <div className="shrink-0 border-b border-border-dark bg-surface-dark px-2 py-1.5">
        {toolbar}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {canvas}
        </main>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整参数面板宽度"
          tabIndex={collapsed ? -1 : 0}
          onPointerDown={startResize}
          onKeyDown={adjustWidthByKeyboard}
          className={`group relative z-10 flex w-2 shrink-0 items-center justify-center ${collapsed ? 'pointer-events-none opacity-0' : 'cursor-col-resize'}`}
          style={{ touchAction: 'none' }}
        >
          <span className="h-full w-px bg-border-dark transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
          <GripVertical className="absolute h-4 w-4 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </div>
        <aside
          className="relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-border-dark bg-surface-dark"
          style={{
            width: collapsed ? IMAGE_EDITOR_TOOL_RAIL_WIDTH : draftWidth,
            minWidth: collapsed ? IMAGE_EDITOR_TOOL_RAIL_WIDTH : IMAGE_EDITOR_INSPECTOR_MIN_WIDTH,
            maxWidth: collapsed ? IMAGE_EDITOR_TOOL_RAIL_WIDTH : Math.min(IMAGE_EDITOR_INSPECTOR_MAX_WIDTH, Math.max(IMAGE_EDITOR_INSPECTOR_MIN_WIDTH, draftWidth)),
          }}
        >
          <div className="flex h-10 shrink-0 items-center justify-end gap-1 border-b border-border-dark px-1">
            <UiIconButton
              type="button"
              appearance="hover-only"
              showBorder={false}
              className="h-8 w-8"
              title={collapsed ? '展开参数面板' : '折叠参数面板'}
              aria-label={collapsed ? '展开参数面板' : '折叠参数面板'}
              onClick={() => setInspectorCollapsed(!collapsed)}
            >
              {collapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
            </UiIconButton>
            {!collapsed && (
              <UiIconButton
                type="button"
                appearance="hover-only"
                showBorder={false}
                className="h-8 w-8"
                title="恢复面板默认值"
                aria-label="恢复面板默认值"
                onClick={resetInspector}
              >
                <RotateCcw className="h-4 w-4" />
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
