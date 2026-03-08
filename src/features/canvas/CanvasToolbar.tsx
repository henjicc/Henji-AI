import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Lock,
  Unlock,
  Trash2,
} from 'lucide-react';
import { useReactFlow } from '@xyflow/react';

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { UiButton, UiIconButton, UiPanel } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';

interface CanvasToolbarProps {
  isLocked: boolean;
  onToggleLock: () => void;
}

export const CanvasToolbar = memo(({ isLocked, onToggleLock }: CanvasToolbarProps) => {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const addNode = useCanvasStore((state) => state.addNode);
  const clearCanvas = useCanvasStore((state) => state.clearCanvas);

  const handleAddNode = useCallback(() => {
    const x = Math.random() * 320 + 120;
    const y = Math.random() * 260 + 120;
    addNode(CANVAS_NODE_TYPES.imageEdit, { x, y });
  }, [addNode]);

  return (
    <UiPanel className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 px-2 py-1.5">
      <UiButton
        onClick={handleAddNode}
        disabled={isLocked}
        variant="primary"
        size="sm"
        className="gap-1.5 px-3"
      >
        <Plus className="h-4 w-4" />
        {t('canvas.addImage')}
      </UiButton>

      <div className="h-6 w-px bg-border-dark" />

      <UiIconButton
        onClick={() => zoomIn()}
        disabled={isLocked}
        className="h-8 w-8 border-transparent bg-transparent p-1.5"
        title={t('canvas.toolbar.zoomIn')}
      >
        <ZoomIn className="h-4 w-4 text-text-muted" />
      </UiIconButton>

      <UiIconButton
        onClick={() => zoomOut()}
        disabled={isLocked}
        className="h-8 w-8 border-transparent bg-transparent p-1.5"
        title={t('canvas.toolbar.zoomOut')}
      >
        <ZoomOut className="h-4 w-4 text-text-muted" />
      </UiIconButton>

      <UiIconButton
        onClick={() => fitView({ padding: 0.2 })}
        className="h-8 w-8 border-transparent bg-transparent p-1.5"
        title={t('canvas.toolbar.fitView')}
      >
        <Maximize2 className="h-4 w-4 text-text-muted" />
      </UiIconButton>

      <div className="h-6 w-px bg-border-dark" />

      <UiIconButton
        onClick={onToggleLock}
        className="h-8 w-8 border-transparent bg-transparent p-1.5"
        title={isLocked ? t('canvas.toolbar.unlock') : t('canvas.toolbar.lock')}
      >
        {isLocked ? <Lock className="h-4 w-4 text-accent" /> : <Unlock className="h-4 w-4 text-text-muted" />}
      </UiIconButton>

      <UiIconButton
        onClick={clearCanvas}
        disabled={isLocked}
        className="h-8 w-8 border-transparent bg-transparent p-1.5 hover:!bg-red-500/10"
        title={t('common.delete')}
      >
        <Trash2 className="h-4 w-4 text-red-500" />
      </UiIconButton>
    </UiPanel>
  );
});

CanvasToolbar.displayName = 'CanvasToolbar';
