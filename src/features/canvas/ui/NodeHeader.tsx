import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useInternalNode, useNodeId, useStoreApi, ViewportPortal } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import {
  UI_COLOR_ACCENT_TEXT_CLASS,
  UI_FIELD_FOCUS_CLASS,
  UI_FIELD_SURFACE_CLASS,
  UiButton,
  UiInput,
} from '@/components/ui';
import { useCanvasExecutionStateStore } from '@/stores/canvasExecutionStateStore';

type HeaderAdjust = {
  x?: number;
  y?: number;
  scale?: number;
};

type NodeHeaderProps = {
  icon?: ReactNode;
  titleText?: string;
  metaText?: string;
  title?: ReactNode;
  meta?: ReactNode;
  subtitle?: ReactNode;
  rightSlot?: ReactNode;
  className?: string;
  iconClassName?: string;
  toneClassName?: string;
  titleClassName?: string;
  metaClassName?: string;
  titleRowClassName?: string;
  subtitleClassName?: string;
  headerAdjust?: HeaderAdjust;
  iconAdjust?: HeaderAdjust;
  titleAdjust?: HeaderAdjust;
  rightSlotAdjust?: HeaderAdjust;
  editable?: boolean;
  onTitleChange?: (value: string) => void;
};

// 统一控制点：所有节点的"图标+名称"整体相对于节点的位置微调。
// 只改这一处数值即可同时影响全部节点；x/y 单位为 px，scale 为缩放比例。
export const NODE_HEADER_ICON_TITLE_ADJUST: HeaderAdjust = { x: -8, y: 8, scale: 1 };
// 统一控制点：所有节点右上角价格徽标（PriceEstimate）相对于节点的位置微调。
// 只改这一处数值即可同时影响全部节点；x/y 单位为 px，scale 为缩放比例。
export const NODE_HEADER_PRICE_ADJUST: HeaderAdjust = { x: -8, y: 0, scale: 1 };

export const NODE_HEADER_TONE_CLASS = 'text-white/55';
export const NODE_HEADER_TITLE_CLASS = 'text-14 font-normal';
export const NODE_HEADER_META_CLASS = 'text-xs text-text-muted';
export const NODE_HEADER_FLOATING_POSITION_CLASS = 'absolute -top-8 left-2 right-2 z-20';
// 标题不再用 max-w-[60%] 限宽：百分比宽度作用在"宽度由内容撑出"的祖先链上时
// 解析不稳定（浏览器常把它解析成一个很小的值），改用逐层 min-w-0 + flex-1 的
// flex 分配方式，宽度始终由实际可用空间精确推算，不依赖任何百分比。
const NODE_HEADER_TITLE_FLEX_CLASS = 'min-w-0 flex-1';
// 纯透明度遮罩，颜色值无意义，使用关键字避免颜色字面量
const NODE_HEADER_TITLE_FADE_STYLE: CSSProperties = {
  WebkitMaskImage: 'linear-gradient(to right, black 0%, black 82%, transparent 100%)',
  maskImage: 'linear-gradient(to right, black 0%, black 82%, transparent 100%)',
};

function composeTransformStyle(adjust?: HeaderAdjust): CSSProperties | undefined {
  if (!adjust) {
    return undefined;
  }

  const x = adjust.x ?? 0;
  const y = adjust.y ?? 0;
  const scale = adjust.scale ?? 1;

  if (x === 0 && y === 0 && scale === 1) {
    return undefined;
  }

  return {
    transform: `translate(${x}px, ${y}px) scale(${scale})`,
    transformOrigin: 'center',
  };
}

