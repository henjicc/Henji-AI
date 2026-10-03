import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { resolveImageDisplayUrl } from '@/services/imageSource';

interface ProjectCardCoverProps {
  /** 封面缩略图的本地路径；为空时显示占位图 */
  coverPath?: string | null;
  /** 占位图中央的模块图标 */
  icon?: LucideIcon;
  alt: string;
}

/**
 * 项目卡封面区：有封面显示封面，没有封面显示画布点阵占位（设计稿 CanvasProjects）。
 *
 * 占位图只用表面与发丝线令牌（index.css `.project-cover-placeholder`），换主题预设/强调色时跟着变，
 * 不用强调色光斑——强调色只给主动作、焦点与选中（重要记录 001）。
 */
export const ProjectCardCover: React.FC<ProjectCardCoverProps> = ({ coverPath, icon: Icon, alt }) => {
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

  return (
    <div className="project-cover-placeholder flex h-full w-full items-center justify-center">
      {Icon ? <Icon className="h-6 w-6 text-text3" aria-hidden="true" /> : null}
    </div>
  );
};
