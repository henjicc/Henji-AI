import React, { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
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
import { Dropdown, UiButton, UiInput, UiPageHeader, UiRegion } from '@/components/ui';
import { PROJECT_GRID_MAX_WIDTH_CLASS } from '@/components/projectGridLayout';
import {
  PROJECT_LIBRARY_SORT_ORDER,
  arrangeProjectItems,
  type ProjectLibrarySort,
} from '@/components/projectLibraryArrange';
import { useContextMenu } from '@/hooks/useContextMenu';
import { useMultiSelect } from '@/hooks/useMultiSelect';

export interface ProjectLibraryLabels {
  /** 页头唯一主按钮「新建」的文案 */
  createAction: string;
  /** 标题旁的数量，如「12 个项目」 */
  count: (count: number) => string;
  searchPlaceholder: string;
  /** 搜索没有命中时的空状态标题 */
  noResults: string;
  sortLabel: string;
  sortOptions: Record<ProjectLibrarySort, string>;
  createDialogTitle: string;
  renameDialogTitle: string;
  namePlaceholder?: string;
  /** 新建对话框的预填名称 */
  defaultNewName?: string;
  loadingMessage?: string;
  emptyTitle: string;
  emptyDescription?: string;
  deleteTitle: string;
  deleteConfirmSingle: (name: string) => string;
  deleteConfirmMultiple: (count: number) => string;
  confirmDelete: string;
  cancel: string;
  card: ProjectCardGridLabels;
  selection: ProjectSelectionToolbarLabels;
}

interface ProjectLibraryPageProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  items: ProjectCardGridItem[];
  icon?: LucideIcon;
  emptyIcon?: React.ReactNode;
  loading?: boolean;
  /** 打开/新建过程中禁用卡片交互 */
  busy?: boolean;
  labels: ProjectLibraryLabels;
  /** 非多选态时排在「新建」左侧的场景专属动作（如导入项目包） */
  headerActions?: React.ReactNode;
  /** 标题区与网格之间的场景专属内容（如错误条） */
  banner?: React.ReactNode;
  /** 二级页面的返回入口，渲染在标题左侧；一级页面（画布工作区）不传 */
  onBack?: () => void;
  backLabel?: string;
  extraActions?: (item: ProjectCardGridItem) => ProjectCardGridExtraAction[];
  onOpen: (item: ProjectCardGridItem) => void;
  onCreate: (name: string) => void;
  onRename: (item: ProjectCardGridItem, name: string) => void;
  onDelete: (items: ProjectCardGridItem[]) => void | Promise<void>;
}

type NameDialogState =
  | { mode: 'create' }
  | { mode: 'rename'; item: ProjectCardGridItem }
  | null;

/**
 * 项目库页面：画布项目与 3D 镜头参考工程共用的完整页面外壳。
 *
 * 页头按设计稿 CanvasProjects 是**一条**：标题 + 数量 ｜ 搜索、排序（静默下拉）｜ 场景动作（导入，静默）、
 * 新建（这一屏唯一的主按钮）。多选时整组动作换成多选工具条。搜索与排序只作用于本页显示。
 *
 * 收口的是**页面骨架加接线**——滚动容器、标题区、多选工具条切换、新建/重命名对话框、
 * 删除确认的单条/多条文案分支、右键菜单挂载——而不只是卡片。此前这套接线在两个页面
 * 里各写了一遍，结果同一个页面在两处的内边距、标题间距、空态图标和 loading 传参都不一样。
 *
 * 调用方只提供数据来源与场景专属动作：`headerActions` 注入页面级动作，`extraActions`
 * 注入卡片级动作，`banner` 注入场景专属提示；除此之外不开放样式覆盖口子，
 * 否则两处又会各自漂移回去。
 */
