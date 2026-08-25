import { memo, useState } from 'react';

import {
  ICON_MEDIA_IMAGE,
  ICON_MEDIA_VIDEO,
  ICON_NODE_ASSET_GROUP,
} from '@/core/theme/icons';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';

import type { AssetGroupPreviewItem } from './assetGroupPreviewModel';

const MAX_VISIBLE_PREVIEWS = 4;

function tileSpanClass(index: number, count: number): string {
  if (count === 1) return 'col-span-2 row-span-2';
  if (count === 2) return 'row-span-2';
  if (count === 3 && index === 0) return 'row-span-2';
  return '';
}

const AssetGroupPreviewTile = memo(({
  item,
  className,
  overflowCount,
}: {
  item: AssetGroupPreviewItem;
  className: string;
  overflowCount: number;
}) => {
  const [failed, setFailed] = useState(false);
  const source = item.source ? resolveImageDisplayUrl(item.source) : null;
  const FallbackIcon = item.kind === 'video' ? ICON_MEDIA_VIDEO : ICON_MEDIA_IMAGE;

  return (
    <div
      data-asset-group-preview-member={item.id}
      className={`relative min-h-0 min-w-0 overflow-hidden bg-app ${className}`}
    >
      {source && !failed ? (
        <img
          src={source}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-text-faint" aria-hidden="true">
          <FallbackIcon className="h-6 w-6" />
        </div>
      )}
      {item.kind === 'video' && (
        <span className="ui-glass pointer-events-none absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-lg text-text-dark">
          <ICON_MEDIA_VIDEO className="h-3 w-3" />
        </span>
      )}
      {overflowCount > 0 && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-app/65 text-13 font-medium text-text-dark">
          +{overflowCount}
        </span>
      )}
    </div>
  );
});

AssetGroupPreviewTile.displayName = 'AssetGroupPreviewTile';

export const AssetGroupPreview = memo(({ items }: { items: AssetGroupPreviewItem[] }) => {
  const visibleItems = items.slice(0, MAX_VISIBLE_PREVIEWS);
  const overflowCount = Math.max(0, items.length - MAX_VISIBLE_PREVIEWS);

  if (visibleItems.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-app text-text-faint">
        <ICON_NODE_ASSET_GROUP className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div
      data-asset-group-preview-count={items.length}
      className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px bg-veil-soft"
    >
      {visibleItems.map((item, index) => (
        <AssetGroupPreviewTile
          key={`${item.id}:${item.source ?? 'empty'}`}
          item={item}
          className={tileSpanClass(index, visibleItems.length)}
          overflowCount={index === visibleItems.length - 1 ? overflowCount : 0}
        />
      ))}
    </div>
  );
});

AssetGroupPreview.displayName = 'AssetGroupPreview';
