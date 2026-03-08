interface CanvasEmptyHintProps {
  title: string
  subtitle: string
}

export function CanvasEmptyHint({ title, subtitle }: CanvasEmptyHintProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="text-center">
        <div className="mb-2 text-2xl text-text-muted">{title}</div>
        <div className="text-sm text-text-muted opacity-60">{subtitle}</div>
      </div>
    </div>
  )
}
