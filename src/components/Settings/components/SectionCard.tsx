import React from 'react'

interface SectionCardProps {
  title: string
  description?: string
  children: React.ReactNode
}

const SectionCard: React.FC<SectionCardProps> = ({ title, description, children }) => {
  return (
    <div className="rounded-xl border border-border-dark bg-panel p-3.5">
      <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-text-muted">{title}</h4>
      {description ? <p className="mb-4 text-xs text-text-muted">{description}</p> : null}
      {children}
    </div>
  )
}

export default SectionCard
