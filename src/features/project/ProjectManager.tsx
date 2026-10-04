import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, LoaderCircle, PackageCheck, PackageOpen } from 'lucide-react';
import { type ProjectCardGridItem } from '@/components/ProjectCardGrid';
import { ProjectLibraryPage, type ProjectLibraryLabels } from '@/components/ProjectLibraryPage';
import { ICON_WORKSPACE_CANVAS } from '@/core/theme/icons';
import { createLogger } from '@/core/logging';
import { UI_TEXT_META_CLASS, UiButton, UiError } from '@/components/ui';
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
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,
  };
}

function buildLabels(t: Translate): ProjectLibraryLabels {
  return {
    createAction: t('project.newProject'),
    count: (count) => t('project.count', { count }),
    searchPlaceholder: t('project.search'),
    noResults: t('project.noResults'),
    sortLabel: t('project.sort'),
    sortOptions: {
      updated: t('project.sortUpdated'),
      created: t('project.sortCreated'),
      name: t('project.sortName'),
    },
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
      more: t('project.more'),
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
  // 同步守卫：状态更新前的连续触发（如菜单项被连点）也只导出一次
  const exportingRef = useRef(false);
  // 项目包导入导出失败：标题说明是哪个操作失败，正文是原因（UiError 无标题时只剩弱化文字，失败不可辨）
  const [packageError, setPackageError] = useState<{ title: string; detail: string } | null>(null);

  const { projects, isOpeningProject, openError, persistenceError, createProject, deleteProject, renameProject, openProject, hydrate } =
    useProjectStore();

  const cardItems = projects.map((project) => toCardItem(project, (count) => t('project.nodesCount', { count })));

  const handleExport = async (projectId: string): Promise<void> => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setPackageError(null);
    setPackagingProjectId(projectId);
    try {
      await exportProjectToPackage(projectId);
    } catch (error) {
      logger.error('[ProjectManager] 项目导出失败', error);
      setPackageError({ title: t('project.exportFailed'), detail: error instanceof Error ? error.message : '' });
    } finally {
      exportingRef.current = false;
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
      setPackageError({ title: t('project.importFailed'), detail: error instanceof Error ? error.message : '' });
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
            disabled={isImporting}
          >
            <PackageOpen className="h-4 w-4" />
            {isImporting ? t('project.importing') : t('project.importPackage')}
          </UiButton>
        )}
        banner={packagingProjectId ? (
          // 导出期间菜单已收起，在页头下方常驻进行中提示；完成与失败沿用原有提示
          <p role="status" className={`mb-4 flex items-center gap-2 ${UI_TEXT_META_CLASS}`}>
            <LoaderCircle aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
            {t('project.exporting')}
          </p>
        ) : packageError ? (
          <UiError size="xs" align="start" className="mb-4" title={packageError.title} message={packageError.detail} />
        ) : (openError || persistenceError) ? (
          // 打开失败、保存失败的文案本身就是完整的后果与下一步，作为标题（危险色）显示
          <UiError size="xs" align="start" className="mb-4" title={t(openError ?? persistenceError ?? 'project.persistenceFailed')} message="" />
        ) : null}
        extraActions={(item) => [
          {
            id: 'export',
            // 同一时间只导出一个项目包：导出进行中所有项目的这一项都禁用，正在导出的那一项显示“正在导出…”
            label: packagingProjectId === item.id ? t('project.exporting') : t('project.exportPackage'),
            icon: <PackageCheck className="h-4 w-4" />,
            onClick: () => void handleExport(item.id),
            disabled: packagingProjectId !== null,
          },
        ]}
        onOpen={(item) => openProject(item.id)}
        onCreate={(name) => { void createProject(name).catch(() => undefined) }}
        onRename={(item, name) => { void renameProject(item.id, name).catch(() => undefined) }}
        onDelete={async (items) => {
          await Promise.all(items.map((item) => deleteProject(item.id))).catch(() => undefined)
        }}
      />
    </>
  );
}
