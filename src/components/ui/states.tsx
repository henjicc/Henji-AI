/**
 * 统一状态展示：空 / 加载 / 错误。
 *
 * 存在理由：项目原有 `EmptyState`/`ErrorState`/`LoadingState` 三个组件已是死代码，
 * 且引用的 `.empty-state`/`.loading-spinner` 等 CSS 类早已不存在（渲染出来是无样式的），
 * 各页面于是内联手写状态块（如 TaskCard 里的 queued/pending/generating/error 四段），
 * 导致同一种状态在不同页面长得不一样。这里收口为唯一实现。
 *
 * 视觉约定：状态块**不画卡片**。居中 + 留白 + 弱化文字即可，
 * 它已经处在某个容器内部，再套一层边框背景就是卡片套卡片。
 */
import type { ReactNode } from 'react';
import { UiButton } from './primitives';
import { UI_TEXT_META_CLASS, UI_TEXT_SECTION_CLASS } from './styleTokens';

type StateSize = 'xs' | 'sm' | 'md';

interface UiEmptyProps {
  /** 图标节点（建议传 lucide 图标）；不传则不显示 */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** 主操作 */
  action?: ReactNode;
  size?: StateSize;
  className?: string;
}

interface UiLoadingProps {
  message?: ReactNode;
  size?: StateSize;
  className?: string;
  /** 附加内容，例如进度条 */
  children?: ReactNode;
}

interface UiErrorProps {
  title?: ReactNode;
  message: ReactNode;
  /** 操作区，通常是重试按钮 */
  actions?: ReactNode;
  onRetry?: () => void;
  retryLabel?: ReactNode;
  size?: StateSize;
  className?: string;
}

function resolvePadding(size: StateSize): string {
  if (size === 'xs') {
    return 'py-3';
  }
  return size === 'sm' ? 'py-8' : 'py-16';
}

/**
 * 空状态：居中、弱化、无边框无背景。
 */
export function UiEmpty({
  icon,
  title,
  description,
  action,
  size = 'md',
  className = '',
}: UiEmptyProps): JSX.Element {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${resolvePadding(size)} ${className}`}>
      {icon ? <div className="mb-3 text-text-muted">{icon}</div> : null}
      <div className={size === 'xs' ? UI_TEXT_META_CLASS : UI_TEXT_SECTION_CLASS}>{title}</div>
      {description ? <p className={`mt-1.5 max-w-sm ${UI_TEXT_META_CLASS}`}>{description}</p> : null}
      {action ? <div className="mt-4 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * 加载状态：转圈 + 说明文字。需要进度条时通过 children 传入。
 */
export function UiLoading({
  message,
  size = 'md',
  className = '',
  children,
}: UiLoadingProps): JSX.Element {
  const spinnerSize = size === 'xs' ? 'h-4 w-4' : size === 'sm' ? 'h-5 w-5' : 'h-8 w-8';

  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${resolvePadding(size)} ${className}`}
      role="status"
      aria-live="polite"
    >
      <div
        className={`animate-spin rounded-full border-b-2 border-t-2 border-accent ${spinnerSize}`}
        aria-hidden="true"
      />
      {message ? <p className={`mt-3 ${UI_TEXT_META_CLASS}`}>{message}</p> : null}
      {children ? <div className="mt-3 w-full max-w-sm">{children}</div> : null}
    </div>
  );
}

/**
 * 错误状态：标题 + 原因 + 操作。
 * 不用红色边框把整块框起来——用红色文字标示语义，容器保持干净。
 */
export function UiError({
  title,
  message,
  actions,
  onRetry,
  retryLabel,
  size = 'md',
  className = '',
}: UiErrorProps): JSX.Element {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${resolvePadding(size)} ${className}`}
      role="alert"
    >
      {title ? <div className="text-sm font-medium text-danger">{title}</div> : null}
      <p className={`mt-1.5 max-w-md break-words ${UI_TEXT_META_CLASS}`}>{message}</p>
      {(actions || onRetry) && (
        <div className="mt-4 flex items-center justify-center gap-2">
          {actions}
          {onRetry ? (
            <UiButton variant="primary" size="sm" onClick={onRetry}>
              {retryLabel ?? '重试'}
            </UiButton>
          ) : null}
        </div>
      )}
    </div>
  );
}
