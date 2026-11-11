import { useEffect, useMemo } from 'react';
import { Panel, useReactFlow, useStore } from '@xyflow/react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAppMenuVisibility } from '@/components/appMenu/appMenuVisibility';
import { UiButton, UiIconButton } from '@/components/ui';
import { UI_TEXT_NUMERIC_CLASS } from '@/components/ui/styleTokens';
import { contributeAppMenus } from '@/core/appMenu/appMenu';
import { CANVAS_FIT_VIEW_OPTIONS, CANVAS_MINIMAP_Z_INDEX } from '@/features/canvas/canvasUtils';
import { useCanvasStore } from '@/stores/canvasStore';

const ZOOM_DURATION_MS = 180;

/**
 * 画布右上角的缩放条：缩小、当前比例（点一下回到 100%）、放大、适应画布。
 * 视图菜单里是同一组动作。
 */
export function CanvasZoomBar(): JSX.Element {
  const { t } = useTranslation();
  const reactFlow = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const minZoom = useStore((state) => state.minZoom);
  const maxZoom = useStore((state) => state.maxZoom);
  const hasNodes = useStore((state) => state.nodeLookup.size > 0);
  const menuVisible = useAppMenuVisibility();
  const toolOpen = useCanvasStore((state) => Boolean(state.activeToolDialog));

  const actions = useMemo(() => ({
    zoomIn: () => { void reactFlow.zoomIn({ duration: ZOOM_DURATION_MS }); },
    zoomOut: () => { void reactFlow.zoomOut({ duration: ZOOM_DURATION_MS }); },
    actualSize: () => { void reactFlow.zoomTo(1, { duration: ZOOM_DURATION_MS }); },
    fit: () => { void reactFlow.fitView({ ...CANVAS_FIT_VIEW_OPTIONS, duration: ZOOM_DURATION_MS }); },
  }), [reactFlow]);

  const atMin = zoom <= minZoom + 1e-3;
  const atMax = zoom >= maxZoom - 1e-3;
  const fitDisabledReason = hasNodes ? undefined : t('canvas.zoom.noNodes');

  useEffect(() => {
    if (!menuVisible || toolOpen) return;
    return contributeAppMenus('canvas.zoom', [{ menu: 'view', order: 100, items: [
      { kind: 'action', id: 'canvas.zoomIn', label: t('canvas.zoom.in'), disabledReason: atMax ? t('canvas.zoom.atMax') : undefined, run: actions.zoomIn },
      { kind: 'action', id: 'canvas.zoomOut', label: t('canvas.zoom.out'), disabledReason: atMin ? t('canvas.zoom.atMin') : undefined, run: actions.zoomOut },
      { kind: 'action', id: 'canvas.zoomActual', label: t('canvas.zoom.actual'), run: actions.actualSize },
      { kind: 'action', id: 'canvas.fitView', label: t('canvas.zoom.fit'), disabledReason: fitDisabledReason, run: actions.fit },
    ] }]);
  }, [menuVisible, toolOpen, actions, atMin, atMax, fitDisabledReason, t]);

  return (
    <Panel
      position="top-right"
      aria-label={t('canvas.zoom.bar')}
      className="ui-glass nopan nowheel !m-3 flex items-center gap-0.5 rounded-lg p-0.5"
      style={{ zIndex: CANVAS_MINIMAP_Z_INDEX }}
    >
      <UiIconButton size="sm" aria-label={t('canvas.zoom.out')} tooltip={t('canvas.zoom.out')} disabled={atMin} onClick={actions.zoomOut}>
        <Minus />
      </UiIconButton>
      <UiButton size="sm" className="w-14" tooltip={t('canvas.zoom.actual')} aria-label={t('canvas.zoom.actual')} onClick={actions.actualSize}>
        <span className={UI_TEXT_NUMERIC_CLASS}>{Math.round(zoom * 100)}%</span>
      </UiButton>
      <UiIconButton size="sm" aria-label={t('canvas.zoom.in')} tooltip={t('canvas.zoom.in')} disabled={atMax} onClick={actions.zoomIn}>
        <Plus />
      </UiIconButton>
      <UiIconButton size="sm" aria-label={t('canvas.zoom.fit')} tooltip={t('canvas.zoom.fit')} disabledReason={fitDisabledReason} disabled={!hasNodes} onClick={actions.fit}>
        <Maximize />
      </UiIconButton>
    </Panel>
  );
}
