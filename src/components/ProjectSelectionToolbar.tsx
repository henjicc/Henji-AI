import { Trash2 } from 'lucide-react';
import { UI_TEXT_META_CLASS, UiButton } from '@/components/ui';
import type { UseMultiSelectResult } from '@/hooks/useMultiSelect';

export interface ProjectSelectionToolbarLabels {
  selectedCount: (count: number) => string;
  selectAll: string;
  deselectAll: string;
  deleteSelected: string;
  cancel: string;
}

interface ProjectSelectionToolbarProps {
  selection: UseMultiSelectResult;
  labels: ProjectSelectionToolbarLabels;
  onDeleteSelected: () => void;
}

/**
 * 工程列表进入多选后替换命令带右侧动作的工具条。
 *
 * 「删除所选」静息保持中性、hover 才出危险色——它常驻在这条带上，
 * 不能像弹窗里的确认按钮那样常态实红，否则会抢走主动作的视觉权重。
 */
export function ProjectSelectionToolbar({
  selection,
  labels,
  onDeleteSelected,
}: ProjectSelectionToolbarProps): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className={`${UI_TEXT_META_CLASS} mr-1`}>{labels.selectedCount(selection.count)}</span>
      <UiButton variant="muted" size="sm" onClick={selection.toggleAll}>
        {selection.isAllSelected ? labels.deselectAll : labels.selectAll}
      </UiButton>
      <UiButton
        variant="ghost"
        size="sm"
        className="gap-2 hover:!border-red-500/40 hover:!bg-red-600/35 hover:!text-red-100"
        disabled={selection.count === 0}
        onClick={onDeleteSelected}
      >
        <Trash2 className="h-4 w-4" />
        {labels.deleteSelected}
      </UiButton>
      <UiButton variant="muted" size="sm" onClick={selection.exit}>
        {labels.cancel}
      </UiButton>
    </div>
  );
}
