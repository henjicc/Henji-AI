import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { UiButton, UiIconButton, UiPanel } from '@/components/ui';
import { useProjectStore } from '@/stores/projectStore';
import { UI_CONTENT_OVERLAY_INSET_CLASS } from '@/components/ui/motion';
import { RenameDialog } from './RenameDialog';

export function ProjectManager() {
  const { t } = useTranslation();
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');

  const { projects, isOpeningProject, createProject, deleteProject, renameProject, openProject } =
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

        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">{t('project.empty')}</p>
            <p className="text-sm mt-2">{t('project.emptyHint')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <UiPanel
                key={project.id}
                onClick={() => openProject(project.id)}
                className="cursor-pointer border border-border-dark p-4 transition-all hover:border-primary/50 hover:shadow-lg group"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-text-dark truncate flex-1">
                    {project.name}
                  </h3>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
        <div className={`pointer-events-none fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} bg-black/10`} />
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
