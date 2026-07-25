import { CheckCircle2, ChevronDown, SearchCheck } from 'lucide-react'
import { useState } from 'react'

import { UiButton, UI_INSET_SURFACE_CLASS } from '@/components/ui'

import type { AgentToolActivity, AgentToolActivityGroup } from './agentRunReducer'
import { ToolActivityCard } from './ToolActivityCard'

interface ToolActivityGroupProps {
  group: AgentToolActivityGroup
  onOpenTask: (taskId: string) => void
  onOpenNode: (projectId: string, nodeId: string) => void
}

function summarizeTitles(activities: AgentToolActivity[]): string {
  const counts = new Map<string, number>()
  for (const activity of activities) {
    counts.set(activity.title, (counts.get(activity.title) ?? 0) + 1)
  }
  return [...counts.entries()]
    .slice(0, 3)
    .map(([title, count]) => count > 1 ? `${title} ${count} 次` : title)
    .join('、')
}

export function ToolActivityGroup({
  group,
  onOpenTask,
  onOpenNode,
}: ToolActivityGroupProps): JSX.Element {
  const [expanded, setExpanded] = useState(!group.collapsedByDefault)
  const isCompactGroup = group.activities.length > 1 && group.collapsedByDefault

  if (!isCompactGroup) {
    const activity = group.activities[0]
    return <ToolActivityCard activity={activity} onOpenTask={onOpenTask} onOpenNode={onOpenNode} />
  }

  return (
    <section className={`rounded-md ${UI_INSET_SURFACE_CLASS} px-1 py-0.5`}>
      <UiButton
        type="button"
        variant="ghost"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="!h-7 w-full justify-start gap-2 !rounded-md !px-1.5 text-left"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
          {expanded ? <CheckCircle2 className="h-3 w-3" /> : <SearchCheck className="h-3 w-3" />}
        </span>
        <span className="shrink-0 text-2xs font-medium text-text-dark">已查询 {group.activities.length} 项</span>
        <span className="min-w-0 flex-1 truncate text-3xs text-text-muted">{summarizeTitles(group.activities)}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </UiButton>

      {expanded ? (
        <div className="space-y-1 border-t border-border-dark/60 px-1 pb-1 pt-1">
          {group.activities.map((activity) => (
            <ToolActivityCard
              key={activity.toolCallId}
              activity={activity}
              onOpenTask={onOpenTask}
              onOpenNode={onOpenNode}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
