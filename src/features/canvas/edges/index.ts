import type { EdgeTypes } from '@xyflow/react';

import { DisconnectableEdge } from './DisconnectableEdge';
import { AssetGroupBundleEdge } from './AssetGroupBundleEdge';

export const edgeTypes: EdgeTypes = {
  disconnectableEdge: DisconnectableEdge,
  assetGroupBundleEdge: AssetGroupBundleEdge,
};
