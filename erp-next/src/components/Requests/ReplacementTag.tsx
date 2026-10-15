import { Badge } from '@/components/UI/Table'

export default function ReplacementTag({ originalItemKey, className = '' }: { originalItemKey?: string | null; className?: string }) {
  return <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-sans ${className}`}>
    <Badge className="" variant="brand">Replacement</Badge>
    {originalItemKey && <span className="text-xs text-maison-secondary">Replaces {originalItemKey}</span>}
  </span>
}
