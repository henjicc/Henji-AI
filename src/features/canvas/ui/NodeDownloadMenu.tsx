import type { RefObject } from 'react';
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
  downloadPresetPaths,
  saveAsLabel,
  noPresetHintLabel,
  onSaveAs,
  onSaveToPreset,
}: NodeDownloadMenuProps): JSX.Element | null {
  if (!menu) {
    return null;
  }

  return (
    <UiPanel
      ref={menuRef}
      /* 菜单弹在画布/图片节点之上，背后是用户内容，走玻璃材质；条目 hover 必须用白纱 */
      variant="glass"
      className={`fixed z-dropdown min-w-[280px] p-2 transition-opacity duration-150 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
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
    </UiPanel>
  );
}
