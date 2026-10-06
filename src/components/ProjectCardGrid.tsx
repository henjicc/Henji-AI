import React from 'react';
import { ArrowDown, CheckSquare, FolderOpen, MoreHorizontal, Pencil, Square, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  UI_COVER_FRAME_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiCheckbox,
  UiEmpty,
  UiIconButton,
  UiOptionButton,
} from '@/components/ui';
import { ProjectCardCover } from '@/components/ProjectCardCover';
import { PROJECT_GRID_COLUMNS_CLASS } from '@/components/projectGridLayout';
import type { ProjectLibrarySort } from '@/components/projectLibraryArrange';
import type { ProjectLibraryView } from '@/components/projectLibraryPrefs';
import type { MenuItem } from '@/hooks/useContextMenu';
import type { UseMultiSelectResult } from '@/hooks/useMultiSelect';

export interface ProjectCardGridItem {
  id: string;
  name: string;
  /** 卡片名称下方的元信息（数量、时长、日期或文件位置）；没有可说的就不传 */
  metaLine?: string;
  /**
   * 需要用户处理的状态（如“文件不存在”），以危险色替换元信息行显示。
   * 只放用户能据此行动的问题，不放内部状态。
   */
  status?: string;
  /** 封面缩略图本地路径；为空时卡片显示占位图 */
  coverPath?: string | null;
  /** 没有封面时占位图中央的图标；不传时用整页的模块图标（如口播按音频/视频区分） */
  icon?: LucideIcon;
  /** 排序用的时间戳（毫秒）；不传时该项按原顺序排在后面 */
  updatedAt?: number;
  createdAt?: number;
  /** 最近一次打开的时间（作品索引记录，任何入口打开都算）；从未打开过不传，“最近打开”分类只列出有它的项 */
  openedAt?: number;
  /** 意外退出留下、尚未保存的草稿：排在最前，带“草稿”标记，只能继续编辑或移到回收站 */
  draft?: boolean;
  /** 列表视图“大小”列；拿不到就不传 */
  sizeBytes?: number;
  /** 列表视图“位置”列（文档所属项目） */
  location?: string;
  /** 列表视图名称后的类型专属说明（如“12 个节点”），不含位置与时间 */
  detail?: string;
}

export interface ProjectCardGridExtraAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: (item: ProjectCardGridItem) => void;
  disabled?: boolean;
  /** 悬停卡片或行时也作为快捷按钮露出（如“在文件夹中显示”）；菜单里照常保留 */
  quick?: boolean;
}

export interface ProjectCardGridLabels {
  open: string;
  /** 以下三组只在对应能力存在时使用：不能重命名/删除的项目可不传 */
  rename?: string;
  delete?: string;
  selectMultiple?: string;
  selectItem?: string;
  deselectItem?: string;
  /** 卡片悬停时右上角“更多”按钮的名称 */
  more: string;
  /** 草稿的标记与菜单（只在有草稿时使用） */
  draft?: { marker: string; open: string; discard: string };
}

/** 列表视图的列名。 */
export interface ProjectListColumnLabels {
  name: string;
  location: string;
  modified: string;
  created: string;
  size: string;
}

interface ProjectCardGridProps {
  items: ProjectCardGridItem[];
  layout: ProjectLibraryView;
  busy?: boolean;
  icon?: LucideIcon;
  selection: UseMultiSelectResult;
  labels: ProjectCardGridLabels;
  columns: ProjectListColumnLabels;
  /** 列表表头点击排序；不传 = 表头不可点（如“最近打开”按打开时间排） */
  sort?: ProjectLibrarySort;
  onSortChange?: (sort: ProjectLibrarySort) => void;
  emptyTitle: string;
  onOpen: (item: ProjectCardGridItem) => void;
  /** 不传 = 该模块不支持重命名，菜单里不出现这一项 */
  onRename?: (item: ProjectCardGridItem) => void;
  /** 不传 = 该模块不支持删除，菜单里没有删除与多选 */
  onDeleteRequest?: (items: ProjectCardGridItem[]) => void;
  /** 草稿“移到回收站” */
  onDiscardDraftRequest?: (item: ProjectCardGridItem) => void;
  extraActions?: (item: ProjectCardGridItem) => ProjectCardGridExtraAction[];
  /**
   * 逐项判断能否重命名、删除、多选（如“文件不存在”的文档不能）；不传 = 都能。
   * 不能管理的项只保留“打开”与它自己的 extraActions。
   */
  canManage?: (item: ProjectCardGridItem) => boolean;
  showMenu: (event: React.MouseEvent, items: MenuItem[]) => void;
  showMenuAt: (anchor: Element, items: MenuItem[]) => void;
}

