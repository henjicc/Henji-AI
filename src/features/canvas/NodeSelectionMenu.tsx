import { useMemo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Upload, Sparkles, LayoutGrid, Type, Video, AudioLines, Hash, ToggleLeft } from 'lucide-react';
import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';
import {
  UiOptionButton,
  UiPanel,
} from '@/components/ui';

import type { CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import { nodeCatalog } from '@/features/canvas/application/nodeCatalog';
import type { MenuIconKey } from '@/features/canvas/domain/nodeRegistry';

interface NodeSelectionMenuProps {
  position: { x: number; y: number };
  allowedTypes?: CanvasNodeType[];
  onSelect: (type: CanvasNodeType) => void;
  onClose: () => void;
}

const iconMap: Record<MenuIconKey, typeof Upload> = {
  upload: Upload,
  sparkles: Sparkles,
  layout: LayoutGrid,
  text: Type,
  video: Video,
  audio: AudioLines,
  number: Hash,
  toggle: ToggleLeft,
};

export function NodeSelectionMenu({
  position,
  allowedTypes,
  onSelect,
  onClose,
}: NodeSelectionMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  const allowedTypeSet = useMemo(
    () => (allowedTypes ? new Set(allowedTypes) : null),
    [allowedTypes]
  );

  const menuItems = useMemo(() => {
    const candidates = !allowedTypeSet || !allowedTypes
      ? nodeCatalog.getMenuDefinitions()
      : Array.from(new Set(allowedTypes)).map((type) => nodeCatalog.getDefinition(type));

    const dedupedByLabel = new Map<string, (typeof candidates)[number]>();
    for (const definition of candidates) {
      const existing = dedupedByLabel.get(definition.menuLabelKey);
      if (!existing) {
        dedupedByLabel.set(definition.menuLabelKey, definition);
        continue;
      }

      // Prefer user-visible definitions when multiple internal node types share the same label.
      if (!existing.visibleInMenu && definition.visibleInMenu) {
        dedupedByLabel.set(definition.menuLabelKey, definition);
      }
    }

    return Array.from(dedupedByLabel.values());
  }, [allowedTypeSet, allowedTypes]);

  useEffect(() => {
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, []);

  // 按面板实际渲染位置与窗口可视高度计算可用高度，避免菜单顶出窗口（顶出部分改为内部滚动）
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) {
      return;
    }
    const margin = 16;
    const minHeight = 160;
    const maxAllowed = 480;
    const top = node.getBoundingClientRect().top;
    const available = window.innerHeight - top - margin;
    setMaxHeight(Math.max(minHeight, Math.min(maxAllowed, available)));
  }, [position]);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(onClose, UI_POPOVER_TRANSITION_MS);
  }, [onClose]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }

      handleClose();
    };

    document.addEventListener('mousedown', onPointerDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [handleClose]);

  return (
    <UiPanel
      ref={menuRef}
      className={`
        ui-scrollbar absolute z-50 w-[240px] overflow-y-auto overflow-x-hidden p-1
        transition-opacity duration-150
        ${isVisible ? 'opacity-100' : 'opacity-0'}
      `}
      style={{ left: position.x, top: position.y, maxHeight: maxHeight ?? undefined }}
    >
      {menuItems.map((item) => {
        const Icon = iconMap[item.menuIcon] ?? Image;
        return (
          <UiOptionButton
            key={item.type}
            variant="menu"
            className="w-full gap-3 rounded-lg px-3 py-2.5 !transition-none"
            onClick={() => {
              handleClose();
              setTimeout(() => onSelect(item.type), UI_POPOVER_TRANSITION_MS + 10);
            }}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-dark">
              <Icon className="h-4 w-4 text-accent" />
            </div>
            <span className="text-sm text-text-dark">{t(item.menuLabelKey)}</span>
          </UiOptionButton>
        );
      })}
    </UiPanel>
  );
}
