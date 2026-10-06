import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, FilePen, Folder, Layers, LayoutGrid, List, Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import ContextMenu from '@/components/ContextMenu';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import {
  ProjectCardGrid,
  type ProjectCardGridExtraAction,
  type ProjectCardGridItem,
  type ProjectCardGridLabels,
  type ProjectListColumnLabels,
} from '@/components/ProjectCardGrid';
import {
  ProjectSelectionToolbar,
  type ProjectSelectionToolbarLabels,
} from '@/components/ProjectSelectionToolbar';
import { RenameDialog } from '@/components/RenameDialog';
import {
  Dropdown,
  UI_TEXT_META_CLASS,
  UiButton,
  UiEmpty,
  UiError,
  UiIconButton,
  UiLoading,
  UiNavButton,
  UiPageHeader,
  UiSearchInput,
  UiTooltipText,
} from '@/components/ui';
import {
  PROJECT_LIBRARY_SORT_ORDER,
  arrangeProjectItems,
  type ProjectLibrarySort,
} from '@/components/projectLibraryArrange';
import {
  readProjectLibraryView,
  writeProjectLibraryView,
  type ProjectLibraryView,
} from '@/components/projectLibraryPrefs';
import { useContextMenu } from '@/hooks/useContextMenu';
import { useMultiSelect } from '@/hooks/useMultiSelect';

export interface ProjectLibraryLabels {
  /** 左栏唯一主按钮「新建…」的文案（多来源时是打开来源菜单的按钮文案） */
  createAction: string;
  /** 标题旁的数量，如「12 个项目」 */
  count: (count: number) => string;
  searchPlaceholder: string;
  /** 搜索没有命中时的空状态标题 */
  noResults: string;
  sortLabel: string;
  sortOptions: Record<ProjectLibrarySort, string>;
  /** 左栏分类：全部 / 最近打开 / 未保存草稿 */
  nav: { all: string; recent: string; drafts: string };
  /** “最近打开”还没有记录时的空状态标题 */
  recentEmpty: string;
  /** 网格 / 列表切换按钮的名称 */
  view: { grid: string; list: string };
  columns: ProjectListColumnLabels;
  /** 只在 `create.kind === 'named'` 时使用 */
  createDialogTitle?: string;
  /** 只在支持重命名时使用 */
  renameDialogTitle?: string;
  namePlaceholder?: string;
  /** 新建对话框的预填名称 */
  defaultNewName?: string;
  loadingMessage?: string;
  /** 没有任何项目时的邀请标题与说明 */
  emptyTitle: string;
  emptyDescription?: string;
  /** 支持拖入文件时空态里的一句提示 */
  dropHint?: string;
  /** 以下删除文案在支持删除或有草稿时使用 */
  deleteTitle?: string;
  deleteConfirmSingle?: (name: string) => string;
  deleteConfirmMultiple?: (count: number) => string;
  confirmDelete?: string;
  cancel: string;
  card: ProjectCardGridLabels;
  /** 只在支持删除（因而支持多选）时使用 */
  selection?: ProjectSelectionToolbarLabels;
}

