import { useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { resolveFloatingPanelPosition, type FloatingPanelPosition } from '@/components/ui/floatingPanelPosition';
import { Download, FolderOpen } from 'lucide-react';
import { UI_GLASS_ITEM_HOVER_CLASS, UI_TEXT_META_CLASS, UiOptionButton, UiPanel } from '@/components/ui';

interface DownloadMenuPosition {
  x: number;
  y: number;
}

interface NodeDownloadMenuProps {
  menu: DownloadMenuPosition | null;
  isVisible: boolean;
  menuRef: RefObject<HTMLDivElement>;
  boundaryRef: RefObject<HTMLDivElement>;
  downloadPresetPaths: string[];
  saveAsLabel: string;
  noPresetHintLabel: string;
  onSaveAs: () => void;
  onSaveToPreset: (path: string) => void;
}

export function NodeDownloadMenu({
  menu,
  isVisible,
  menuRef,
  boundaryRef,
  downloadPresetPaths,
  saveAsLabel,
  noPresetHintLabel,
  onSaveAs,
  onSaveToPreset,
}: NodeDownloadMenuProps): JSX.Element | null {
  const [position, setPosition] = useState<FloatingPanelPosition | null>(null);
  useLayoutEffect(() => {
    if (!menu) return;
    const boundary = boundaryRef.current?.closest('.react-flow__renderer');
    const update = () => {
      setPosition(resolveFloatingPanelPosition({
        anchor: { left: menu.x, top: menu.y, bottom: menu.y, width: 0 },
        panelWidth: 280, panelHeight: menuRef.current?.scrollHeight ?? 0,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
        preferredPlacement: 'below', horizontalAlign: 'left', gap: 8,
        viewportGutter: 12, viewportTopInset: 48,
        boundary: boundary?.getBoundingClientRect(),
      }));
    };
    update();
    const observer = new ResizeObserver(update);
    if (boundary) observer.observe(boundary);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, [menu, menuRef, boundaryRef, downloadPresetPaths]);

  if (!menu) {
    return null;
  }

  return createPortal(
    <UiPanel
      ref={menuRef}
      /* 菜单弹在画布/图片节点之上，背后是用户内容，走玻璃材质；条目 hover 必须用白纱 */
      variant="glass"
      className={`fixed z-dropdown ui-scrollbar overflow-y-auto overscroll-contain p-2 transition-opacity duration-150 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      data-node-download-menu
      style={{ left: position?.left, top: position?.top, width: position?.width ?? 280, maxHeight: position?.maxHeight, visibility: position ? 'visible' : 'hidden' }}
    >
      <UiOptionButton
        type="button"
        variant="menu"
        className={`h-9 w-full gap-2 text-sm ${UI_GLASS_ITEM_HOVER_CLASS}`}
        onClick={onSaveAs}
      >
        <Download className="h-4 w-4" />
        {saveAsLabel}
      </UiOptionButton>

      {downloadPresetPaths.length > 0 ? (
        <div className="mt-1 space-y-1 border-t border-veil-subtle pt-2">
          {downloadPresetPaths.map((path) => (
            <UiOptionButton
              key={path}
              type="button"
              variant="menu"
              className={`h-9 w-full gap-2 text-xs ${UI_GLASS_ITEM_HOVER_CLASS}`}
              onClick={() => {
                onSaveToPreset(path);
              }}
              title={path}
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <span className="truncate">{path}</span>
            </UiOptionButton>
          ))}
        </div>
      ) : (
        <div className={`mt-1 border-t border-veil-subtle px-2.5 pt-2 ${UI_TEXT_META_CLASS}`}>
          {noPresetHintLabel}
        </div>
      )}
    </UiPanel>,
    document.body
  );
}
