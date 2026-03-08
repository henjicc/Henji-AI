import type { RefObject } from 'react';
import { Download, FolderOpen } from 'lucide-react';
import { UiOptionButton, UiPanel } from '@/components/ui';

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
      className={`fixed z-[120] min-w-[280px] p-2 transition-opacity duration-150 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
    >
      <UiOptionButton
        type="button"
        className="h-9 w-full gap-2 text-sm"
        onClick={onSaveAs}
      >
        <Download className="h-4 w-4" />
        {saveAsLabel}
      </UiOptionButton>

      {downloadPresetPaths.length > 0 ? (
        <div className="mt-1 space-y-1 border-t border-[rgba(255,255,255,0.1)] pt-2">
          {downloadPresetPaths.map((path) => (
            <UiOptionButton
              key={path}
              type="button"
              className="h-9 w-full gap-2 text-xs"
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
        <div className="mt-1 border-t border-[rgba(255,255,255,0.1)] px-2.5 pt-2 text-xs text-text-muted">
          {noPresetHintLabel}
        </div>
      )}
    </UiPanel>
  );
}
