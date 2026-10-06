import { useTranslation } from 'react-i18next';

import { UiError } from '@/components/ui';
import { DocumentLibraryPage } from '@/features/documents/DocumentLibraryPage';
import { useProjectStore } from '@/stores/projectStore';

/**
 * 画布列表页（3.4）：通用文档页 DocumentLibraryPage kind="canvas"。
 * 取数、筛选（全部 / 不在项目里 / 某个项目）、草稿区与右键（重命名、移到项目、移出项目、创建副本、
 * 在文件夹中显示、导出为单个文件、删除、从列表移除）以及“导入单个文件…”都由通用组件负责（4.1 起通用单文件包
 * 取代画布包）；这里只提供“新建画布”（直接以草稿进入画布）与打开方式。
 */
export function CanvasLibrary(): JSX.Element {
  const { t } = useTranslation();
  const isOpeningProject = useProjectStore((state) => state.isOpeningProject);
  const openError = useProjectStore((state) => state.openError);

  return (
    <DocumentLibraryPage
      kind="canvas"
      title={t('project.title')}
      busy={isOpeningProject}
      describe={(document) => t('project.nodesCount', { count: Number(document.summary.nodes ?? 0) })}
      labels={{ emptyDescription: t('project.emptyHint') }}
      create={{ kind: 'direct', onCreate: () => { void useProjectStore.getState().createCanvasDraft().catch(() => undefined); } }}
      onOpen={async (document) => { await useProjectStore.getState().openCanvasDocument({ id: document.id, path: document.path }); }}
      banner={openError ? <UiError size="xs" align="start" className="mb-4" title={t(openError)} message="" /> : null}
    />
  );
}
