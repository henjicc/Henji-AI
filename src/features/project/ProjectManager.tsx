import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, FolderOpen, Pencil, Trash2, PackageOpen, PackageCheck } from 'lucide-react';
import { createLogger } from '@/core/logging';
import { UiButton, UiEmpty, UiError, UiIconButton, UiPanel } from '@/components/ui';
import { useProjectStore } from '@/stores/projectStore';
import { UI_CONTENT_OVERLAY_INSET_CLASS } from '@/components/ui/motion';
import { exportProjectToPackage } from '@/services/projectPackage/exportProject';
import { importProjectFromPackage } from '@/services/projectPackage/importProject';
import { RenameDialog } from './RenameDialog';

const logger = createLogger('features.project.ProjectManager');

export function ProjectManager(): JSX.Element {
  const { t } = useTranslation();
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [packagingProjectId, setPackagingProjectId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);

  const { projects, isOpeningProject, createProject, deleteProject, renameProject, openProject, hydrate } =
    useProjectStore();

  const handleCreateProject = () => {
    setEditingProjectId(null);
    setEditingProjectName('');
    setShowRenameDialog(true);
  };

  const handleRenameClick = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(id);
    setEditingProjectName(name);
    setShowRenameDialog(true);
  };

  const handleDeleteClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteProject(id);
  };

  const handleExportClick = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (packagingProjectId) {
      return;
    }
    setPackageError(null);
    setPackagingProjectId(id);
    try {
      await exportProjectToPackage(id);
    } catch (error) {
      logger.error('[ProjectManager] 项目导出失败', error);
      setPackageError(error instanceof Error ? error.message : t('project.exportFailed'));
    } finally {
      setPackagingProjectId(null);
    }
  };

  const handleImportClick = async () => {
    if (isImporting) {
      return;
    }
    setPackageError(null);
    setIsImporting(true);
    try {
      const importedId = await importProjectFromPackage();
      if (importedId) {
        await hydrate();
      }
    } catch (error) {
      logger.error('[ProjectManager] 项目导入失败', error);
      setPackageError(error instanceof Error ? error.message : t('project.importFailed'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirm = (name: string) => {
    if (editingProjectId) {
      renameProject(editingProjectId, name);
    } else {
      createProject(name);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="ui-scrollbar h-full w-full overflow-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-text-dark">{t('project.title')}</h1>
          <div className="flex items-center gap-2">
            <UiButton
              onClick={() => {
                void handleImportClick();
              }}
              variant="muted"
              size="sm"
              className="gap-2 px-4"
              disabled={isImporting}
            >
              <PackageOpen className="w-4 h-4" />
              {isImporting ? t('project.importing') : t('project.importPackage')}
            </UiButton>
            <UiButton
              onClick={handleCreateProject}
              variant="primary"
              size="sm"
              className="gap-2 px-4"
            >
              <Plus className="w-5 h-5" />
              {t('project.newProject')}
            </UiButton>
          </div>
        </div>

        {packageError && <UiError size="xs" className="mb-4" message={packageError} />}

        {projects.length === 0 ? (
          <UiEmpty
            icon={<FolderOpen className="h-12 w-12" />}
            title={t('project.empty')}
            description={t('project.emptyHint')}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <UiPanel
                key={project.id}
                onClick={() => openProject(project.id)}
                className="cursor-pointer border border-border-dark p-4 transition-colors hover:border-primary/50 group"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-text-dark truncate flex-1">
                    {project.name}
                  </h3>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <UiIconButton
                      onClick={(e) => {
                        void handleExportClick(project.id, e);
                      }}
                      className="!h-7 !w-7"
                      title={t('project.exportPackage')}
                      disabled={packagingProjectId === project.id}
                    >
                      <PackageCheck className="w-4 h-4 text-text-muted hover:text-text-dark" />
                    </UiIconButton>
                    <UiIconButton
                      onClick={(e) => handleRenameClick(project.id, project.name, e)}
                      className="!h-7 !w-7"
                      title={t('project.rename')}
                    >
                      <Pencil className="w-4 h-4 text-text-muted hover:text-text-dark" />
                    </UiIconButton>
                    <UiIconButton
                      onClick={(e) => handleDeleteClick(project.id, e)}
                      className="!h-7 !w-7"
                      title={t('project.delete')}
                    >
                      <Trash2 className="w-4 h-4 text-text-muted hover:text-red-500" />
                    </UiIconButton>
                  </div>
                </div>
                <div className="text-xs text-text-muted">
                  <p>
                    {t('project.nodes')}: {project.nodeCount}
                  </p>
                  <p>
                    {t('project.updatedAt')}: {formatDate(project.updatedAt)}
                  </p>
                </div>
              </UiPanel>
            ))}
          </div>
        )}
      </div>

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
    </div>
  );
}
