import React from 'react'

interface SectionCardProps {
  title: string
  description?: string
  children: React.ReactNode
}

const SectionCard: React.FC<SectionCardProps> = ({ title, description, children }) => {
  return (
    <div className="bg-zinc-800/30 rounded-xl p-3.5 border border-zinc-700/30">
      <h4 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">{title}</h4>
      {description ? <p className="text-xs text-zinc-500 mb-4">{description}</p> : null}
      {children}
    </div>
  )
}

export default SectionCard
