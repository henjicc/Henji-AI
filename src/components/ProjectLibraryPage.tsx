import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import ContextMenu from '@/components/ContextMenu';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import {
  ProjectCardGrid,
  type ProjectCardGridExtraAction,
  type ProjectCardGridItem,
  type ProjectCardGridLabels,
} from '@/components/ProjectCardGrid';
import {
  ProjectSelectionToolbar,
  type ProjectSelectionToolbarLabels,
} from '@/components/ProjectSelectionToolbar';
import { RenameDialog } from '@/components/RenameDialog';
import {
  Dropdown,
  UiButton,
  UiEmpty,
  UiError,
  UiLoading,
  UiPageHeader,
  UiRegion,
  UiSearchInput,
} from '@/components/ui';
import { PROJECT_GRID_MAX_WIDTH_CLASS } from '@/components/projectGridLayout';
import {
  PROJECT_LIBRARY_SORT_ORDER,
  arrangeProjectItems,
  type ProjectLibrarySort,
} from '@/components/projectLibraryArrange';
import { useContextMenu } from '@/hooks/useContextMenu';
import { useMultiSelect } from '@/hooks/useMultiSelect';

export interface ProjectLibraryLabels {
  /** 唯一主按钮「新建」的文案（多来源时是打开来源菜单的按钮文案） */
  createAction: string;
  /** 标题旁的数量，如「12 个项目」 */
  count: (count: number) => string;
  searchPlaceholder: string;
  /** 搜索没有命中时的空状态标题 */
  noResults: string;
  sortLabel: string;
  sortOptions: Record<ProjectLibrarySort, string>;
  /** 只在 `create.kind === 'named'` 时使用 */
  createDialogTitle?: string;
  /** 只在支持重命名时使用 */
  renameDialogTitle?: string;
  namePlaceholder?: string;
  /** 新建对话框的预填名称 */
  defaultNewName?: string;
  loadingMessage?: string;
  /** 没有任何项目时新建提示的标题与说明 */
  emptyTitle: string;
  emptyDescription?: string;
  /** 以下删除文案只在支持删除时使用 */
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
 * - `named`：先弹起名对话框，确认后用名称新建（画布、3D 镜头参考）；
 * - `direct`：不起名，直接交给调用方（口播“导入音频或视频”、剪辑“新建项目”走系统另存为）；
 * - `menu`：多个来源。页头是一个带下拉的主按钮；空态直接把来源平铺成按钮（第一项为主按钮），少点一次。
 */
export type ProjectLibraryCreate =
  | { kind: 'named'; onCreate: (name: string) => void }
  | { kind: 'direct'; icon?: LucideIcon; onCreate: () => void }
  | { kind: 'menu'; options: ProjectLibraryCreateOption[] };

/** 页头与空态里排在「新建」旁边的次要动作（如“打开项目文件”“导入项目包”）。 */
export interface ProjectLibrarySecondaryAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

interface ProjectLibraryPageProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  items: ProjectCardGridItem[];
  icon?: LucideIcon;
  emptyIcon?: React.ReactNode;
  loading?: boolean;
  /** 读取列表失败：页面只显示错误与重试，不把失败显示成“没有项目” */
  loadError?: { title: string; message: string; onRetry: () => void };
  /** 打开/新建过程中禁用卡片与新建 */
  busy?: boolean;
  labels: ProjectLibraryLabels;
  create: ProjectLibraryCreate;
  secondaryAction?: ProjectLibrarySecondaryAction;
  /** 传入即接受把文件拖到页面上（如图片编辑拖入图片） */
  onDropFiles?: (files: File[]) => void;
  /** 标题区与网格之间的场景专属内容（如错误条） */
  banner?: React.ReactNode;
  /** 二级页面的返回入口，渲染在标题左侧；一级页面（画布工作区）不传 */
  onBack?: () => void;
  backLabel?: string;
  extraActions?: (item: ProjectCardGridItem) => ProjectCardGridExtraAction[];
  onOpen: (item: ProjectCardGridItem) => void;
  /** 不传 = 不支持重命名 */
  onRename?: (item: ProjectCardGridItem, name: string) => void;
  /** 不传 = 不支持删除，也就没有多选 */
  onDelete?: (items: ProjectCardGridItem[]) => void | Promise<void>;
}

