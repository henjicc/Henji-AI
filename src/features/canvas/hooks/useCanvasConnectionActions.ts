import { useCallback } from 'react';
import type { Connection } from '@xyflow/react';
import type { TFunction } from 'i18next';

import {
  addAssetGroupMembers,
  bindAssetGroup,
  createAssetGroup,
} from '@/features/canvas/application/assetGroupApplicationService';
import { validateParamConnection } from '@/features/canvas/application/graphValueResolver';
import { planMediaConnections, resolveMediaConnectionSource } from '@/features/canvas/application/mediaConnectionPlanner';
import { wouldCreateCanvasCycle } from '@/features/canvas/domain/connectionIndex';
import {
  isAssetGroupNode,
  type CanvasConnectionInput,
  type CanvasEdge,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import { isConnectionCompatible } from '@/features/canvas/domain/nodeRegistry';
import { isParamPortId } from '@/features/canvas/domain/socketTypes';
import { canNodeBeManualConnectionSource } from '@/features/canvas/canvasUtils';

type Toast = (message: string, type?: 'success' | 'error') => void;

interface UseCanvasConnectionActionsInput {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  connectNodes: (connection: Connection) => void;
  connectMany: (connections: CanvasConnectionInput[]) => string[];
  schedulePersist: (delayMs?: number) => void;
  showToast: Toast;
  t: TFunction;
}

export function useCanvasConnectionActions(input: UseCanvasConnectionActionsInput) {
  const { nodes, edges, connectNodes, connectMany, schedulePersist, showToast, t } = input;

  const bindGroup = useCallback((groupId: string, targetNodeId: string) => {
    try {
      const result = bindAssetGroup({ groupId, targetNodeId });
      showToast(t('canvas.assetGroup.bindingSummary', result), 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('canvas.connection.typeMismatch'));
    }
  }, [showToast, t]);

  const handleConnect = useCallback((connection: Connection) => {
    if (!canNodeBeManualConnectionSource(connection.source, nodes)) return;
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode) return;
    if (isAssetGroupNode(sourceNode)) {
      bindGroup(sourceNode.id, targetNode.id);
      return;
    }

    const mediaSource = resolveMediaConnectionSource(sourceNode, connection.sourceHandle);
    if (mediaSource) {
      const plan = planMediaConnections({
        sourceNodeIds: [sourceNode.id],
        targetNodeId: targetNode.id,
        nodes,
        edges,
        preferredTargetHandle: connection.targetHandle,
        sourceHandles: { [sourceNode.id]: connection.sourceHandle },
      });
      if (plan.connections.length > 0) {
        connectMany(plan.connections);
        schedulePersist(0);
        return;
      }
      const reason = plan.skipped[0]?.reason;
      if (reason === 'capacity-exceeded') {
        const validation = connection.targetHandle
          ? validateParamConnection(
              sourceNode, targetNode, connection.targetHandle, nodes, edges, connection.sourceHandle,
            )
          : null;
        showToast(t('canvas.connection.mediaLimitExceeded', {
          media: t(`node.mediaRow.${mediaSource.kind}`),
          max: validation?.maxCount ?? 0,
        }));
      } else {
        showToast(t(reason === 'cycle' ? 'canvas.connection.cycle' : 'canvas.connection.typeMismatch'));
      }
      return;
    }

    if (wouldCreateCanvasCycle(sourceNode.id, targetNode.id, edges)) {
      showToast(t('canvas.connection.cycle'));
      return;
    }
    const paramValidation = isParamPortId(connection.targetHandle)
      ? validateParamConnection(
          sourceNode, targetNode, connection.targetHandle, nodes, edges, connection.sourceHandle,
        )
      : null;
    const compatible = paramValidation?.compatible ?? isConnectionCompatible(
      sourceNode.type, targetNode.type, connection.sourceHandle, sourceNode.data,
    );
    if (!compatible) {
      if (paramValidation?.reason === 'media-limit-exceeded') {
        showToast(t('canvas.connection.mediaLimitExceeded', {
          media: paramValidation.mediaKind
            ? t(`node.mediaRow.${paramValidation.mediaKind}`)
            : t('canvas.connection.mediaFallback'),
          max: paramValidation.maxCount ?? 0,
        }));
      } else showToast(t('canvas.connection.typeMismatch'));
      return;
    }
    connectNodes(connection);
    schedulePersist(0);
  }, [bindGroup, connectMany, connectNodes, edges, nodes, schedulePersist, showToast, t]);

  const handleBatchConnect = useCallback((sourceNodeIds: string[], targetNodeId: string) => {
    const plan = planMediaConnections({ sourceNodeIds, targetNodeId, nodes, edges });
    if (plan.connections.length > 0) {
      connectMany(plan.connections);
      schedulePersist(0);
    }
    if (plan.connections.length === 0 && plan.skipped.length === 0) return;
    const reasonCounts = new Map<string, number>();
    for (const skipped of plan.skipped) {
      reasonCounts.set(skipped.reason, (reasonCounts.get(skipped.reason) ?? 0) + 1);
    }
    const reasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => `${t(`canvas.connection.skipReason.${reason}`)} ${count}`)
      .join('、');
    const summary = t('canvas.connection.batchSummary', {
      connected: plan.connections.length,
      skipped: plan.skipped.length,
    });
    showToast(reasons ? `${summary}（${reasons}）` : summary, plan.connections.length > 0 ? 'success' : 'error');
  }, [connectMany, edges, nodes, schedulePersist, showToast, t]);

  const createGroup = useCallback((memberIds: string[]) => {
    try {
      const result = createAssetGroup({ memberIds });
      showToast(t('canvas.assetGroup.created', { count: result.accepted }), 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('canvas.assetGroup.createFailed'));
    }
  }, [showToast, t]);

  const addToGroup = useCallback((groupId: string, memberIds: string[]) => {
    try {
      const result = addAssetGroupMembers({ groupId, memberIds });
      showToast(t('canvas.assetGroup.memberCount', { count: result.memberCount }), 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('canvas.assetGroup.addFailed'));
    }
  }, [showToast, t]);

  return { handleConnect, handleBatchConnect, createAssetGroup: createGroup, addToAssetGroup: addToGroup, bindAssetGroup: bindGroup };
}
