import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from './motion';
import { UiIconButton, UiPanel } from './primitives';
import { useDialogFocusTrap } from './useDialogFocusTrap';
import { useDialogTransition } from './useDialogTransition';
import { useUiPrimaryBudget } from './actionPriority';
import { UiOverlayLayerProvider, useUiOverlayLayer } from './overlayOwnership';
import { UiBooleanAppearanceContext } from './booleanAppearance';
import { ownerDocumentOf } from '@/utils/crossRealmDom';
import {
  UI_MODAL_SIZE_CLASS,
  UI_MODAL_CONTENT_PADDING_CLASS,
  UI_MODAL_CONTENT_SCROLL_CLASS,
  UI_TEXT_TITLE_CLASS,
  type UiModalSize,
} from './styleTokens';

interface UiModalProps {
  isOpen: boolean;
  /** 容器内的常驻预览不参与视口模态、焦点陷阱或滚动锁。 */
  scope?: 'viewport' | 'container';
  title: string;
  ariaLabel?: string;
  onClose: () => void;
  /** 必须完成或显式取消的任务不能通过遮罩、Esc 或关闭按钮离开。 */
  dismissible?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  /** 与标题同排的轻量上下文动作，例如语言或视图切换。 */
  headerActions?: ReactNode;
  /** 统一尺寸语义；业务弹窗不得再自行拼宽高。 */
  size?: UiModalSize;
  /** 仅用于非尺寸类的表面微调。 */
  panelClassName?: string;
  contentClassName?: string;
  contentPadding?: keyof typeof UI_MODAL_CONTENT_PADDING_CLASS;
  contentScroll?: keyof typeof UI_MODAL_CONTENT_SCROLL_CLASS;
  hideHeader?: boolean;
  overlayClassName?: string;
  /**
   * 弹窗自身的表面材质。
   *
   * `panel`（默认）：不透明面板。压在应用自身纯色 UI 上的弹窗都用这档——
   * 背后只有一片纯色，模糊它没有任何视觉收益，只多一个合成层。
   *
   * `glass`：整块弹窗一层玻璃。只有**铺得够大、背后压着画布/图片/视频等
   * 不可预测内容**的弹窗才有资格用；内部的区域、侧栏、中性控件请配合
   * `UI_GLASS_ADAPTIVE_*` 系列类，这样毛玻璃开关关掉时会整体退回实底。
   * 选这档会同时把遮罩换成 soft 档，否则遮罩与玻璃 tint 相乘会把背景压死。
   */
  surface?: 'panel' | 'glass';
  /**
   * 是否播放进入过渡，默认 true。只在接替一个外观相同、已经播完进入动画的占位弹窗时传 false
   * （懒加载弹窗的 Suspense 占位 → 真弹窗），否则交接那一刻会从全透明重新淡入一次。
   */
  appear?: boolean;
}

const stopAtModal = (event: React.SyntheticEvent): void => { event.stopPropagation(); };

