import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { resolveImageDisplayUrl } from '@/services/imageSource';

interface ProjectCardCoverProps {
  /** 封面缩略图的本地路径；为空时显示占位图 */
  coverPath?: string | null;
  /** 占位图中央的模块图标 */
  icon?: LucideIcon;
  /** 占位图配色的随机种子，同一项目每次进来长得一样 */
  seed: string;
  alt: string;
}

/** 由项目 id 派生的稳定散列，用来让占位图各不相同又不会每次刷新都变 */
function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/**
 * 项目卡封面区：有封面显示封面，没有封面显示一张由项目 id 决定的柔和占位图。
 *
 * 占位图不引入任何写死的颜色——底色全部来自主题令牌，卡与卡的差异只由光斑位置产生，
 * 所以换主题预设/强调色时整族占位图会跟着一起变，且不会出现与暗色界面打架的杂色。
 */
export const ProjectCardCover: React.FC<ProjectCardCoverProps> = ({ coverPath, icon: Icon, seed, alt }) => {
  if (coverPath) {
    return (
      <img
        src={resolveImageDisplayUrl(coverPath)}
        alt={alt}
        loading="lazy"
        draggable={false}
        className="h-full w-full object-cover"
      />
    );
  }

  const hash = hashSeed(seed);
  const placeholderStyle = {
    '--cover-x': `${16 + (hash % 7) * 11}%`,
    '--cover-y': `${14 + ((hash >> 3) % 7) * 11}%`,
  } as React.CSSProperties;

  return (
    <div className="project-cover-placeholder flex h-full w-full items-center justify-center" style={placeholderStyle}>
      {Icon ? <Icon className="h-7 w-7 text-veil-strong" /> : null}
    </div>
  );
};
