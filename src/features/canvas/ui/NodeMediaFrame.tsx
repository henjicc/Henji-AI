import type { ReactNode } from 'react'

/**
 * 整块铺满的媒体节点（图片、视频、上传、图层结果）的画面框。
 * 节点外框的边框画在框内侧，宽高各占掉 2px：外框按画面比例定尺寸时，里面放画面的区域就比画面“宽”一点，
 * 完整显示的画面左右会露出两条底色。所以画面铺到外框边缘（盖住边框所在的那一圈），
 * 再在最上面画一圈继承外框颜色的描边：悬停、选中、出错仍由外框的边框颜色决定。
 */
export function NodeMediaFrame({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      <div className="absolute -inset-px overflow-hidden rounded-[var(--node-radius)] bg-gap">{children}</div>
      <span aria-hidden="true" className="pointer-events-none absolute -inset-px rounded-[var(--node-radius)] border border-inherit" />
    </>
  )
}
