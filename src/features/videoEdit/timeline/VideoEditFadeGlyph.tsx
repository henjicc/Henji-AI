/** 淡入的暗角在左上、淡出的在右上：浅的一半就是音量或不透明度的走向。 */
const SHADE = { in: 'polygon(0 0, 100% 0, 0 100%)', out: 'polygon(0 0, 100% 0, 100% 100%)' } as const

/** 淡化手柄的方块（PR）：一道斜线把方块分成明暗两半，一看就是渐变。片段角上的新建手柄与淡化块内缘的调整手柄共用。 */
export function VideoEditFadeGlyph({ edge }: { edge: 'in' | 'out' }): React.ReactElement {
  return <span aria-hidden="true" className="pointer-events-none relative block h-2.5 w-2.5 overflow-hidden rounded-hairline bg-text2 ring-1 ring-window">
    <span className="absolute inset-0 bg-window/70" style={{ clipPath: SHADE[edge] }} />
  </span>
}