/** 新建来源菜单里的一项（如“打开图片”“新建空白图片”“粘贴剪贴板图片”）。 */
export interface ProjectLibraryCreateOption {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

/**
 * 新建方式（有限三种）：
 * - `named`：先弹起名对话框，确认后用名称新建；
 * - `direct`：不起名，直接交给调用方（口播“导入音频或视频”、剪辑“新建项目”）；
 * - `menu`：多个来源。左栏主按钮带下拉，点开选来源。
 */
export type ProjectLibraryCreate =
  | { kind: 'named'; onCreate: (name: string) => void }
  | { kind: 'direct'; icon?: LucideIcon; onCreate: () => void }
  | { kind: 'menu'; options: ProjectLibraryCreateOption[] };

/**
 * 按位置筛选（如文档页的“全部 / 不在项目里 / 某个项目”）：在左栏分类下方成为一组导航，`label` 是组名。
 * `defaultValue` 那一项就是左栏的「全部」，不在组里重复。
 * 数据由调用方按筛选取好再传 `items`；筛选不在默认值时，列表为空显示“没有符合条件的”，不显示新建邀请。
 */
export interface ProjectLibraryFilter {
  value: string;
  defaultValue: string;
  /** `icon` 默认是文件夹（项目）；“不在项目里”这类非项目位置由调用方给别的图标 */
  options: { value: string; label: string; icon?: LucideIcon }[];
  label: string;
  onChange: (value: string) => void;
}

/** 左栏主按钮下方的次要动作（如“打开项目文件夹…”“导入单个文件…”）。 */
export interface ProjectLibrarySecondaryAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

type LibraryCategory = 'all' | 'recent' | 'drafts';

interface ProjectLibraryPageProps {
  title: React.ReactNode;
  /** 页面用途的补充说明：只作为标题的悬停提示，不占常驻行 */
  description?: React.ReactNode;
  /** 本机视图偏好（网格/列表）的存储名，每个页面一个 */
  persistKey: string;
  items: ProjectCardGridItem[];
  /** 意外退出留下的未保存草稿：排在最前，左栏多一个「未保存草稿」分类 */
  drafts?: ProjectCardGridItem[];
  /** 草稿移到回收站（经过同一个确认对话框） */
  onDiscardDraft?: (item: ProjectCardGridItem) => void | Promise<void>;
  icon?: LucideIcon;
  emptyIcon?: React.ReactNode;
  loading?: boolean;
  /** 读取列表失败：主区只显示错误与重试，不把失败显示成“没有项目” */
  loadError?: { title: string; message: string; onRetry: () => void };
  /** 打开/新建过程中禁用卡片与新建 */
  busy?: boolean;
  labels: ProjectLibraryLabels;
  create: ProjectLibraryCreate;
  /** 一个或多个次要动作，同档排在左栏主按钮下方。 */
  secondaryAction?: ProjectLibrarySecondaryAction | readonly ProjectLibrarySecondaryAction[];
  /** 传入即接受把文件拖到页面上（如图片编辑拖入图片） */
  onDropFiles?: (files: File[]) => void;
  /** 页头与列表之间的场景专属内容（如操作失败、导出进度） */
  banner?: React.ReactNode;
  /** 二级页面的返回入口，渲染在标题左侧；一级页面（画布工作区）不传 */
  onBack?: () => void;
  backLabel?: string;
  extraActions?: (item: ProjectCardGridItem) => ProjectCardGridExtraAction[];
  onOpen: (item: ProjectCardGridItem) => void;
  /** 不传 = 不支持重命名。返回 Promise 时对话框等完成再关；失败时显示原因并保持打开 */
  onRename?: (item: ProjectCardGridItem, name: string) => void | Promise<void>;
  /** 可选的名称实时检查（新建与重命名共用）：返回提示原因，null 表示可用 */
  validateName?: (name: string, context: { mode: 'create' } | { mode: 'rename'; item: ProjectCardGridItem }) => Promise<string | null>;
  /** 逐项判断能否重命名、删除、多选（如文件不存在的项）；不传 = 都能 */
  canManage?: (item: ProjectCardGridItem) => boolean;
  filter?: ProjectLibraryFilter;
  /** 不传 = 不支持删除，也就没有多选 */
  onDelete?: (items: ProjectCardGridItem[]) => void | Promise<void>;
}

type NameDialogState =
  | { mode: 'create' }
  | { mode: 'rename'; item: ProjectCardGridItem }
  | null;

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || !element.tagName) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable;
}

/**
 * 项目页：画布、3D 镜头参考、口播、剪辑、图片编辑五个模块共用的完整页面外壳（参照 Premiere 主页：左栏 + 最近项目）。
 *
 * 骨架是左右两栏：
 * - **左栏**（约 208 宽，读取中、出错、没有项目时都在）：顶部是这一页唯一的主按钮「新建…」（按新建方式起名、
 *   直接新建或弹出来源菜单），下面是同档的次要动作（打开项目文件夹…、导入单个文件…等）；
 *   一条分隔线之后是分类导航：全部（数量）/ 最近打开 / 未保存草稿（数量，警示色，只在有草稿时出现），
 *   文档页的位置筛选在其下作为「按所属项目」一组导航。
 * - **主区**铺满剩余宽度：页头一行——标题 + 数量 ｜ 搜索、排序、网格/列表切换；多选时动作整组换成多选工具条。
 *   网格按 auto-fill 排列，宽屏自动多排几列；列表按列显示名称、位置、修改时间、大小，点表头排序。
 *   网格/列表的选择按页面记在本机（`persistKey`）；“最近打开”用作品索引记的打开时间（`openedAt`），
 *   任何入口打开过的都算，按打开时间倒序。
 *
 * 状态：读取中 / 读取失败时主区只有加载或错误；没有项目时主区只有一句邀请（支持拖入时加拖放提示），
 * 不重复放新建按钮。草稿排在列表最前，带“草稿”标记，单击继续编辑，菜单里可以移到回收站。
 * 键盘：Enter 打开焦点所在项，Delete 移到回收站（多选时针对所选，照常确认），F2 重命名，Ctrl+N 新建。
 *
 * 收口的是**页面骨架加接线**：滚动容器、左栏、页头、视图切换、多选、新建/重命名对话框、删除确认、右键菜单、快捷键。
 * 调用方只提供数据来源、能力（新建方式、是否可重命名/删除）与场景专属动作，不开放样式覆盖口子。
 */
