import React from 'react';
import { CheckSquare, FolderOpen, Pencil, Plus, Square, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  UI_MULTISELECT_ITEM_ACTIVE_OVERRIDE_CLASS,
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
  metaLine: string;
  /** 封面缩略图本地路径；为空时卡片显示占位图 */
  coverPath?: string | null;
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
  rename: string;
  delete: string;
  selectMultiple: string;
  selectItem: string;
  deselectItem: string;
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
  /** 传入后网格首格是「新建」入口；不传则只渲染既有项目 */
  onCreate?: () => void;
  createLabel?: string;
  onOpen: (item: ProjectCardGridItem) => void;
  onRename: (item: ProjectCardGridItem) => void;
  onDeleteRequest: (items: ProjectCardGridItem[]) => void;
  extraActions?: (item: ProjectCardGridItem) => ProjectCardGridExtraAction[];
  showMenu: (event: React.MouseEvent, items: MenuItem[]) => void;
}

/**
 * 项目/工程列表的卡片网格：封面 + 名称 + 元信息，打开、重命名、删除、右键菜单、多选批量删除。
 *
 * 画布工程与 3D 镜头参考工程共用同一份实现，避免同一交互长成两个样子。
 * 悬浮操作与多选复选框都是覆盖在卡片按钮之上的**同级**元素（不嵌进 `<button>` 内部），
 * 静息态不为它们预留任何布局宽度——同样的坑见资产库侧栏那次修复。
 * 悬浮动作压在封面（真实媒体）之上，所以那一簇用 `ui-glass`，不是压在纯色 UI 上的滥用。
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
  onCreate,
  createLabel,
  onOpen,
  onRename,
  onDeleteRequest,
  extraActions,
  showMenu,
}) => {
  const buildMenuItems = (item: ProjectCardGridItem): MenuItem[] => {
    if (selection.active) {
      const selected = selection.isSelected(item.id);
      return [
        {
          id: 'toggle-select',
          label: selected ? labels.deselectItem : labels.selectItem,
          icon: selected ? <Square className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />,
          onClick: () => selection.toggle(item.id),
        },
      ];
    }
    const actions = extraActions?.(item) ?? [];
    return [
      { id: 'open', label: labels.open, icon: <FolderOpen className="h-4 w-4" />, onClick: () => onOpen(item) },
      { id: 'rename', label: labels.rename, icon: <Pencil className="h-4 w-4" />, onClick: () => onRename(item) },
      ...actions.map((action) => ({
        id: action.id,
        label: action.label,
        icon: action.icon,
        onClick: () => action.onClick(item),
        disabled: action.disabled,
      })),
      {
        id: 'delete',
        label: labels.delete,
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => onDeleteRequest([item]),
        divider: true,
      },
      {
        id: 'select-multiple',
        label: labels.selectMultiple,
        icon: <CheckSquare className="h-4 w-4" />,
        onClick: () => selection.enter(item.id),
      },
    ];
  };

  if (loading) {
    return <UiLoading size="sm" message={loadingMessage} />;
  }

  if (items.length === 0) {
    return <UiEmpty size="sm" icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    // 列数与上限见 projectGridLayout.ts；断点式 grid-cols-* 在这里是错的，
    // 同一个断点下窗口还能继续变宽，列数却卡死。
    <div className={`grid ${PROJECT_GRID_COLUMNS_CLASS} gap-4`}>
      {onCreate && !selection.active && (
        <UiOptionButton
          variant="card"
          type="button"
          className="h-full w-full flex-col justify-center gap-3 !items-center p-2.5 text-center"
          onClick={onCreate}
          disabled={busy}
        >
          {/* 高度交给网格拉伸对齐同排项目卡，不写死数值 */}
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-veil-soft">
            <Plus className="h-5 w-5" />
          </span>
          <span className="text-sm font-medium">{createLabel}</span>
        </UiOptionButton>
      )}

      {items.map((item) => {
        const selected = selection.isSelected(item.id);
        return (
          <div key={item.id} className="group relative">
            <UiOptionButton
              variant="card"
              type="button"
              className={`h-auto w-full flex-col !items-stretch gap-0 p-2.5 text-left ${selected ? UI_MULTISELECT_ITEM_ACTIVE_OVERRIDE_CLASS : ''}`}
              onClick={() => (selection.active ? selection.toggle(item.id) : onOpen(item))}
              onContextMenu={(event) => showMenu(event, buildMenuItems(item))}
              disabled={busy}
            >
              <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-app">
                <ProjectCardCover coverPath={item.coverPath} icon={Icon} seed={item.id} alt={item.name} />
              </span>
              <span className="flex flex-col gap-0.5 px-1 pb-0.5 pt-2.5">
                <span className="truncate text-sm font-medium">{item.name}</span>
                <span className="truncate text-xs text-text-muted">{item.metaLine}</span>
              </span>
            </UiOptionButton>

            {selection.active ? (
              <div className="absolute left-4 top-4">
                <UiCheckbox checked={selected} onCheckedChange={() => selection.toggle(item.id)} />
              </div>
            ) : (
              <div className="ui-glass absolute right-4 top-4 flex gap-0.5 rounded-lg p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <UiIconButton
                  showBorder={false}
                  appearance="hover-only"
                  className="h-7 w-7"
                  title={labels.rename}
                  onClick={() => onRename(item)}
                >
                  <Pencil size={13} />
                </UiIconButton>
                {extraActions?.(item).map((action) => (
                  <UiIconButton
                    key={action.id}
                    showBorder={false}
                    appearance="hover-only"
                    className="h-7 w-7"
                    title={action.label}
                    disabled={action.disabled}
                    onClick={() => action.onClick(item)}
                  >
                    {action.icon}
                  </UiIconButton>
                ))}
                <UiIconButton
                  showBorder={false}
                  appearance="hover-only"
                  hoverVariant="danger"
                  className="h-7 w-7"
                  title={labels.delete}
                  onClick={() => onDeleteRequest([item])}
                >
                  <Trash2 size={13} />
                </UiIconButton>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