export function UiModal({
  isOpen,
  scope = 'viewport',
  title,
  ariaLabel,
  onClose,
  dismissible = true,
  children,
  footer,
  headerActions,
  size = 'compact',
  panelClassName = '',
  contentClassName = '',
  contentPadding = 'default',
  contentScroll = 'auto',
  hideHeader = false,
  overlayClassName = '',
  surface = 'panel',
  appear = true,
}: UiModalProps): JSX.Element | null {
  const isGlass = surface === 'glass';
  const inContainer = scope === 'container';
  const { shouldRender, isVisible, closing, onTransitionEnd } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS, appear);
  const dialogRef = useRef<HTMLDivElement>(null);
  // 弹窗没有触发元素：用原位的隐藏锚点得知自己处在哪个文档（主窗口或剪辑系统浮窗），
  // 再挂到该文档的 body。锚点只在弹窗渲染期间存在。
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<Document | null>(null);
  useUiPrimaryBudget(dialogRef, shouldRender && (inContainer || host !== null));
  useLayoutEffect(() => {
    if (!shouldRender || !anchorRef.current) return;
    const next = ownerDocumentOf(anchorRef.current);
    setHost(previous => previous === next ? previous : next);
  }, [shouldRender, inContainer]);
  const titleId = useId();
  // 模态层（任务 4.3 浮层归属）：从浮层里打开的弹窗内点击不关闭那个浮层，打开期间父浮层不响应点外与 Escape
  const overlay = useUiOverlayLayer(!inContainer && isOpen && shouldRender, { modal: true });
  const resolvedAriaLabel = hideHeader || ariaLabel ? ariaLabel ?? title : undefined;
  const requestClose = (): void => { if (dismissible) onClose(); };
  useDialogFocusTrap({
    active: !inContainer && isOpen && shouldRender && host !== null,
    dialogRef,
    onClose: requestClose,
  });

  if (!shouldRender) {
    return null;
  }

  // 挂到所在文档的 body：祖先链上任何一个带 transform/filter 的面板都会给 fixed 定位
  // 重新建立包含块，导致弹窗被错误地约束在那个祖先容器内而不是真正居中于整个窗口。
  const dialog = (
    // data-dialog：资产库边缘触发器靠它判断"当前有弹窗打开，别弹出侧栏"。
    // 放在 UiModal 上，所有走 UiModal 的弹窗自动获得该行为，
    // 不必再指望每个业务弹窗自己记得加这个属性。
    // 收起中不再声明模态（aria-modal / data-dialog）：画布快捷键、资产库边缘触发器等按“当前有没有模态”判断，
    // 关闭动画的 180ms 里仍挂着这两个标记会把紧接着的 Delete / 撤销吞掉（5.8，多图层编辑器关闭后删除节点失效）
    <div
      ref={dialogRef}
      data-dialog={closing || inContainer ? undefined : 'true'}
      data-gallery-static={inContainer ? 'UiModal' : undefined}
      role="dialog"
      aria-modal={closing || inContainer ? undefined : 'true'}
      aria-label={resolvedAriaLabel}
      aria-labelledby={resolvedAriaLabel ? undefined : titleId}
      tabIndex={-1}
      className={`${inContainer ? 'absolute inset-0 z-modal' : dismissible ? `fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-modal` : 'fixed inset-0 z-titlebar'} flex items-center justify-center outline-none ${overlayClassName}`}
      // 收起中的弹窗已经关闭：不再接收指针与键盘、对读屏隐藏（同 PanelTrigger / Dropdown，任务 5.8）
      aria-hidden={closing || undefined}
      {...(closing ? { inert: '' } : {})}
      {...overlay.layerProps}
      // 弹窗挂在 body 上，React 合成事件却仍沿组件树冒泡：从时间线这类按下即捕获指针的区域里打开时，
      // 弹窗里的按下会被那里抢走，取消、保存都点不动（2026-10-26 序列设置）。指针类事件到弹窗为止；
      // 全局监听（右键菜单、点外关闭、助手编辑拦截）都在捕获阶段，不受影响。
      onPointerDown={stopAtModal} onMouseDown={stopAtModal} onClick={stopAtModal} onDoubleClick={stopAtModal} onContextMenu={stopAtModal}
    >
      <UiOverlayLayerProvider id={overlay.id}>
      {/* 弹窗是表单：从停靠面板里打开时开关也回到滑块外观（重要记录 022） */}
      <UiBooleanAppearanceContext.Provider value="pill">
      <div
        className={`ui-glass-scrim ${isGlass ? 'ui-glass-scrim-soft' : ''} absolute inset-0 transition-opacity duration-180 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={requestClose}
      />
      <UiPanel
        variant={isGlass ? 'glass' : 'panel'}
        className={`relative flex ${inContainer ? 'max-h-full' : 'max-h-[calc(100vh-2rem)]'} flex-col overflow-hidden transition-opacity duration-180 ${isVisible ? 'opacity-100' : 'opacity-0'} ${UI_MODAL_SIZE_CLASS[size]} ${panelClassName}`}
        onTransitionEnd={onTransitionEnd}
      >
        {!hideHeader && (
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <h2 id={titleId} className={UI_TEXT_TITLE_CLASS}>{title}</h2>
              {headerActions}
            </div>
            {dismissible && <UiIconButton size="md"
              aria-label={`${title} - 关闭`}
              onClick={requestClose}
            >
              <X  />
            </UiIconButton>}
          </div>
        )}

        <div className={`flex min-h-0 flex-1 flex-col ${UI_MODAL_CONTENT_PADDING_CLASS[contentPadding]} ${UI_MODAL_CONTENT_SCROLL_CLASS[contentScroll]} ${contentClassName}`}>{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </div>
        )}
      </UiPanel>
      </UiBooleanAppearanceContext.Provider>
      </UiOverlayLayerProvider>
    </div>
  );
  if (inContainer) return dialog;
  return <><span ref={anchorRef} hidden />{host && createPortal(dialog, host.body)}</>;
}