/*
 * 列表视图的列：名称 | 位置 | 时间 | 大小 | 悬停快捷操作。位置、大小两列只在有数据时出现。
 * 时间与大小是固定宽读数列，快捷操作列给 3 个图标按钮留位，避免悬停时盖住读数。
 */
const LIST_COLUMNS_CLASS = {
  full: 'grid-cols-[minmax(0,1fr)_minmax(0,22%)_9rem_5rem_6rem]',
  location: 'grid-cols-[minmax(0,1fr)_minmax(0,22%)_9rem_6rem]',
  size: 'grid-cols-[minmax(0,1fr)_9rem_5rem_6rem]',
  plain: 'grid-cols-[minmax(0,1fr)_9rem_6rem]',
} as const;

function formatListTime(time: number | undefined): string {
  if (time === undefined) return '';
  return new Date(time).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * 项目/工程列表的两种视图：封面网格（设计稿 CanvasProjects）与按列排的列表（参照 Premiere 主页的最近项目列表）。
 *
 * 五个模块（画布、3D 镜头参考、口播、剪辑、图片编辑）的项目页共用同一份实现，避免同一交互长成两个样子。
 * 重命名、删除按能力出现：调用方不传对应回调，菜单里就没有这一项（删除不在时多选也不在）。
 * 网格卡片是 `UiOptionButton variant="cover"`：本身无底无框，悬停/焦点/选中都只画在封面框上；
 * 列表行是 `UiOptionButton variant="menu"`：静息无底无框，悬停出底。
 * 悬停快捷操作（重命名、带 `quick` 的动作）与“更多”、多选复选框都是覆盖在卡片或行之上的**同级**元素（不嵌进 `<button>`）。
 * 草稿排在最前，带虚线警示框与“草稿”标记；只能继续编辑或移到回收站，不参与多选。
 * 新建入口只在页面左栏（唯一主按钮），网格与空状态不再各放一个。
 */
export const ProjectCardGrid: React.FC<ProjectCardGridProps> = ({
  items,
  layout,
  busy = false,
  icon: Icon,
  selection,
  labels,
  columns,
  sort,
  onSortChange,
  emptyTitle,
  onOpen,
  onRename,
  onDeleteRequest,
  onDiscardDraftRequest,
  extraActions,
  canManage,
  showMenu,
  showMenuAt,
}) => {
  const manageable = (item: ProjectCardGridItem): boolean => !item.draft && (canManage?.(item) ?? true);
  const buildMenuItems = (item: ProjectCardGridItem): MenuItem[] => {
    if (item.draft) {
      return [
        { id: 'open', label: labels.draft?.open ?? labels.open, icon: <FolderOpen className="h-4 w-4" />, onClick: () => onOpen(item) },
        ...(onDiscardDraftRequest ? [{
          id: 'discard-draft',
          label: labels.draft?.discard ?? '',
          icon: <Trash2 className="h-4 w-4" />,
          onClick: () => onDiscardDraftRequest(item),
          divider: true,
        }] : []),
      ];
    }
    if (selection.active) {
      const selected = selection.isSelected(item.id);
      return [
        {
          id: 'toggle-select',
          label: (selected ? labels.deselectItem : labels.selectItem) ?? '',
          icon: selected ? <Square className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />,
          onClick: () => selection.toggle(item.id),
        },
      ];
    }
    const actions = extraActions?.(item) ?? [];
    const menu: MenuItem[] = [
      { id: 'open', label: labels.open, icon: <FolderOpen className="h-4 w-4" />, onClick: () => onOpen(item) },
    ];
    const manage = manageable(item);
    if (onRename && manage) {
      menu.push({ id: 'rename', label: labels.rename ?? '', icon: <Pencil className="h-4 w-4" />, onClick: () => onRename(item) });
    }
    menu.push(...actions.map((action) => ({
      id: action.id,
      label: action.label,
      icon: action.icon,
      onClick: () => action.onClick(item),
      disabled: action.disabled,
    })));
    if (onDeleteRequest && manage) {
      menu.push(
        {
          id: 'delete',
          label: labels.delete ?? '',
          icon: <Trash2 className="h-4 w-4" />,
          onClick: () => onDeleteRequest([item]),
          divider: true,
        },
        {
          id: 'select-multiple',
          label: labels.selectMultiple ?? '',
          icon: <CheckSquare className="h-4 w-4" />,
          onClick: () => selection.enter(item.id),
        },
      );
    }
    return menu;
  };
  // 只有“打开”一项时不放“更多”与右键菜单：单击就是打开，菜单不再提供新的动作
  const hasMenu = (item: ProjectCardGridItem): boolean => (
    (item.draft && Boolean(onDiscardDraftRequest))
    || (manageable(item) && Boolean(onRename || onDeleteRequest))
    || (extraActions?.(item).length ?? 0) > 0
  );

  if (items.length === 0) {
    return <UiEmpty size="sm" title={emptyTitle} />;
  }

  /** 悬停露出的快捷按钮 + “更多”；多选时换成复选框。网格压在封面上用媒体档，列表落在行底色上用默认档。 */
  const renderOverlay = (item: ProjectCardGridItem, tone: 'media' | 'default'): React.ReactNode => {
    const selected = selection.isSelected(item.id);
    if (selection.active) {
      if (item.draft) return null;
      return (
        <UiCheckbox
          checked={selected}
          aria-label={selected ? labels.deselectItem : labels.selectItem}
          onCheckedChange={() => selection.toggle(item.id)}
        />
      );
    }
    const quick: { id: string; label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }[] = [];
    if (!item.draft && onRename && manageable(item)) {
      quick.push({ id: 'rename', label: labels.rename ?? '', icon: <Pencil className="h-4 w-4" />, onClick: () => onRename(item) });
    }
    if (!item.draft) {
      for (const action of extraActions?.(item) ?? []) {
        if (action.quick) quick.push({ id: action.id, label: action.label, icon: action.icon, onClick: () => action.onClick(item), disabled: action.disabled });
      }
    }
    if (!quick.length && !hasMenu(item)) return null;
    return (
      <div className="flex items-center gap-1 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover:opacity-100">
        {quick.map((action) => (
          <UiIconButton
            key={action.id}
            tone={tone}
            title={action.label}
            aria-label={action.label}
            disabled={busy || action.disabled}
            onClick={(event) => {
              event.stopPropagation();
              action.onClick();
            }}
          >
            {action.icon}
          </UiIconButton>
        ))}
        {hasMenu(item) ? (
          <UiIconButton
            tone={tone}
            title={labels.more}
            aria-label={labels.more}
            aria-haspopup="menu"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              showMenuAt(event.currentTarget, buildMenuItems(item));
            }}
          >
            <MoreHorizontal className="h-4 w-4" />
          </UiIconButton>
        ) : null}
      </div>
    );
  };

  const commonButtonProps = (item: ProjectCardGridItem) => {
    const selected = !item.draft && selection.isSelected(item.id);
    return {
      'data-project-id': item.id,
      'data-project-meta': item.metaLine,
      'data-project-draft': item.draft ? 'true' : undefined,
      type: 'button' as const,
      active: selected,
      'aria-pressed': selection.active && !item.draft ? selected : undefined,
      onClick: () => (selection.active && !item.draft ? selection.toggle(item.id) : onOpen(item)),
      onContextMenu: hasMenu(item) ? (event: React.MouseEvent) => showMenu(event, buildMenuItems(item)) : undefined,
      disabled: busy,
    };
  };

  const draftMarker = labels.draft ? (
    <span className="shrink-0 text-xs font-medium text-warning-text">{labels.draft.marker}</span>
  ) : null;

  if (layout === 'list') {
    const hasLocation = items.some((item) => item.location);
    const hasSize = items.some((item) => item.sizeBytes !== undefined);
    const columnsClass = LIST_COLUMNS_CLASS[hasLocation ? (hasSize ? 'full' : 'location') : hasSize ? 'size' : 'plain'];
    // 项目列表（剪辑）没有修改时间，时间列改为创建时间并按它排序
    const timeSort: ProjectLibrarySort = items.some((item) => item.updatedAt !== undefined) ? 'updated' : 'created';
    const headerCell = (label: string, key?: ProjectLibrarySort): React.ReactNode => (
      key && onSortChange ? (
        <UiButton size="sm" className="-ml-2 justify-self-start" aria-pressed={sort === key} onClick={() => onSortChange(key)}>
          {label}
          {sort === key ? <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        </UiButton>
      ) : (
        <span className={`truncate ${UI_TEXT_META_CLASS}`}>{label}</span>
      )
    );
    return (
      <div data-project-list-view className="flex flex-col">
        <div className={`grid ${columnsClass} items-center gap-4 border-b border-line pb-1.5 ${selection.active ? 'pl-11' : 'pl-2.5'} pr-2.5`}>
          {headerCell(columns.name, 'name')}
          {hasLocation ? headerCell(columns.location) : null}
          {headerCell(timeSort === 'updated' ? columns.modified : columns.created, timeSort)}
          {hasSize ? headerCell(columns.size) : null}
          <span aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-0.5 pt-1">
          {items.map((item) => {
            const time = timeSort === 'updated' ? item.updatedAt : item.createdAt;
            return (
              <div key={item.id} className="group relative min-w-0">
                <UiOptionButton
                  {...commonButtonProps(item)}
                  variant="menu"
                  size="lg"
                  selection="multiple"
                  className={`grid w-full ${columnsClass} gap-4 ${selection.active ? 'pl-11' : ''}`}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    {item.draft ? draftMarker : null}
                    <span className="truncate font-medium text-text1" title={item.name}>{item.name}</span>
                    {item.status ? (
                      <span className="shrink-0 text-xs text-danger-text">{item.status}</span>
                    ) : item.detail ? (
                      <span className="truncate text-xs text-text3">{item.detail}</span>
                    ) : null}
                  </span>
                  {hasLocation ? <span className="truncate text-xs text-text2" title={item.location}>{item.location ?? ''}</span> : null}
                  <span className="truncate text-xs tabular-nums text-text2">{formatListTime(time)}</span>
                  {hasSize ? <span className="truncate text-xs tabular-nums text-text2">{formatSize(item.sizeBytes)}</span> : null}
                  <span aria-hidden="true" />
                </UiOptionButton>
                <div className={`absolute top-1/2 -translate-y-1/2 ${selection.active ? 'left-3' : 'right-2'}`}>
                  {renderOverlay(item, 'default')}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={`grid ${PROJECT_GRID_COLUMNS_CLASS}`}>
      {items.map((item) => (
        <div key={item.id} className="group relative min-w-0">
          <UiOptionButton
            {...commonButtonProps(item)}
            variant="cover"
            className="w-full"
          >
            <span data-draft={item.draft ? 'true' : undefined} className={`${UI_COVER_FRAME_CLASS} aspect-[16/10] w-full`}>
              <ProjectCardCover coverPath={item.coverPath} icon={item.icon ?? Icon} alt={item.name} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 px-0.5">
              {/* 长名称会截断：悬停名称看全名（A01.7） */}
              <span className="truncate text-13 font-medium text-text1" title={item.name}>{item.name}</span>
              {item.status ? (
                <span className="truncate text-xs text-danger-text" title={item.status}>{item.status}</span>
              ) : item.draft ? (
                <span className="flex min-w-0 items-baseline gap-1.5">
                  {draftMarker}
                  {item.metaLine ? <span className="truncate text-xs text-text3" title={item.metaLine}>{item.metaLine}</span> : null}
                </span>
              ) : item.metaLine ? (
                <span className="truncate text-xs text-text3" title={item.metaLine}>{item.metaLine}</span>
              ) : null}
            </span>
          </UiOptionButton>
          <div className={`absolute top-2 ${selection.active ? 'left-2' : 'right-2'}`}>
            {renderOverlay(item, 'media')}
          </div>
        </div>
      ))}
    </div>
  );
};
