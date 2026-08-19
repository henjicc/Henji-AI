import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, PackageCheck, PackageOpen, Plus } from 'lucide-react';
import ContextMenu from '@/components/ContextMenu';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { ProjectCardGrid, type ProjectCardGridItem } from '@/components/ProjectCardGrid';
import { ProjectSelectionToolbar } from '@/components/ProjectSelectionToolbar';
import { RenameDialog } from '@/components/RenameDialog';
import { ICON_WORKSPACE_CANVAS } from '@/core/theme/icons';
import { createLogger } from '@/core/logging';
import { UiButton, UiError, UiPageHeader, UiRegion } from '@/components/ui';
import { UI_CONTENT_OVERLAY_INSET_CLASS } from '@/components/ui/motion';
import { useContextMenu } from '@/hooks/useContextMenu';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { useProjectStore, type ProjectSummary } from '@/stores/projectStore';
import { exportProjectToPackage } from '@/services/projectPackage/exportProject';
import { importProjectFromPackage } from '@/services/projectPackage/importProject';

const logger = createLogger('features.project.ProjectManager');

function toCardItem(project: ProjectSummary, nodesCountLabel: (count: number) => string): ProjectCardGridItem {
  return {
    id: project.id,
    name: project.name,
    metaLine: `${nodesCountLabel(project.nodeCount)} · ${new Date(project.updatedAt).toLocaleDateString()}`,
  };
}

export function ProjectManager(): JSX.Element {
  const { t } = useTranslation();
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [packagingProjectId, setPackagingProjectId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectCardGridItem[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { projects, isOpeningProject, createProject, deleteProject, renameProject, openProject, hydrate } =
    useProjectStore();

  const { menuVisible, menuPosition, menuItems, showMenu, hideMenu } = useContextMenu();
  const selection = useMultiSelect(projects.map((project) => project.id));

  const cardItems = projects.map((project) => toCardItem(project, (count) => t('project.nodesCount', { count })));

  const handleCreateProject = (): void => {
    setEditingProjectId(null);
    setEditingProjectName('');
    setShowRenameDialog(true);
  };

  const handleExport = async (projectId: string): Promise<void> => {
    if (packagingProjectId) return;
    setPackageError(null);
    setPackagingProjectId(projectId);
    try {
      await exportProjectToPackage(projectId);
    } catch (error) {
      logger.error('[ProjectManager] 项目导出失败', error);
      setPackageError(error instanceof Error ? error.message : t('project.exportFailed'));
    } finally {
      setPackagingProjectId(null);
    }
  };

  const handleImportClick = async (): Promise<void> => {
    if (isImporting) return;
    setPackageError(null);
    setIsImporting(true);
    try {
      const importedId = await importProjectFromPackage();
      if (importedId) await hydrate();
    } catch (error) {
      logger.error('[ProjectManager] 项目导入失败', error);
      setPackageError(error instanceof Error ? error.message : t('project.importFailed'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirm = (name: string): void => {
    if (editingProjectId) {
      renameProject(editingProjectId, name);
    } else {
      createProject(name);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      pendingDelete.forEach((item) => deleteProject(item.id));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <div className="ui-scrollbar h-full w-full overflow-auto p-6">
      <UiRegion maxWidthClassName="max-w-6xl" className="mx-auto">
        <UiPageHeader
          className="mb-8"
          title={t('project.title')}
          actions={selection.active ? (
            <ProjectSelectionToolbar
              selection={selection}
              labels={{
                selectedCount: (count) => t('project.selectedCount', { count }),
                selectAll: t('project.selectAll'),
                deselectAll: t('project.deselectAll'),
                deleteSelected: t('project.deleteSelected'),
                cancel: t('common.cancel'),
              }}
              onDeleteSelected={() => setPendingDelete(cardItems.filter((item) => selection.isSelected(item.id)))}
            />
          ) : (
            <>
              <UiButton
                onClick={() => void handleImportClick()}
                variant="muted"
                size="sm"
                className="gap-2 px-4"
                disabled={isImporting}
              >
                <PackageOpen className="w-4 h-4" />
                {isImporting ? t('project.importing') : t('project.importPackage')}
              </UiButton>
              <UiButton onClick={handleCreateProject} variant="primary" size="sm" className="gap-2 px-4">
                <Plus className="w-5 h-5" />
                {t('project.newProject')}
              </UiButton>
            </>
          )}
        />

        {packageError && <UiError size="xs" className="mb-4" message={packageError} />}

        <ProjectCardGrid
          items={cardItems}
          loading={false}
          loadingMessage=""
          busy={isOpeningProject}
          icon={ICON_WORKSPACE_CANVAS}
          selection={selection}
          labels={{
            open: t('project.open'),
            rename: t('project.rename'),
            delete: t('project.delete'),
            selectMultiple: t('project.selectMultiple'),
            selectItem: t('project.selectItem'),
            deselectItem: t('project.deselectItem'),
          }}
          emptyIcon={<FolderOpen className="h-12 w-12" />}
          emptyTitle={t('project.empty')}
          emptyDescription={t('project.emptyHint')}
          onOpen={(item) => openProject(item.id)}
          onRename={(item) => {
            setEditingProjectId(item.id);
            setEditingProjectName(item.name);
            setShowRenameDialog(true);
          }}
          onDeleteRequest={(items) => setPendingDelete(items)}
          extraActions={(item) => [
            {
              id: 'export',
              label: t('project.exportPackage'),
              icon: <PackageCheck size={13} />,
              onClick: () => void handleExport(item.id),
              disabled: packagingProjectId === item.id,
            },
          ]}
          showMenu={showMenu}
        />
      </UiRegion>

      {isOpeningProject && (
        <div className={/* ui-surface-allow: 打开项目时的加载遮罩，pointer-events-none 且无内容，不是弹窗 */ `pointer-events-none fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} bg-black/10`} />
      )}

      <RenameDialog
        isOpen={showRenameDialog}
        title={editingProjectId ? t('project.renameTitle') : t('project.newProjectTitle')}
        defaultValue={editingProjectName}
        onClose={() => setShowRenameDialog(false)}
        onConfirm={handleConfirm}
      />

      <DeleteConfirmDialog
        isOpen={!!pendingDelete}
        title={t('project.delete')}
        message={
          pendingDelete
            ? pendingDelete.length === 1
              ? t('project.deleteConfirmSingle', { name: pendingDelete[0].name })
              : t('project.deleteConfirmMultiple', { count: pendingDelete.length })
            : ''
        }
        cancelLabel={t('common.cancel')}
        confirmLabel={t('project.confirmDelete')}
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

      <ContextMenu items={menuItems} position={menuPosition} onClose={hideMenu} visible={menuVisible} />
    </div>
  );
}
