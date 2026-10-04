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
import { useTranslation } from 'react-i18next';
import { UiButton } from './primitives';
import { UI_TEXT_META_CLASS, UI_TEXT_PANEL_TITLE_CLASS, UI_TEXT_SECTION_CLASS } from './styleTokens';

type StateSize = 'xs' | 'sm' | 'md';
/**
 * `node`：画布节点内容区的空占位（“等待结果”等）。铺满节点内容区、图标 + 12 号次要文字，
 * 比 xs 档更贴合节点的小尺寸；图标尺寸由调用点按节点类型传入（5.8，5.4-36）。
 */
type EmptySize = StateSize | 'node';

interface UiEmptyProps {
  /** 图标节点（建议传 lucide 图标）；不传则不显示 */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** 主操作 */
  action?: ReactNode;
  size?: EmptySize;
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
  /** 失败标题（危险色）。不传时用缺省标题“操作未完成”（5.8，B-36）；调用点有更具体的说法就传入。 */
  title?: ReactNode;
  message: ReactNode;
  /** 操作区，通常是重试按钮 */
  actions?: ReactNode;
  onRetry?: () => void;
  retryLabel?: ReactNode;
  size?: StateSize;
  /** 对齐：`center`（默认，独立区域）/ `start`（列表行内，与行首文字左对齐）。 */
  align?: 'center' | 'start';
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
  if (size === 'node') {
    return (
      <div className={`flex h-full w-full flex-col items-center justify-center gap-2 text-center ${className}`}>
        {icon ? <div className="text-text3">{icon}</div> : null}
        <div className="px-4 text-xs leading-6 text-text2">{title}</div>
        {description ? <p className={`px-4 ${UI_TEXT_META_CLASS}`}>{description}</p> : null}
        {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-center justify-center text-center ${resolvePadding(size)} ${className}`}>
      {icon ? <div className="mb-3 text-text3">{icon}</div> : null}
      <div className={size === 'xs' ? UI_TEXT_META_CLASS : size === 'sm' ? UI_TEXT_PANEL_TITLE_CLASS : UI_TEXT_SECTION_CLASS}>{title}</div>
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
        className={`animate-spin rounded-full border-2 border-line-strong border-t-accent ${spinnerSize}`}
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
  align = 'center',
  className = '',
}: UiErrorProps): JSX.Element {
  const { t } = useTranslation('ui');
  const start = align === 'start';
  // 失败必须一眼可辨：没有标题时正文只是弱化小字，看不出是错误，所以总有一行危险色标题
  const resolvedTitle = title ?? t('errorState.title', '操作未完成');
  return (
    <div
      className={`flex flex-col ${start ? 'items-start text-left' : 'items-center justify-center text-center'} ${resolvePadding(size)} ${className}`}
      role="alert"
    >
      <div className="text-sm font-medium text-danger-text">{resolvedTitle}</div>
      {/* 标题已经是完整的失败说明时，调用方传空正文，这里不再留一行空白 */}
      {message ? <p className={`mt-1.5 max-w-md break-words ${UI_TEXT_META_CLASS}`}>{message}</p> : null}
      {(actions || onRetry) && (
        <div className={`flex items-center gap-2 ${start ? 'mt-2' : 'mt-4 justify-center'}`}>
          {actions}
          {onRetry ? (
            <UiButton variant="secondary" onClick={onRetry}>
              {retryLabel ?? t('errorState.retry', '重试')}
            </UiButton>
          ) : null}
        </div>
      )}
    </div>
  );
}
