import React, { useState } from 'react';
import { Plus } from 'lucide-react';
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
import { UiButton, UiPageHeader, UiRegion } from '@/components/ui';
import { useContextMenu } from '@/hooks/useContextMenu';
import { useMultiSelect } from '@/hooks/useMultiSelect';

export interface ProjectLibraryLabels {
  /** 页面主按钮与网格首格的「新建」文案 */
  createAction: string;
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

  const { menuVisible, menuPosition, menuItems, showMenu, hideMenu } = useContextMenu();
  const selection = useMultiSelect(items.map((item) => item.id));

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
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <div className="ui-scrollbar h-full w-full overflow-auto bg-app p-6">
      <UiRegion maxWidthClassName="max-w-6xl" className="mx-auto">
        <UiPageHeader
          className="mb-6"
          title={title}
          description={description}
          onBack={onBack}
          backLabel={backLabel}
          actions={selection.active ? (
            <ProjectSelectionToolbar
              selection={selection}
              labels={labels.selection}
              onDeleteSelected={() => setPendingDelete(items.filter((item) => selection.isSelected(item.id)))}
            />
          ) : (
            <>
              {headerActions}
              <UiButton onClick={openCreateDialog} variant="primary" size="sm" className="gap-2 px-4" disabled={busy}>
                <Plus className="h-4 w-4" />
                {labels.createAction}
              </UiButton>
            </>
          )}
        />

        {banner}

        <ProjectCardGrid
          items={items}
          loading={loading}
          loadingMessage={labels.loadingMessage ?? ''}
          busy={busy}
          icon={icon}
          selection={selection}
          labels={labels.card}
          emptyIcon={emptyIcon}
          emptyTitle={labels.emptyTitle}
          emptyDescription={labels.emptyDescription}
          onCreate={openCreateDialog}
          createLabel={labels.createAction}
          onOpen={onOpen}
          onRename={(item) => setNameDialog({ mode: 'rename', item })}
          onDeleteRequest={(targets) => setPendingDelete(targets)}
          extraActions={extraActions}
          showMenu={showMenu}
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