export function ProjectLibraryPage({
  title,
  description,
  items,
  icon,
  emptyIcon,
  loading = false,
  busy = false,
  labels,
  headerActions,
  banner,
  onBack,
  backLabel,
  extraActions,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: ProjectLibraryPageProps): JSX.Element {
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectCardGridItem[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProjectLibrarySort>('updated');

  const { menuVisible, menuPosition, menuItems, showMenu, showMenuAt, hideMenu } = useContextMenu();
  const visibleItems = useMemo(() => arrangeProjectItems(items, query, sort), [items, query, sort]);
  // 多选的「全选」只覆盖当前搜索结果，删除也只会删看得见的项目
  const visibleIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const selection = useMultiSelect(visibleIds);
  const searching = query.trim().length > 0;

  const openCreateDialog = (): void => setNameDialog({ mode: 'create' });

  const handleNameConfirm = (name: string): void => {
    if (!nameDialog) return;
    if (nameDialog.mode === 'rename') {
      onRename(nameDialog.item, name);
      return;
    }
    onCreate(name);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
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

  return (
    // 列数由窗口宽度算出（见 projectGridLayout.ts），左右留白交给这里的横向 padding。
    // 最大宽度封顶列数，标题区与网格共用它，否则宽屏上「新建」按钮会飞到网格右边之外。
    <div className="ui-scrollbar h-full w-full overflow-auto bg-window px-6 py-8 xl:px-10">
      <UiRegion maxWidthClassName={PROJECT_GRID_MAX_WIDTH_CLASS} className="mx-auto">
        <UiPageHeader
          className="mb-7"
          title={title}
          meta={loading ? undefined : labels.count(items.length)}
          description={description}
          onBack={onBack}
          backLabel={backLabel}
          actions={selection.active ? (
            <ProjectSelectionToolbar
              selection={selection}
              labels={labels.selection}
              onDeleteSelected={() => setPendingDelete(visibleItems.filter((item) => selection.isSelected(item.id)))}
            />
          ) : (
            <>
              {items.length > 0 ? (
                <>
                  <div className="relative w-56">
                    <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text3" />
                    <UiInput
                      className="pl-8"
                      value={query}
                      aria-label={labels.searchPlaceholder}
                      placeholder={labels.searchPlaceholder}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }}
                    />
                  </div>
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
                  {/* 视图控制（搜索、排序）与动作（导入、新建）语义不同：这条带唯一的分隔线 */}
                  <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
                </>
              ) : null}
              {headerActions}
              <UiButton onClick={openCreateDialog} variant="primary" disabled={busy}>
                <Plus className="h-4 w-4" />
                {labels.createAction}
              </UiButton>
            </>
          )}
        />

        {banner}

        <ProjectCardGrid
          items={visibleItems}
          loading={loading}
          loadingMessage={labels.loadingMessage ?? ''}
          busy={busy}
          icon={icon}
          selection={selection}
          labels={labels.card}
          emptyIcon={emptyIcon}
          emptyTitle={searching ? labels.noResults : labels.emptyTitle}
          emptyDescription={searching ? undefined : labels.emptyDescription}
          onOpen={onOpen}
          onRename={(item) => setNameDialog({ mode: 'rename', item })}
          onDeleteRequest={(targets) => setPendingDelete(targets)}
          extraActions={extraActions}
          showMenu={showMenu}
          showMenuAt={showMenuAt}
        />
      </UiRegion>

      <RenameDialog
        isOpen={nameDialog !== null}
        title={nameDialog?.mode === 'rename' ? labels.renameDialogTitle : labels.createDialogTitle}
        defaultValue={nameDialog?.mode === 'rename' ? nameDialog.item.name : labels.defaultNewName ?? ''}
        placeholder={labels.namePlaceholder}
        onClose={() => setNameDialog(null)}
        onConfirm={handleNameConfirm}
      />

      <DeleteConfirmDialog
        isOpen={!!pendingDelete}
        title={labels.deleteTitle}
        message={
          pendingDelete
            ? pendingDelete.length === 1
              ? labels.deleteConfirmSingle(pendingDelete[0].name)
              : labels.deleteConfirmMultiple(pendingDelete.length)
            : ''
        }
        cancelLabel={labels.cancel}
        confirmLabel={labels.confirmDelete}
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

      <ContextMenu items={menuItems} position={menuPosition} onClose={hideMenu} visible={menuVisible} />
    </div>
  );
}
