import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from './motion';
import { UiIconButton, UiPanel } from './primitives';
import { useDialogFocusTrap } from './useDialogFocusTrap';
import { useDialogTransition } from './useDialogTransition';
import { UI_TEXT_TITLE_CLASS } from './styleTokens';

interface UiModalProps {
  isOpen: boolean;
  title: string;
  ariaLabel?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  widthClassName?: string;
  contentClassName?: string;
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
}

export function UiModal({
  isOpen,
  title,
  ariaLabel,
  onClose,
  children,
  footer,
  widthClassName = 'w-[460px]',
  contentClassName = 'px-4 py-4',
  hideHeader = false,
  overlayClassName = '',
  surface = 'panel',
}: UiModalProps): JSX.Element | null {
  const isGlass = surface === 'glass';
  const { shouldRender, isVisible } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const resolvedAriaLabel = hideHeader || ariaLabel ? ariaLabel ?? title : undefined;
  useDialogFocusTrap({
    active: isOpen && shouldRender,
    dialogRef,
    onClose,
  });

  if (!shouldRender) {
    return null;
  }

  // 挂到 document.body：祖先链上任何一个带 transform/filter 的面板都会给 fixed 定位
  // 重新建立包含块，导致弹窗被错误地约束在那个祖先容器内而不是真正居中于整个窗口。
  return createPortal(
    // data-dialog：资产库边缘触发器靠它判断"当前有弹窗打开，别弹出侧栏"。
    // 放在 UiModal 上，所有走 UiModal 的弹窗自动获得该行为，
    // 不必再指望每个业务弹窗自己记得加这个属性。
    <div
      ref={dialogRef}
      data-dialog="true"
      role="dialog"
      aria-modal="true"
      aria-label={resolvedAriaLabel}
      aria-labelledby={resolvedAriaLabel ? undefined : titleId}
      tabIndex={-1}
      className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-modal flex items-center justify-center outline-none ${overlayClassName}`}
    >
      <div
        className={`ui-glass-scrim ${isGlass ? 'ui-glass-scrim-soft' : ''} absolute inset-0 transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <UiPanel
        variant={isGlass ? 'glass' : 'panel'}
        className={`relative transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'} ${widthClassName}`}
      >
        {!hideHeader && (
          <div className="flex items-center justify-between border-b border-veil-subtle px-4 py-3">
            <h2 id={titleId} className={UI_TEXT_TITLE_CLASS}>{title}</h2>
            <UiIconButton className="h-8 w-8" aria-label={`${title} - 关闭`} onClick={onClose}>
              <X className="h-4 w-4" />
            </UiIconButton>
          </div>
        )}

        <div className={contentClassName}>{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-veil-subtle px-4 py-3">
            {footer}
          </div>
        )}
      </UiPanel>
    </div>,
    document.body
  );
}