export function ProjectLibraryPage({
  title,
  description,
  persistKey,
  items,
  drafts = [],
  onDiscardDraft,
  icon,
  emptyIcon,
  loading = false,
  loadError,
  busy = false,
  labels,
  create,
  secondaryAction,
  onDropFiles,
  banner,
  onBack,
  backLabel,
  extraActions,
  onOpen,
  onRename,
  onDelete,
  validateName,
  canManage,
  filter,
}: ProjectLibraryPageProps): JSX.Element {
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectCardGridItem[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProjectLibrarySort>('updated');
  const [category, setCategory] = useState<LibraryCategory>('all');
  const [view, setView] = useState<ProjectLibraryView>(() => readProjectLibraryView(persistKey));

  const { menuVisible, menuPosition, menuItems, showMenu, showMenuAt, hideMenu } = useContextMenu();

  const filtering = Boolean(filter && filter.value !== filter.defaultValue);
  // 没有草稿时不会停在“未保存草稿”分类（最后一份草稿保存或丢弃后回到全部）
  const activeCategory: LibraryCategory = category === 'drafts' && drafts.length === 0 ? 'all' : category;

  const draftItems = useMemo(
    () => arrangeProjectItems(drafts.map((item) => ({ ...item, draft: true })), query, sort),
    [drafts, query, sort],
  );
  const visibleItems = useMemo(() => {
    if (activeCategory === 'drafts') return draftItems;
    if (activeCategory === 'recent') {
      return arrangeProjectItems(items.filter((item) => item.openedAt !== undefined), query, 'name')
        .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
    }
    return [...draftItems, ...arrangeProjectItems(items, query, sort)];
  }, [activeCategory, draftItems, items, query, sort]);

  // 多选的「全选」只覆盖当前看得见的已保存项目，草稿不参与
  const selectableIds = useMemo(() => visibleItems.filter((item) => !item.draft).map((item) => item.id), [visibleItems]);
  const selection = useMultiSelect(selectableIds);
  const searching = query.trim().length > 0;
  const settled = !loading && !loadError;
  // 筛选下没有结果不是“还没有任何项目”：保留页头，列表里说明没有符合条件的
  const empty = settled && items.length === 0 && drafts.length === 0 && !filtering;

  // 「全部」的数量只在没有位置筛选时可数；筛选期间沿用上一次的数
  const allCountRef = useRef(0);
  if (!filtering) allCountRef.current = items.length + drafts.length;
  const allCount = allCountRef.current;

  const changeView = (next: ProjectLibraryView): void => {
    setView(next);
    writeProjectLibraryView(persistKey, next);
  };

  const chooseCategory = (next: LibraryCategory): void => {
    setCategory(next);
    if (selection.active) selection.exit();
    if (filter && filter.value !== filter.defaultValue) filter.onChange(filter.defaultValue);
  };

  const chooseFilter = (value: string): void => {
    setCategory('all');
    if (selection.active) selection.exit();
    filter?.onChange(value);
  };

  const handleNameConfirm = (name: string): void | Promise<void> => {
    if (!nameDialog) return;
    if (nameDialog.mode === 'rename') return onRename?.(nameDialog.item, name);
    if (create.kind === 'named') create.onCreate(name);
  };
  const dialogValidate = useMemo(() => {
    if (!validateName || !nameDialog) return undefined;
    const context = nameDialog.mode === 'rename' ? { mode: 'rename' as const, item: nameDialog.item } : { mode: 'create' as const };
    return (name: string) => validateName(name, context);
  }, [validateName, nameDialog]);

  const startCreate = useCallback((anchor: Element | null): void => {
    if (create.kind === 'named') setNameDialog({ mode: 'create' });
    else if (create.kind === 'direct') create.onCreate();
    else if (anchor) {
      showMenuAt(anchor, create.options.map((option) => ({
        id: option.id,
        label: option.label,
        icon: <option.icon className="h-4 w-4" />,
        onClick: option.onSelect,
      })));
    }
  }, [create, showMenuAt]);

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const draftTargets = pendingDelete.filter((item) => item.draft);
      const savedTargets = pendingDelete.filter((item) => !item.draft);
      for (const item of draftTargets) await onDiscardDraft?.(item);
      if (savedTargets.length) await onDelete?.(savedTargets);
      // 删完所选就退出多选：否则删光后页头仍是“已选择 0 项”工具条
      if (selection.active) selection.exit();
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const manageable = (item: ProjectCardGridItem): boolean => !item.draft && (canManage?.(item) ?? true);
  const canTrash = (item: ProjectCardGridItem): boolean => (item.draft ? Boolean(onDiscardDraft) : Boolean(onDelete) && manageable(item));
  const dialogOpen = nameDialog !== null || pendingDelete !== null;

  // Delete / F2：作用于键盘焦点所在的那一项；多选时 Delete 针对所选
  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (dialogOpen || busy || isTypingTarget(event.target)) return;
    if (event.key !== 'Delete' && event.key !== 'F2') return;
    const focusedId = (event.target as HTMLElement).closest?.('[data-project-id]')?.getAttribute('data-project-id');
    const focused = focusedId ? visibleItems.find((item) => item.id === focusedId) : undefined;
    if (event.key === 'Delete') {
      const targets = selection.active
        ? visibleItems.filter((item) => !item.draft && selection.isSelected(item.id))
        : focused && canTrash(focused) ? [focused] : [];
      if (!targets.length) return;
      event.preventDefault();
      setPendingDelete(targets);
      return;
    }
    if (focused && onRename && manageable(focused) && !selection.active) {
      event.preventDefault();
      setNameDialog({ mode: 'rename', item: focused });
    }
  };

  // Ctrl+N 新建：页面看得见、没有弹窗、焦点不在别处的输入框里时生效（页面切走后保留挂载但不可见）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'n') return;
      const root = rootRef.current;
      if (!root || dialogOpen || busy || event.defaultPrevented) return;
      // 工作区切走后页面仍挂载但被隐藏（display: none）：这时不响应
      if (typeof root.checkVisibility === 'function' && !root.checkVisibility()) return;
      if (isTypingTarget(event.target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      startCreate(createButtonRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen, busy, startCreate]);

  // 多来源新建：左栏常驻，第一个来源当主按钮，其余来源平铺在它下面，一次点击直达（不再先弹菜单）；Ctrl+N 仍弹来源菜单。
  const primarySource = create.kind === 'menu' ? create.options[0] : undefined;
  const CreateIcon = primarySource ? primarySource.icon : create.kind === 'direct' && create.icon ? create.icon : Plus;
  const secondaryActions: readonly ProjectLibrarySecondaryAction[] = secondaryAction === undefined ? [] : Array.isArray(secondaryAction) ? secondaryAction : [secondaryAction as ProjectLibrarySecondaryAction];
  const railActions: readonly ProjectLibrarySecondaryAction[] = [
    ...(create.kind === 'menu' ? create.options.slice(1).map((option) => ({ label: option.label, icon: option.icon, onClick: option.onSelect })) : []),
    ...secondaryActions,
  ];
  const groupOptions = filter ? filter.options.filter((option) => option.value !== filter.defaultValue) : [];

  const dropHandlers = onDropFiles ? {
    onDragEnter: (event: React.DragEvent) => {
      if (!Array.from(event.dataTransfer.types).includes('Files')) return;
      dragDepthRef.current += 1;
      setDragOver(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
    },
    onDragLeave: () => {
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragOver(false);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragOver(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) onDropFiles(files);
    },
  } : {};

  const navCount = (count: number, warning = false): React.ReactNode => (
    <span className={`ml-auto shrink-0 text-xs tabular-nums ${warning ? 'text-warning-text' : 'text-text3'}`}>{count}</span>
  );

  const rail = (
    <aside className="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-gap bg-panel px-3 py-4">
      <UiButton
        ref={createButtonRef}
        className="w-full"
        variant="primary"
        disabled={busy}
        aria-keyshortcuts="Control+N"
        onClick={(event) => (primarySource ? primarySource.onSelect() : startCreate(event.currentTarget))}
      >
        <CreateIcon className="h-4 w-4" />
        {primarySource ? primarySource.label : labels.createAction}
      </UiButton>
      {railActions.length ? (
        <div className="mt-2 flex flex-col gap-0.5">
          {railActions.map((action) => (
            // 与下方分类同一种行：左对齐，图标落在同一列（UiButton 固定居中，会让长短不一的文案参差不齐）
            <UiNavButton key={action.label} size="md" onClick={action.onClick} disabled={busy || action.disabled} title={action.label}>
              <action.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{action.label}</span>
            </UiNavButton>
          ))}
        </div>
      ) : null}

      {/* 动作（新建、打开、导入）与导航（看哪一类）语义不同：左栏唯一的分隔线 */}
      {settled && !empty ? (
        <nav className="mt-4 flex flex-col gap-0.5 border-t border-line pt-4">
          <UiNavButton size="md" active={activeCategory === 'all' && !filtering} onClick={() => chooseCategory('all')}>
            <Layers className="h-4 w-4 shrink-0" />
            <span className="truncate">{labels.nav.all}</span>
            {navCount(allCount)}
          </UiNavButton>
          <UiNavButton size="md" active={activeCategory === 'recent'} onClick={() => chooseCategory('recent')}>
            <Clock3 className="h-4 w-4 shrink-0" />
            <span className="truncate">{labels.nav.recent}</span>
          </UiNavButton>
          {drafts.length ? (
            <UiNavButton size="md" active={activeCategory === 'drafts'} onClick={() => chooseCategory('drafts')}>
              <FilePen className="h-4 w-4 shrink-0 text-warning-text" />
              <span className="truncate">{labels.nav.drafts}</span>
              {navCount(drafts.length, true)}
            </UiNavButton>
          ) : null}
          {filter && groupOptions.length ? (
            <>
              <div className={`px-2.5 pb-1 pt-3 ${UI_TEXT_META_CLASS}`}>{filter.label}</div>
              {groupOptions.map((option) => (
                <UiNavButton
                  key={option.value}
                  size="md"
                  active={activeCategory === 'all' && filter.value === option.value}
                  onClick={() => chooseFilter(option.value)}
                >
                  {React.createElement(option.icon ?? Folder, { className: 'h-4 w-4 shrink-0' })}
                  <span className="truncate" title={option.label}>{option.label}</span>
                </UiNavButton>
              ))}
            </>
          ) : null}
        </nav>
      ) : null}
    </aside>
  );

  const showTools = settled && !empty;
  const headerActions = !showTools ? undefined : selection.active && labels.selection ? (
    <ProjectSelectionToolbar
      selection={selection}
      labels={labels.selection}
      onDeleteSelected={() => setPendingDelete(visibleItems.filter((item) => !item.draft && selection.isSelected(item.id)))}
    />
  ) : (
    <>
      <UiSearchInput
        className="w-56"
        value={query}
        aria-label={labels.searchPlaceholder}
        placeholder={labels.searchPlaceholder}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }}
      />
      {activeCategory !== 'recent' ? (
        <Dropdown<ProjectLibrarySort>
          appearance="text"
          value={sort}
          ariaLabel={labels.sortLabel}
          options={PROJECT_LIBRARY_SORT_ORDER.map((value) => ({ value, label: labels.sortOptions[value] }))}
          onSelect={setSort}
          className="shrink-0"
          buttonClassName="w-auto"
          minWidthStrategy="options"
          panelWidthStrategy="options"
        />
      ) : null}
      <div role="group" aria-label={`${labels.view.grid} / ${labels.view.list}`} className="flex items-center">
        <UiIconButton size="lg" on={view === 'grid'} title={labels.view.grid} aria-label={labels.view.grid} onClick={() => changeView('grid')}>
          <LayoutGrid className="h-4 w-4" />
        </UiIconButton>
        <UiIconButton size="lg" on={view === 'list'} title={labels.view.list} aria-label={labels.view.list} onClick={() => changeView('list')}>
          <List className="h-4 w-4" />
        </UiIconButton>
      </div>
    </>
  );

  const listEmptyTitle = activeCategory === 'recent' && !searching ? labels.recentEmpty : searching || filtering ? labels.noResults : labels.emptyTitle;
  const emptyDescription = [labels.emptyDescription, onDropFiles ? labels.dropHint : undefined].filter(Boolean).join(' ');

  return (
    <div
      ref={rootRef}
      data-project-library-state={loadError ? 'error' : loading ? 'loading' : empty ? 'empty' : 'items'}
      className="flex h-full w-full bg-window"
      onKeyDown={handleKeyDown}
      {...dropHandlers}
    >
      {rail}

      <main className="flex min-w-0 flex-1 flex-col overflow-auto px-6 py-6 xl:px-8">
        <UiPageHeader
          className="mb-6"
          title={description ? <UiTooltipText tooltip={description}>{title}</UiTooltipText> : title}
          meta={showTools ? labels.count(visibleItems.length) : undefined}
          onBack={onBack}
          backLabel={backLabel}
          actions={headerActions}
        />

        {banner}

        {loadError ? (
          <UiError className="flex-1" title={loadError.title} message={loadError.message} onRetry={loadError.onRetry} />
        ) : loading ? (
          <UiLoading className="flex-1" size="sm" message={labels.loadingMessage ?? ''} />
        ) : empty ? (
          // 拖入文件时整块邀请区亮起，作为落点反馈；静息不画框（留白就是设计）
          <div
            data-project-library-drop={onDropFiles ? (dragOver ? 'active' : 'idle') : undefined}
            className={`mb-2 flex flex-1 items-center justify-center rounded-overlay border-2 border-dashed transition-colors duration-120 ${
              dragOver ? 'border-accent bg-accent-tint' : 'border-transparent'
            }`}
          >
            <UiEmpty icon={emptyIcon} title={labels.emptyTitle} description={emptyDescription || undefined} />
          </div>
        ) : (
          <ProjectCardGrid
            items={visibleItems}
            layout={view}
            busy={busy}
            icon={icon}
            selection={selection}
            labels={labels.card}
            columns={labels.columns}
            sort={activeCategory === 'recent' ? undefined : sort}
            onSortChange={activeCategory === 'recent' ? undefined : setSort}
            emptyTitle={listEmptyTitle}
            onOpen={onOpen}
            onRename={onRename ? (item) => setNameDialog({ mode: 'rename', item }) : undefined}
            onDeleteRequest={onDelete ? (targets) => setPendingDelete(targets) : undefined}
            onDiscardDraftRequest={onDiscardDraft ? (item) => setPendingDelete([item]) : undefined}
            extraActions={extraActions}
            canManage={canManage}
            showMenu={showMenu}
            showMenuAt={showMenuAt}
          />
        )}
      </main>

      <RenameDialog
        isOpen={nameDialog !== null}
        title={(nameDialog?.mode === 'rename' ? labels.renameDialogTitle : labels.createDialogTitle) ?? ''}
        defaultValue={nameDialog?.mode === 'rename' ? nameDialog.item.name : labels.defaultNewName ?? ''}
        placeholder={labels.namePlaceholder}
        onClose={() => setNameDialog(null)}
        onConfirm={handleNameConfirm}
        validate={dialogValidate}
      />

      {onDelete || onDiscardDraft ? (
        <DeleteConfirmDialog
          isOpen={!!pendingDelete}
          title={labels.deleteTitle ?? ''}
          message={
            pendingDelete
              ? pendingDelete.length === 1
                ? labels.deleteConfirmSingle?.(pendingDelete[0].name) ?? ''
                : labels.deleteConfirmMultiple?.(pendingDelete.length) ?? ''
              : ''
          }
          cancelLabel={labels.cancel}
          confirmLabel={labels.confirmDelete ?? ''}
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      <ContextMenu items={menuItems} position={menuPosition} onClose={hideMenu} visible={menuVisible} />
    </div>
  );
}