function joinClasses(...classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function sanitizeTitle(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findNodeElement(ownerDocument: Document, nodeId: string): HTMLElement | null {
  const nodeElements = ownerDocument.querySelectorAll<HTMLElement>('.react-flow__node[data-id]');
  return Array.from(nodeElements).find((element) => element.dataset.id === nodeId) ?? null;
}

export function NodeHeader({
  icon,
  titleText,
  metaText,
  title,
  meta,
  subtitle,
  rightSlot,
  className,
  iconClassName,
  toneClassName,
  titleClassName,
  metaClassName,
  titleRowClassName,
  subtitleClassName,
  headerAdjust = NODE_HEADER_ICON_TITLE_ADJUST,
  iconAdjust,
  titleAdjust,
  rightSlotAdjust = NODE_HEADER_PRICE_ADJUST,
  editable = false,
  onTitleChange,
}: NodeHeaderProps) {
  const { t } = useTranslation();
  const nodeId = useNodeId();
  const internalNode = useInternalNode(nodeId ?? '');
  const storeApi = useStoreApi();
  const activeExecution = useCanvasExecutionStateStore(
    (state) => nodeId ? state.activeNodes[nodeId] : undefined,
  );
  const tone = toneClassName ?? NODE_HEADER_TONE_CLASS;
  const canEditTitle = editable && typeof titleText === 'string' && typeof onTitleChange === 'function';
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(() => sanitizeTitle(titleText));

  useEffect(() => {
    if (isEditingTitle) {
      return;
    }
    setDraftTitle(sanitizeTitle(titleText));
  }, [isEditingTitle, titleText]);

  useEffect(() => {
    if (!isEditingTitle) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditingTitle]);

  // 标题编辑时仅临时解除当前节点的外层 paint containment。这样溢出节点盒的输入框
  // 可以正常接收鼠标事件，而画布上其余节点仍保持绘制隔离。
  useLayoutEffect(() => {
    if (!nodeId || !isEditingTitle) {
      return;
    }

    const nodeElement = findNodeElement(document, nodeId);
    if (!nodeElement) {
      return;
    }

    nodeElement.classList.add('canvas-node-header-editing');
    return () => nodeElement.classList.remove('canvas-node-header-editing');
  }, [isEditingTitle, nodeId]);

  const commitTitle = useCallback(() => {
    if (!canEditTitle || !onTitleChange) {
      setIsEditingTitle(false);
      return;
    }

    const fallbackTitle = sanitizeTitle(titleText);
    const nextTitle = sanitizeTitle(draftTitle) || fallbackTitle;

    if (nextTitle && nextTitle !== fallbackTitle) {
      onTitleChange(nextTitle);
    }

    setDraftTitle(nextTitle || fallbackTitle);
    setIsEditingTitle(false);
  }, [canEditTitle, draftTitle, onTitleChange, titleText]);

  const cancelTitleEdit = useCallback(() => {
    setDraftTitle(sanitizeTitle(titleText));
    setIsEditingTitle(false);
  }, [titleText]);

  const resolvedTitle = useMemo(() => {
    if (!canEditTitle) {
      if (titleText) {
        return (
          <span
            title={titleText}
            className={joinClasses(
              'block overflow-hidden whitespace-nowrap cursor-grab select-none active:cursor-grabbing',
              NODE_HEADER_TITLE_FLEX_CLASS,
              NODE_HEADER_TITLE_CLASS,
              tone,
              titleClassName
            )}
            style={NODE_HEADER_TITLE_FADE_STYLE}
          >
            {titleText}
          </span>
        );
      }
      return title;
    }

    if (isEditingTitle) {
      return (
        <UiInput
          ref={inputRef}
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          textHistory={{ onValueChange: setDraftTitle }}
          onBlur={commitTitle}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitTitle();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelTitleEdit();
            }
          }}
          className={joinClasses(
            `nodrag nowheel h-6 min-w-[70px] w-full max-w-full rounded border px-2 text-13 font-normal ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS}`,
            titleClassName
          )}
        />
      );
    }

    return (
      <UiButton
        type="button"
        variant="ghost"
        size="sm"
        className={joinClasses(
          '!h-auto !min-h-0 !rounded-none !border-0 !bg-transparent !px-0 !py-0 hover:!bg-transparent',
          '!justify-start overflow-hidden whitespace-nowrap cursor-grab select-none text-left active:cursor-grabbing',
          NODE_HEADER_TITLE_FLEX_CLASS,
          NODE_HEADER_TITLE_CLASS,
          tone,
          titleClassName
        )}
        style={NODE_HEADER_TITLE_FADE_STYLE}
        title={titleText}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          event.stopPropagation();
          setIsEditingTitle(true);
        }}
      >
        {titleText}
      </UiButton>
    );
  }, [
    canEditTitle,
    cancelTitleEdit,
    commitTitle,
    draftTitle,
    isEditingTitle,
    title,
    titleClassName,
    titleText,
    tone,
  ]);

  const resolvedMeta = metaText
    ? <span className={joinClasses(NODE_HEADER_META_CLASS, metaClassName)}>{metaText}</span>
    : meta;
  const executionStatus = activeExecution ? (
    <span
      role="status"
      aria-live="polite"
      className={joinClasses(
        'inline-flex shrink-0 items-center gap-1 text-2xs font-medium',
        UI_COLOR_ACCENT_TEXT_CLASS,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
      {t(`node.execution.${activeExecution.phase}`)}
    </span>
  ) : null;

  const handleDragSurfaceMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!nodeId || event.button !== 0 || isEditingTitle) {
      return;
    }

    // 可见标题位于节点测量盒之外。外层 paint containment 会保留绘制，却不会把这片
    // 溢出区域纳入命中测试，因此在 viewport portal 中用透明命中层接住按下事件，
    // 再把同一按下事件交给 React Flow 的真实节点外壳启动原生节点拖拽。
    event.stopPropagation();
    const ownerDocument = event.currentTarget.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const nodeElement = findNodeElement(ownerDocument, nodeId);
    if (!ownerWindow || !nodeElement) {
      return;
    }

    const forwardedMouseDown = new ownerWindow.MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: event.button,
      buttons: event.buttons || 1,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
    // d3-drag 通过 MouseEvent.view 找到需要监听 mousemove/mouseup 的 Window；
    // Chromium 创建合成事件时默认是 null，因此在事件实例上补齐，而不是依赖构造器差异。
    Object.defineProperty(forwardedMouseDown, 'view', { value: ownerWindow });
    nodeElement.dispatchEvent(forwardedMouseDown);
  }, [isEditingTitle, nodeId]);

  const handleDragSurfaceDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!canEditTitle) {
      return;
    }

    event.stopPropagation();
    setIsEditingTitle(true);
  }, [canEditTitle]);

  const nodeWidth = internalNode?.measured.width ?? internalNode?.internals.userNode.width ?? 0;
  const floatingDragSurface = nodeId && internalNode && nodeWidth > 0
    ? (
        <ViewportPortal>
          <div
            className="pointer-events-none absolute left-0 top-0"
            style={{
              width: nodeWidth,
              transform: `translate(${internalNode.internals.positionAbsolute.x}px, ${internalNode.internals.positionAbsolute.y}px)`,
              zIndex: internalNode.internals.z,
            }}
          >
            <div
              aria-hidden="true"
              data-node-header-drag-surface={nodeId}
              className={joinClasses(
                'nopan h-8 cursor-grab select-none active:cursor-grabbing',
                isEditingTitle ? 'pointer-events-none' : 'pointer-events-auto',
                className
              )}
              style={rightSlot ? { width: 'calc(100% - 2.5rem)' } : undefined}
              onMouseDown={handleDragSurfaceMouseDown}
              onClick={(event) => {
                event.stopPropagation();
                // 拖动标题会经由上面转发的 mousedown 触发 React Flow 原生选中（跨过
                // 拖拽阈值后由 XYDrag 内部选中逻辑接管）；纯点击（无位移）不会越过
                // 该阈值，原生选中不会触发。这里直接调用 React Flow 自己的选中存储
                // 动作（与其内置点击选中走同一条路径），而不是只设业务层
                // selectedNodeId——否则会被"按原生选中数组同步"的 effect 立刻纠正回去，
                // 使点击标题/顶部区域与点击节点其它区域的选中行为保持一致。
                if (!nodeId) return;
                const { addSelectedNodes, unselectNodesAndEdges, multiSelectionActive, nodeLookup } = storeApi.getState();
                const node = nodeLookup.get(nodeId);
                if (!node) return;
                if (!node.selected) {
                  addSelectedNodes([nodeId]);
                } else if (multiSelectionActive) {
                  unselectNodesAndEdges({ nodes: [node], edges: [] });
                }
              }}
              onDoubleClick={handleDragSurfaceDoubleClick}
            />
          </div>
        </ViewportPortal>
      )
    : null;

  return (
    <>
      <div className={joinClasses('flex w-full max-w-full items-start justify-between gap-2', className)}>
        <div className="min-w-0 flex-1" style={composeTransformStyle(headerAdjust)}>
          <div className={joinClasses('flex w-full items-center gap-1', titleRowClassName)}>
            {icon ? (
              <span
                className={joinClasses('inline-flex shrink-0 items-center justify-center', tone, iconClassName)}
                style={composeTransformStyle(iconAdjust)}
              >
                {icon}
              </span>
            ) : null}
            <div className="flex min-w-0 flex-1 items-baseline gap-2" style={composeTransformStyle(titleAdjust)}>
              {resolvedTitle}
              {executionStatus}
              {resolvedMeta}
            </div>
          </div>
          {subtitle ? (
            <div className={joinClasses('text-2xs text-text-muted/80', subtitleClassName)}>
              {subtitle}
            </div>
          ) : null}
        </div>
        {rightSlot ? (
          <div className="shrink-0" style={composeTransformStyle(rightSlotAdjust)}>
            {rightSlot}
          </div>
        ) : null}
      </div>
      {floatingDragSurface}
    </>
  );
}
