import { useLayoutEffect, useRef, type ReactNode } from 'react';

interface UiDisclosurePanelProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * 折叠内容的展开动画外壳：grid-rows 撑高 + 轻微位移，折叠态不 unmount 只是收到 0 高。
 * 用于"默认收起、点了才看"的次要/进阶内容（如高级参数、技术性验证详情），
 * 不要在每个调用点各写一遍这段 grid-rows 过渡。
 */
export function UiDisclosurePanel({ open, children, className = '' }: UiDisclosurePanelProps): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    if (!open && content.contains(content.ownerDocument.activeElement)) {
      // 展开按钮位于内容前；跳过下拉菜单触发器，不要求调用方增加 ref。
      let sibling = content.previousElementSibling;
      while (sibling) {
        const trigger = sibling.matches('button[aria-expanded]:not([aria-haspopup])')
          ? sibling : sibling.querySelector('button[aria-expanded]:not([aria-haspopup])');
        if (trigger instanceof HTMLElement) { trigger.focus({ preventScroll: true }); break; }
        sibling = sibling.previousElementSibling;
      }
    }
    content.toggleAttribute('inert', !open);
    content.setAttribute('aria-hidden', String(!open));
  }, [open]);
  return (
    <div
      ref={contentRef}
      className={`grid transition-[grid-template-rows,opacity] duration-180 ease-out ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <div className={`transition-transform duration-180 ease-out ${open ? 'translate-y-0' : '-translate-y-2'} ${className}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
