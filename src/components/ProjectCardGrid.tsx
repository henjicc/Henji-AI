import React from 'react';
import { CheckSquare, FolderOpen, MoreHorizontal, Pencil, Square, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  UI_COVER_FRAME_CLASS,
  UiCheckbox,
  UiEmpty,
  UiIconButton,
  UiLoading,
  UiOptionButton,
} from '@/components/ui';
import { ProjectCardCover } from '@/components/ProjectCardCover';
import { PROJECT_GRID_COLUMNS_CLASS } from '@/components/projectGridLayout';
import type { MenuItem } from '@/hooks/useContextMenu';
import type { UseMultiSelectResult } from '@/hooks/useMultiSelect';

export interface ProjectCardGridItem {
  id: string;
  name: string;
  /** 名称下方的元信息（数量、时长、日期或文件位置）；没有可说的就不传 */
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
}

export interface ProjectCardGridExtraAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: (item: ProjectCardGridItem) => void;
  disabled?: boolean;
}

export interface ProjectCardGridLabels {
  open: string;
  /** 以下三组只在对应能力存在时使用：不能重命名/删除的项目（如剪辑最近打开）可不传 */
  rename?: string;
  delete?: string;
  selectMultiple?: string;
  selectItem?: string;
  deselectItem?: string;
  /** 卡片悬停时右上角“更多”按钮的名称 */
  more: string;
}

interface ProjectCardGridProps {
  items: ProjectCardGridItem[];
  loading: boolean;
  loadingMessage: string;
  busy?: boolean;
  icon?: LucideIcon;
  selection: UseMultiSelectResult;
  labels: ProjectCardGridLabels;
  emptyIcon?: React.ReactNode;
  emptyTitle: string;
  emptyDescription?: string;
  onOpen: (item: ProjectCardGridItem) => void;
  /** 不传 = 该模块不支持重命名，菜单里不出现这一项 */
  onRename?: (item: ProjectCardGridItem) => void;
  /** 不传 = 该模块不支持删除，菜单里没有删除与多选 */
  onDeleteRequest?: (items: ProjectCardGridItem[]) => void;
  extraActions?: (item: ProjectCardGridItem) => ProjectCardGridExtraAction[];
  /**
   * 逐项判断能否重命名、删除、多选（如“文件不存在”的文档不能）；不传 = 都能。
   * 不能管理的项只保留“打开”与它自己的 extraActions。
   */
  canManage?: (item: ProjectCardGridItem) => boolean;
  showMenu: (event: React.MouseEvent, items: MenuItem[]) => void;
  showMenuAt: (anchor: Element, items: MenuItem[]) => void;
}

/**
 * 项目/工程列表的卡片网格（设计稿 CanvasProjects）：封面 + 名称 + 元信息，打开、右键菜单、悬停“更多”菜单、多选批量删除。
 *
 * 五个模块（画布、3D 镜头参考、口播、剪辑、图片编辑）的项目页共用同一份实现，避免同一交互长成两个样子。
 * 重命名、删除按能力出现：调用方不传对应回调，菜单里就没有这一项（删除不在时多选也不在）。
 * 卡片是 `UiOptionButton variant="cover"`：本身无底无框，悬停/焦点/选中都只画在封面框上。
 * “更多”按钮与多选复选框是覆盖在卡片按钮之上的**同级**元素（不嵌进 `<button>` 内部），
 * 静息态不为它们预留布局宽度；“更多”压在封面（真实媒体）上，所以用媒体叠层档 `tone="media"`。
 * 新建入口只在页头（唯一主按钮），网格与空状态不再各放一个（1.1 盘点的“双新建”）。
 */
export const ProjectCardGrid: React.FC<ProjectCardGridProps> = ({
  items,
  loading,
  loadingMessage,
  busy = false,
  icon: Icon,
  selection,
  labels,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  onOpen,
  onRename,
  onDeleteRequest,
  extraActions,
  canManage,
  showMenu,
  showMenuAt,
}) => {
  const manageable = (item: ProjectCardGridItem): boolean => canManage?.(item) ?? true;
  const buildMenuItems = (item: ProjectCardGridItem): MenuItem[] => {
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
  // 只有“打开”一项时不放“更多”与右键菜单：单击卡片就是打开，菜单不再提供新的动作
  const hasMenu = (item: ProjectCardGridItem): boolean => (
    (manageable(item) && Boolean(onRename || onDeleteRequest)) || (extraActions?.(item).length ?? 0) > 0
  );

  if (loading) {
    return <UiLoading size="sm" message={loadingMessage} />;
  }

  if (items.length === 0) {
    return (
      <UiEmpty
        size="sm"
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <div className={`grid ${PROJECT_GRID_COLUMNS_CLASS}`}>
      {items.map((item) => {
        const selected = selection.isSelected(item.id);
        const itemHasMenu = hasMenu(item);
        return (
          <div key={item.id} className="group relative min-w-0">
            <UiOptionButton
              data-project-id={item.id}
              data-project-meta={item.metaLine}
              variant="cover"
              type="button"
              active={selected}
              aria-pressed={selection.active ? selected : undefined}
              className="w-full"
              onClick={() => (selection.active ? selection.toggle(item.id) : onOpen(item))}
              onContextMenu={itemHasMenu ? (event) => showMenu(event, buildMenuItems(item)) : undefined}
              disabled={busy}
            >
              <span className={`${UI_COVER_FRAME_CLASS} aspect-[16/10] w-full`}>
                <ProjectCardCover coverPath={item.coverPath} icon={item.icon ?? Icon} alt={item.name} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5 px-0.5">
                {/* 长名称会截断：悬停名称看全名（A01.7） */}
                <span className="truncate text-13 font-medium text-text1" title={item.name}>{item.name}</span>
                {item.status ? (
                  <span className="truncate text-xs text-danger-text" title={item.status}>{item.status}</span>
                ) : item.metaLine ? (
                  <span className="truncate text-xs text-text3" title={item.metaLine}>{item.metaLine}</span>
                ) : null}
              </span>
            </UiOptionButton>

            {selection.active ? (
              <div className="absolute left-2 top-2">
                <UiCheckbox
                  checked={selected}
                  aria-label={selected ? labels.deselectItem : labels.selectItem}
                  onCheckedChange={() => selection.toggle(item.id)}
                />
              </div>
            ) : itemHasMenu ? (
              <UiIconButton
                tone="media"
                title={labels.more}
                aria-label={labels.more}
                aria-haspopup="menu"
                disabled={busy}
                className="absolute right-2 top-2 opacity-0 transition-opacity duration-120 focus-visible:opacity-100 group-hover:opacity-100"
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
      })}
    </div>
  );
};
