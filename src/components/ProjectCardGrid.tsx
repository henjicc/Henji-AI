import React from 'react';
import { CheckSquare, FolderOpen, Pencil, Square, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  UI_MULTISELECT_ITEM_ACTIVE_OVERRIDE_CLASS,
  UiCheckbox,
  UiEmpty,
  UiIconButton,
  UiLoading,
  UiOptionButton,
} from '@/components/ui';
import type { MenuItem } from '@/hooks/useContextMenu';
import type { UseMultiSelectResult } from '@/hooks/useMultiSelect';

export interface ProjectCardGridItem {
  id: string;
  name: string;
  metaLine: string;
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
  onOpen: (item: ProjectCardGridItem) => void;
  onRename: (item: ProjectCardGridItem) => void;
  onDeleteRequest: (items: ProjectCardGridItem[]) => void;
  extraActions?: (item: ProjectCardGridItem) => ProjectCardGridExtraAction[];
  showMenu: (event: React.MouseEvent, items: MenuItem[]) => void;
}

/**
 * 项目/工程列表的卡片网格：打开、重命名、删除、右键菜单、多选批量删除。
 *
 * 画布工程与 3D 镜头参考工程共用同一份实现，避免同一交互长成两个样子。
 * 悬浮操作与多选复选框都是覆盖在卡片按钮之上的**同级**元素（不嵌进 `<button>` 内部），
 * 静息态不为它们预留任何布局宽度——同样的坑见资产库侧栏那次修复。
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const selected = selection.isSelected(item.id);
        return (
          <div key={item.id} className="group relative">
            {/*
              左侧留白用互斥的 pl-4/pl-10 三元切换，不能写成 `p-4` + 条件 `pl-10` 叠加——
              二者都改 padding-left，一个来自 shorthand 一个来自单边工具类，胜负取决于
              Tailwind 产物的类顺序而非 className 书写顺序，是静默失效的坑。
            */}
            <UiOptionButton
              variant="card"
              type="button"
              className={`h-auto w-full flex-col !items-start gap-2 pt-4 pr-4 pb-4 text-left ${selection.active ? 'pl-10' : 'pl-4'} ${selected ? UI_MULTISELECT_ITEM_ACTIVE_OVERRIDE_CLASS : ''}`}
              onClick={() => (selection.active ? selection.toggle(item.id) : onOpen(item))}
              onContextMenu={(event) => showMenu(event, buildMenuItems(item))}
              disabled={busy}
            >
              {/* 多选态下用左上角复选框顶替这个位置，避免两者在同一角落重叠。 */}
              {Icon && !selection.active ? <Icon className="h-5 w-5 text-text-muted" /> : null}
              <span className={`w-full truncate text-sm font-medium ${selection.active ? '' : 'pr-14'}`}>
                {item.name}
              </span>
              <span className="text-xs text-text-muted">{item.metaLine}</span>
            </UiOptionButton>

            {selection.active ? (
              <div className="absolute left-3 top-3.5">
                <UiCheckbox checked={selected} onCheckedChange={() => selection.toggle(item.id)} />
              </div>
            ) : (
              <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