type NameDialogState =
  | { mode: 'create' }
  | { mode: 'rename'; item: ProjectCardGridItem }
  | null;

/**
 * 项目页：画布、3D 镜头参考、口播、剪辑、图片编辑五个模块共用的完整页面外壳（项目体系 2.1）。
 *
 * 三种形态：
 * - 读取中 / 读取失败：只有标题，正文是加载或错误；不提前露出新建，避免把失败看成“没有项目”。
 * - 没有项目：只有标题，正文是新建提示（可拖入文件），没有数量、搜索、排序、多选这些管理用的界面。
 * - 有项目：页头一条——标题 + 数量 ｜ 搜索、排序 ｜ 次要动作、新建（这一屏唯一的主按钮）；多选时整组换成多选工具条。
 *
 * 收口的是**页面骨架加接线**：滚动容器、标题区、多选切换、新建/重命名对话框、删除确认、右键菜单。
 * 调用方只提供数据来源、能力（新建方式、是否可重命名/删除）与场景专属动作，不开放样式覆盖口子。
 */
export function ProjectLibraryPage({
  title,
  description,
  items,
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
}: ProjectLibraryPageProps): JSX.Element {
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectCardGridItem[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProjectLibrarySort>('updated');

  const { menuVisible, menuPosition, menuItems, showMenu, showMenuAt, hideMenu } = useContextMenu();
  const visibleItems = useMemo(() => arrangeProjectItems(items, query, sort), [items, query, sort]);
  // 多选的「全选」只覆盖当前搜索结果，删除也只会删看得见的项目
  const visibleIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const selection = useMultiSelect(visibleIds);
  const searching = query.trim().length > 0;
  const settled = !loading && !loadError;
  const empty = settled && items.length === 0;

  const handleNameConfirm = (name: string): void => {
    if (!nameDialog) return;
    if (nameDialog.mode === 'rename') {
      onRename?.(nameDialog.item, name);
      return;
    }
    if (create.kind === 'named') create.onCreate(name);
  };

  const startCreate = (anchor: Element): void => {
    if (create.kind === 'named') setNameDialog({ mode: 'create' });
    else if (create.kind === 'direct') create.onCreate();
    else {
      showMenuAt(anchor, create.options.map((option) => ({
        id: option.id,
        label: option.label,
        icon: <option.icon className="h-4 w-4" />,
        onClick: option.onSelect,
      })));
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(pendingDelete);
      // 删完所选就退出多选：否则删光后页头仍是“已选择 0 项”工具条，连“新建”都看不到（5.6 第二批 B-54）
      if (selection.active) selection.exit();
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const CreateIcon = create.kind === 'direct' && create.icon ? create.icon : Plus;
  const headerCreateButton = (
    <UiButton
      onClick={(event) => startCreate(event.currentTarget)}
      variant="primary"
      disabled={busy}
      aria-haspopup={create.kind === 'menu' ? 'menu' : undefined}
    >
      <CreateIcon className="h-4 w-4" />
      {labels.createAction}
      {create.kind === 'menu' ? <ChevronDown className="h-4 w-4" /> : null}
    </UiButton>
  );
  const secondaryButton = (variant: 'quiet' | 'secondary'): React.ReactNode => secondaryAction ? (
    <UiButton variant={variant} onClick={secondaryAction.onClick} disabled={busy || secondaryAction.disabled}>
      <secondaryAction.icon className="h-4 w-4" />
      {secondaryAction.label}
    </UiButton>
  ) : null;

  // 空态：多来源平铺成按钮（第一项主按钮，其余次级），单一新建就是一个主按钮，次要动作跟在后面
  const emptyActions = create.kind === 'menu' ? (
    <>
      {create.options.map((option, index) => (
        <UiButton
          key={option.id}
          variant={index === 0 ? 'primary' : 'secondary'}
          disabled={busy}
          onClick={option.onSelect}
        >
          <option.icon className="h-4 w-4" />
          {option.label}
        </UiButton>
      ))}
      {secondaryButton('secondary')}
    </>
  ) : (
    <>
      <UiButton variant="primary" disabled={busy} onClick={(event) => startCreate(event.currentTarget)}>
        <CreateIcon className="h-4 w-4" />
        {labels.createAction}
      </UiButton>
      {secondaryButton('secondary')}
    </>
  );

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

  return (
    // 列数由窗口宽度算出（见 projectGridLayout.ts），左右留白交给这里的横向 padding。
    // 最大宽度封顶列数，标题区与网格共用它，否则宽屏上「新建」按钮会飞到网格右边之外。
    <div
      data-project-library-state={loadError ? 'error' : loading ? 'loading' : empty ? 'empty' : 'items'}
      className="h-full w-full overflow-auto bg-window px-6 py-8 xl:px-10"
      {...dropHandlers}
    >
      <UiRegion maxWidthClassName={PROJECT_GRID_MAX_WIDTH_CLASS} className="mx-auto flex min-h-full flex-col">
        <UiPageHeader
          className="mb-7"
          title={title}
          meta={settled && !empty ? labels.count(items.length) : undefined}
          description={description}
          onBack={onBack}
          backLabel={backLabel}
          actions={!settled || empty ? undefined : selection.active && labels.selection ? (
            <ProjectSelectionToolbar
              selection={selection}
              labels={labels.selection}
              onDeleteSelected={() => setPendingDelete(visibleItems.filter((item) => selection.isSelected(item.id)))}
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
              {/* 视图控制（搜索、排序）与动作（打开、导入、新建）语义不同：这条带唯一的分隔线 */}
              <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
              {secondaryButton('quiet')}
              {headerCreateButton}
            </>
          )}
        />

        {banner}

        {loadError ? (
          <UiError className="flex-1" title={loadError.title} message={loadError.message} onRetry={loadError.onRetry} />
        ) : loading ? (
          <UiLoading className="flex-1" size="sm" message={labels.loadingMessage ?? ''} />
        ) : empty ? (
          // 拖入文件时整块新建提示亮起，作为落点反馈；静息不画框（留白就是设计）
          <div
            data-project-library-drop={onDropFiles ? (dragOver ? 'active' : 'idle') : undefined}
            className={`mb-8 flex flex-1 items-center justify-center rounded-overlay border-2 border-dashed transition-colors duration-120 ${
              dragOver ? 'border-accent bg-accent-tint' : 'border-transparent'
            }`}
          >
            <UiEmpty icon={emptyIcon} title={labels.emptyTitle} description={labels.emptyDescription} action={emptyActions} />
          </div>
        ) : (
          <ProjectCardGrid
            items={visibleItems}
            loading={false}
            loadingMessage={labels.loadingMessage ?? ''}
            busy={busy}
            icon={icon}
            selection={selection}
            labels={labels.card}
            emptyTitle={searching ? labels.noResults : labels.emptyTitle}
            onOpen={onOpen}
            onRename={onRename ? (item) => setNameDialog({ mode: 'rename', item }) : undefined}
            onDeleteRequest={onDelete ? (targets) => setPendingDelete(targets) : undefined}
            extraActions={extraActions}
            showMenu={showMenu}
            showMenuAt={showMenuAt}
          />
        )}
      </UiRegion>

      <RenameDialog
        isOpen={nameDialog !== null}
        title={(nameDialog?.mode === 'rename' ? labels.renameDialogTitle : labels.createDialogTitle) ?? ''}
        defaultValue={nameDialog?.mode === 'rename' ? nameDialog.item.name : labels.defaultNewName ?? ''}
        placeholder={labels.namePlaceholder}
        onClose={() => setNameDialog(null)}
        onConfirm={handleNameConfirm}
      />

      {onDelete ? (
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
