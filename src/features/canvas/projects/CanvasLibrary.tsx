import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, PackageCheck, PackageOpen } from 'lucide-react';

import { UI_TEXT_META_CLASS, UiError } from '@/components/ui';
import { createLogger } from '@/core/logging';
import type { DocumentSummary } from '@/core/documents/types';
import { DocumentLibraryPage } from '@/features/documents/DocumentLibraryPage';
import { exportProjectToPackage } from '@/services/projectPackage/exportProject';
import { importProjectFromPackage } from '@/services/projectPackage/importProject';
import { useProjectStore } from '@/stores/projectStore';

const logger = createLogger('features.canvas.projects.CanvasLibrary');

/**
 * 画布列表页（3.4）：通用文档页 DocumentLibraryPage kind="canvas"。
 * 取数、筛选（全部 / 不在项目里 / 某个项目）、草稿区与右键（重命名、移到项目、移出项目、创建副本、
 * 在文件夹中显示、删除、从列表移除）都由通用组件负责；这里只提供“新建画布”（直接以草稿进入画布）、
 * 打开方式，以及画布包的导入 / 导出（4.1 改为通用单文件包前保留）。
 */
export function CanvasLibrary(): JSX.Element {
  const { t } = useTranslation();
  const isOpeningProject = useProjectStore((state) => state.isOpeningProject);
  const openError = useProjectStore((state) => state.openError);
  const [packagingId, setPackagingId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const exportingRef = useRef(false);
  // 导入导出失败：标题说明是哪个操作失败，正文是原因
  const [packageError, setPackageError] = useState<{ title: string; detail: string } | null>(null);

  const handleExport = async (document: DocumentSummary): Promise<void> => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setPackageError(null);
    setPackagingId(document.id);
    try {
      await exportProjectToPackage(document.id);
    } catch (error) {
      logger.error('画布包导出失败', error);
      setPackageError({ title: t('project.exportFailed'), detail: error instanceof Error ? error.message : '' });
    } finally {
      exportingRef.current = false;
      setPackagingId(null);
    }
  };

  const handleImport = async (): Promise<void> => {
    if (isImporting) return;
    setPackageError(null);
    setIsImporting(true);
    try {
      await importProjectFromPackage();
    } catch (error) {
      logger.error('画布包导入失败', error);
      setPackageError({ title: t('project.importFailed'), detail: error instanceof Error ? error.message : '' });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <DocumentLibraryPage
      kind="canvas"
      title={t('project.title')}
      busy={isOpeningProject}
      describe={(document) => t('project.nodesCount', { count: Number(document.summary.nodes ?? 0) })}
      labels={{ emptyDescription: t('project.emptyHint') }}
      create={{ kind: 'direct', onCreate: () => { void useProjectStore.getState().createCanvasDraft().catch(() => undefined); } }}
      onOpen={async (document) => { await useProjectStore.getState().openCanvasDocument({ id: document.id, path: document.path }); }}
      secondaryAction={{
        label: isImporting ? t('project.importing') : t('project.importPackage'),
        icon: PackageOpen,
        onClick: () => void handleImport(),
        disabled: isImporting,
      }}
      documentActions={(document) => [{
        id: 'export-package',
        // 同一时间只导出一个画布包：导出进行中所有卡片的这一项都禁用，正在导出的那一项显示“正在导出…”
        label: packagingId === document.id ? t('project.exporting') : t('project.exportPackage'),
        icon: <PackageCheck className="h-4 w-4" />,
        onClick: () => void handleExport(document),
        disabled: packagingId !== null,
      }]}
      banner={packagingId ? (
        <p role="status" className={`mb-4 flex items-center gap-2 ${UI_TEXT_META_CLASS}`}>
          <LoaderCircle aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
          {t('project.exporting')}
        </p>
      ) : packageError ? (
        <UiError size="xs" align="start" className="mb-4" title={packageError.title} message={packageError.detail} />
      ) : openError ? (
        <UiError size="xs" align="start" className="mb-4" title={t(openError)} message="" />
      ) : null}
    />
  );
}
