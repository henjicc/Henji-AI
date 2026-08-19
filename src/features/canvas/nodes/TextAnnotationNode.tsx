import { memo, useCallback, useEffect, useState, type MouseEvent } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileText, LoaderCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';

import { CANVAS_NODE_TYPES, type TextAnnotationNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { UiTextArea } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvasTextStreamStore } from '@/stores/canvasTextStreamStore';
import { createCanvasTextHistoryGroup, useCanvasTextHistory } from '@/features/canvas/hooks/useCanvasTextHistory';
import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex';
import { getSocketColor } from '@/features/canvas/domain/socketTypes';
import { NodeGenerationError } from '@/features/canvas/nodes/shared/NodeGenerationError';

import {
  NODE_GENERATION_ERROR_BORDER_CLASS,
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';

type TextAnnotationNodeProps = NodeProps & {
  id: string;
  data: TextAnnotationNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 180;
const MIN_WIDTH = 180;
const MIN_HEIGHT = 100;
const MAX_WIDTH = 900;
const MAX_HEIGHT = 900;
const LIVE_MARKDOWN_MAX_CHARACTERS = 6_000;
const MARKDOWN_REMARK_PLUGINS = [remarkGfm];

const TextAnnotationMarkdown = memo(({ content }: { content: string }) => (
  <div className="markdown-body break-words [&_a]:text-accent [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-15 [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_hr]:border-white/10 [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-black/30 [&_pre]:p-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-white/10 [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:pl-5">
    <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS}>{content}</ReactMarkdown>
  </div>
));

TextAnnotationMarkdown.displayName = 'TextAnnotationMarkdown';

export const TextAnnotationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: TextAnnotationNodeProps) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const hasTargetConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainTarget ?? false
  );
  const hasSourceConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false
  );
  const content = typeof data.content === 'string' ? data.content : '';
  const isGenerating = data.isGenerating === true;
  const streamPreview = useCanvasTextStreamStore((state) => state.previews[id]);
  const displayContent = isGenerating && streamPreview !== undefined ? streamPreview : content;
  const generationError = typeof data.generationError === 'string' ? data.generationError : null;
  const shouldRenderMarkdown = !isGenerating || displayContent.length <= LIVE_MARKDOWN_MAX_CHARACTERS;
  const contentHistoryGroup = createCanvasTextHistoryGroup(id, 'content');
  const handleContentChange = useCallback((nextValue: string): void => {
    updateNodeData(id, { content: nextValue }, { historyGroup: contentHistoryGroup });
  }, [contentHistoryGroup, id, updateNodeData]);
  const contentTextHistory = useCanvasTextHistory(contentHistoryGroup, handleContentChange);
  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.textAnnotation, data);
  const resolvedWidth = Math.max(MIN_WIDTH, Math.round(width ?? DEFAULT_WIDTH));
  const resolvedHeight = Math.max(MIN_HEIGHT, Math.round(height ?? DEFAULT_HEIGHT));

  useEffect(() => {
    if (!selected || isGenerating || generationError) setIsEditing(false);
  }, [generationError, isGenerating, selected]);

  const handleContentClick = useCallback((event: MouseEvent<HTMLDivElement>): void => {
    if (isGenerating || generationError) return;
    if (event.target instanceof HTMLElement && event.target.closest('a')) return;
    setSelectedNode(id);
    setIsEditing(true);
  }, [generationError, id, isGenerating, setSelectedNode]);

  return (
    <div
      className={`
        group relative h-full w-full overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-1.5 transition-colors duration-150
        ${generationError
          ? NODE_GENERATION_ERROR_BORDER_CLASS
          : selected
            ? NODE_SELECTED_BORDER_CLASS
            : NODE_IDLE_BORDER_CLASS}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<FileText className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <NodeResizeHandle
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        maxWidth={MAX_WIDTH}
        maxHeight={MAX_HEIGHT}
      />

      {selected && isEditing && !isGenerating && !generationError ? (
        <UiTextArea
          autoFocus
          value={content}
          onChange={(event) => contentTextHistory.onValueChange(event.target.value)}
          textHistory={contentTextHistory}
          onBlur={() => setIsEditing(false)}
          placeholder={t('node.textAnnotation.placeholder')}
          className="nodrag nowheel h-full w-full border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-text-dark outline-none placeholder:text-text-muted/70"
        />
      ) : (
        <div
          className="nodrag nowheel h-full w-full overflow-auto px-1 py-0.5 text-sm leading-6 text-text-dark"
          onClick={handleContentClick}
        >
          {displayContent.trim().length > 0 ? (
            shouldRenderMarkdown ? (
              <TextAnnotationMarkdown content={displayContent} />
            ) : (
              <div className="whitespace-pre-wrap break-words">{displayContent}</div>
            )
          ) : isGenerating ? (
            <div className="flex h-full items-center justify-center gap-2 text-text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>{t('node.textAnnotation.generating')}</span>
            </div>
          ) : (
            <div className="pt-1 text-text-muted">{t('node.textAnnotation.empty')}</div>
          )}
        </div>
      )}

      {generationError && <NodeGenerationError message={generationError} />}

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className={`${NODE_PORT_NODE_CLASS} ${hasTargetConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor('STRING'), left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor('STRING'), right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
      />
    </div>
  );
});

TextAnnotationNode.displayName = 'TextAnnotationNode';
