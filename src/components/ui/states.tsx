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
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CircleAlert, Copy, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { writeClipboardText } from '@/commands/clipboard';
import { createLogger } from '@/core/logging';
import { UiSpinner } from './UiSpinner';
export { UiSpinner } from './UiSpinner';
import Tooltip from './Tooltip';
import { UiButton, UiIconButton } from './primitives';
import { UiDisclosurePanel } from './layout';
import {
  UI_FLOATING_EDGE_CLASS, UI_ICON_SIZE_CLASS, UI_RADIUS_CLASS, UI_TEXT_META_CLASS, UI_TEXT_PANEL_TITLE_CLASS,
  UI_TEXT_SECONDARY_CLASS, UI_TEXT_SECTION_CLASS, UI_TEXT_TIMECODE_CLASS,
} from './styleTokens';

const logger = createLogger('components.ui.states');


/** 骨架只承载占位；外部 className 只用于宽度、定位等布局。 */
/**
 * 占位骨架。`fill` 铺满定位父级，用于按成品比例先占住媒体结果的位置；
 * `sweep` 是一道光带扫过，表示内容正在生成，`pulse` 表示在加载已有内容。
 */
export function UiSkeleton({ shape = 'line', motion = 'pulse', active = true, className = '' }: {
  shape?: 'line' | 'block' | 'square' | 'fill';
  motion?: 'pulse' | 'sweep';
  active?: boolean;
  className?: string;
}): JSX.Element {
  const geometry = shape === 'line' ? 'h-4 w-full' : shape === 'square' ? 'aspect-square w-full' : shape === 'fill' ? 'absolute inset-0 h-full w-full' : 'h-24 w-full';
  const surface = motion === 'sweep' ? (active ? 'ui-skeleton-sweep' : 'bg-raised') : `bg-control ${active ? 'motion-safe:animate-pulse' : ''}`;
  return <span data-ui-skeleton aria-hidden="true" {...(motion === 'sweep' && active ? { 'data-motion-essential': '' } : {})}
    className={`block ${shape === 'fill' ? 'rounded-[inherit]' : 'rounded-control'} ${surface} ${geometry} ${className}`} />;
}

export function UiFieldMessage({ tone = 'error', className = '', children, ...props }: Omit<HTMLAttributes<HTMLSpanElement>, 'color'> & {
  tone?: 'error' | 'hint';
}): JSX.Element {
  return <span {...props} role={tone === 'error' ? 'alert' : undefined} className={`block text-xs ${tone === 'error' ? 'text-danger-text' : 'text-text3'} ${className}`}>{children}</span>;
}

/** 行内操作反馈；长文本可截断并通过同一 Tooltip 读全文。 */
export function UiInlineStatus({ tone = 'error', truncate = false, tooltip, children, className = '', ...props }: Omit<HTMLAttributes<HTMLSpanElement>, 'color'> & {
  tone?: 'error' | 'warning' | 'success';
  truncate?: boolean;
  tooltip?: string;
}): JSX.Element {
  const color = { error: 'text-danger-text', warning: 'text-warning-text', success: 'text-success-text' }[tone];
  const content = <span {...props} role={tone === 'error' ? 'alert' : 'status'} className={`text-xs ${color} ${truncate ? 'block min-w-0 truncate' : ''} ${className}`}>{children}</span>;
  const description = tooltip ?? (truncate && typeof children === 'string' ? children : undefined);
  return description ? <Tooltip asChild content={description}>{content}</Tooltip> : content;
}

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

/**
 * 报错外观：
 * - `block`（默认）：面板或内容区里的状态块，图标、标题、正文、动作依次排列（`align` 决定居中或靠左）；
 * - `overlay`：压在画面或画布上的浮起小条，实底加浮起描边，左图标、中间标题与正文、右侧动作。
 */
type UiErrorAppearance = 'block' | 'overlay';

/** 语气只进图标颜色：失败、可能不完整、普通提示。标题与正文始终是主要/次要文字色。 */
type UiErrorTone = 'error' | 'warning' | 'notice';

interface UiErrorProps {
  /** 标题：说清发生了什么。不传时用缺省标题“操作未完成”；调用点有更具体的说法就传入。 */
  title?: ReactNode;
  /** 正文：用户能做什么。标题已经说全时可省略。原始错误信息放 `detail`，不要直接当正文。 */
  message?: ReactNode;
  /** 技术详情（原始错误信息等）：默认收起，展开后可复制。 */
  detail?: string;
  /** 操作区，通常是重试按钮 */
  actions?: ReactNode;
  onRetry?: () => void;
  retryLabel?: ReactNode;
  size?: StateSize;
  /** 块状外观的对齐：`center`（默认，独立区域）/ `start`（列表行内，与行首文字左对齐）。 */
  align?: 'center' | 'start';
  appearance?: UiErrorAppearance;
  tone?: UiErrorTone;
  className?: string;
}

const ERROR_TONE_ICON: Record<UiErrorTone, { Icon: LucideIcon; color: string }> = {
  error: { Icon: CircleAlert, color: 'text-danger-text' },
  warning: { Icon: TriangleAlert, color: 'text-warning-text' },
  notice: { Icon: Info, color: 'text-text2' },
};

const ERROR_ICON_SIZE: Record<StateSize, string> = { xs: UI_ICON_SIZE_CLASS.md, sm: UI_ICON_SIZE_CLASS.lg, md: UI_ICON_SIZE_CLASS.xl };

