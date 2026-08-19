import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, PackageCheck, PackageOpen } from 'lucide-react';
import { type ProjectCardGridItem } from '@/components/ProjectCardGrid';
import { ProjectLibraryPage, type ProjectLibraryLabels } from '@/components/ProjectLibraryPage';
import { ICON_WORKSPACE_CANVAS } from '@/core/theme/icons';
import { createLogger } from '@/core/logging';
import { UiButton, UiError } from '@/components/ui';
import { UI_CONTENT_OVERLAY_INSET_CLASS } from '@/components/ui/motion';
import { useProjectStore, type ProjectSummary } from '@/stores/projectStore';
import { exportProjectToPackage } from '@/services/projectPackage/exportProject';
import { importProjectFromPackage } from '@/services/projectPackage/importProject';

const logger = createLogger('features.project.ProjectManager');

type Translate = ReturnType<typeof useTranslation>['t'];

function toCardItem(project: ProjectSummary, nodesCountLabel: (count: number) => string): ProjectCardGridItem {
  return {
    id: project.id,
    name: project.name,
    metaLine: `${nodesCountLabel(project.nodeCount)} · ${new Date(project.updatedAt).toLocaleDateString()}`,
    coverPath: project.coverPath,
  };
}

function buildLabels(t: Translate): ProjectLibraryLabels {
  return {
    createAction: t('project.newProject'),
    createDialogTitle: t('project.newProjectTitle'),
    renameDialogTitle: t('project.renameTitle'),
    namePlaceholder: t('project.namePlaceholder'),
    emptyTitle: t('project.empty'),
    emptyDescription: t('project.emptyHint'),
    deleteTitle: t('project.delete'),
    deleteConfirmSingle: (name) => t('project.deleteConfirmSingle', { name }),
    deleteConfirmMultiple: (count) => t('project.deleteConfirmMultiple', { count }),
    confirmDelete: t('project.confirmDelete'),
    cancel: t('common.cancel'),
    card: {
      open: t('project.open'),
      rename: t('project.rename'),
      delete: t('project.delete'),
      selectMultiple: t('project.selectMultiple'),
      selectItem: t('project.selectItem'),
      deselectItem: t('project.deselectItem'),
    },
    selection: {
      selectedCount: (count) => t('project.selectedCount', { count }),
      selectAll: t('project.selectAll'),
      deselectAll: t('project.deselectAll'),
      deleteSelected: t('project.deleteSelected'),
      cancel: t('common.cancel'),
    },
  };
}

export function ProjectManager(): JSX.Element {
  const { t } = useTranslation();
  const [packagingProjectId, setPackagingProjectId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);

  const { projects, isOpeningProject, createProject, deleteProject, renameProject, openProject, hydrate } =
    useProjectStore();

  const cardItems = projects.map((project) => toCardItem(project, (count) => t('project.nodesCount', { count })));

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

  return (
    <>
      <ProjectLibraryPage
        title={t('project.title')}
        items={cardItems}
        icon={ICON_WORKSPACE_CANVAS}
        emptyIcon={<FolderOpen className="h-12 w-12" />}
        busy={isOpeningProject}
        labels={buildLabels(t)}
        headerActions={(
          <UiButton
            onClick={() => void handleImportClick()}
            variant="muted"
            size="sm"
            className="gap-2 px-4"
            disabled={isImporting}
          >
            <PackageOpen className="h-4 w-4" />
            {isImporting ? t('project.importing') : t('project.importPackage')}
          </UiButton>
        )}
        banner={packageError ? <UiError size="xs" className="mb-4" message={packageError} /> : null}
        extraActions={(item) => [
          {
            id: 'export',
            label: t('project.exportPackage'),
            icon: <PackageCheck size={13} />,
            onClick: () => void handleExport(item.id),
            disabled: packagingProjectId === item.id,
          },
        ]}
        onOpen={(item) => openProject(item.id)}
        onCreate={(name) => createProject(name)}
        onRename={(item, name) => renameProject(item.id, name)}
        onDelete={(items) => items.forEach((item) => deleteProject(item.id))}
      />

      {isOpeningProject && (
        <div className={/* ui-surface-allow: 打开项目时的加载遮罩，pointer-events-none 且无内容，不是弹窗 */ `pointer-events-none fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} bg-black/10`} />
      )}
    </>
  );
}