/** 报错详情：折叠的原始信息 + 复制。 */
function UiErrorDetail({ detail, align }: { detail: string; align: 'center' | 'start' }): JSX.Element {
  const { t } = useTranslation('ui');
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void writeClipboardText(detail).then(() => setCopied(true), (error: unknown) => {
      logger.warn('复制报错详情失败', { event: 'ui.error_detail.copy_failed', error });
    });
  };
  return (
    <div className={`flex w-full flex-col ${align === 'center' ? 'items-center' : 'items-start'}`}>
      <UiButton variant="quiet" size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? t('errorState.hideDetails', '收起详情') : t('errorState.details', '查看详情')}
      </UiButton>
      <UiDisclosurePanel open={open} className="pt-1.5">
        <div className="flex w-full items-start gap-1 rounded-field bg-gap py-1.5 pl-3 pr-1 text-left">
          <pre className={`max-h-32 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words py-0.5 text-2xs leading-4 text-text2 ${UI_TEXT_TIMECODE_CLASS}`}>{detail}</pre>
          <UiIconButton size="xs" tooltip={copied ? t('errorState.detailsCopied', '已复制') : t('errorState.copyDetails', '复制详情')} onClick={copy}>
            {copied ? <Check /> : <Copy />}
          </UiIconButton>
        </div>
      </UiDisclosurePanel>
    </div>
  );
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

  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${resolvePadding(size)} ${className}`}
      role="status"
      aria-live="polite"
    >
      <UiSpinner size={size === 'xs' ? 'sm' : size === 'sm' ? 'md' : 'xl'} tone="accent" />
      {message ? <p className={`mt-3 ${UI_TEXT_META_CLASS}`}>{message}</p> : null}
      {children ? <div className="mt-3 w-full max-w-sm">{children}</div> : null}
    </div>
  );
}

/**
 * 错误状态：图标 + 标题 + 用户能做什么 + 操作，原始信息收进可复制的详情。
 * 危险色只给图标：一整片红字既难读也显得慌张；标题主要文字色、正文次要文字色。
 * 块状外观不画框——它已经在某个容器里；浮起小条才有自己的实底与描边。
 */
export function UiError({
  title,
  message,
  detail,
  actions,
  onRetry,
  retryLabel,
  size = 'md',
  align = 'center',
  appearance = 'block',
  tone = 'error',
  className = '',
}: UiErrorProps): JSX.Element {
  const { t } = useTranslation('ui');
  const resolvedTitle = title ?? t('errorState.title', '操作未完成');
  const { Icon, color } = ERROR_TONE_ICON[tone];
  const role = tone === 'error' ? 'alert' : 'status';
  const overlay = appearance === 'overlay';
  const retry = onRetry ? (
    <UiButton variant="secondary" size={overlay || size === 'xs' ? 'sm' : 'md'} onClick={onRetry}>
      {retryLabel ?? t('errorState.retry', '重试')}
    </UiButton>
  ) : null;
  const hasActions = Boolean(actions || retry);

  if (overlay) {
    return (
      // ui-overlay-surface：小条里的按钮与详情底跟着浮层上移一档，否则 secondary 按钮和条子同色、看不出是按钮。
      // 动作放不下时整组换到下一行靠右，不把文字挤成窄条。
      <div role={role} data-ui-error="overlay" className={`ui-overlay-surface flex w-full flex-wrap items-start gap-x-3 gap-y-2 bg-overlay py-2 pl-3 pr-2 ${UI_RADIUS_CLASS.field} ${UI_FLOATING_EDGE_CLASS} ${className}`}>
        <div className="flex min-w-60 flex-1 items-start gap-3">
          <Icon aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.md} mt-0.5 shrink-0 ${color}`} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="text-13 font-medium text-text1">{resolvedTitle}</div>
            {message ? <p className={`break-words ${UI_TEXT_SECONDARY_CLASS}`}>{message}</p> : null}
            {detail ? <div className="-ml-0.5 pt-0.5"><UiErrorDetail detail={detail} align="start" /></div> : null}
          </div>
        </div>
        {hasActions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}{retry}</div> : null}
      </div>
    );
  }

  const start = align === 'start';
  const titleClass = size === 'md' ? UI_TEXT_PANEL_TITLE_CLASS : 'text-13 font-medium text-text1';
  const body = (
    <>
      <div className={titleClass}>{resolvedTitle}</div>
      {message ? <p className={`mt-1 max-w-md break-words ${UI_TEXT_SECONDARY_CLASS}`}>{message}</p> : null}
      {detail ? <div className={`mt-1 ${start ? '-ml-0.5' : 'w-full max-w-md'}`}><UiErrorDetail detail={detail} align={align} /></div> : null}
      {hasActions ? <div className={`flex items-center gap-2 ${start ? 'mt-2' : 'mt-4 justify-center'}`}>{actions}{retry}</div> : null}
    </>
  );
  if (start) {
    return (
      <div role={role} data-ui-error="block" className={`flex items-start gap-2 text-left ${resolvePadding(size)} ${className}`}>
        <Icon aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.md} mt-0.5 shrink-0 ${color}`} />
        <div className="flex min-w-0 flex-col items-start">{body}</div>
      </div>
    );
  }
  return (
    <div role={role} data-ui-error="block" className={`flex flex-col items-center justify-center text-center ${resolvePadding(size)} ${className}`}>
      <Icon aria-hidden="true" className={`${ERROR_ICON_SIZE[size]} ${size === 'xs' ? 'mb-1.5' : 'mb-3'} ${color}`} />
      {body}
    </div>
  );
}
