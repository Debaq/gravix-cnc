interface GravixMarkProps {
  size?: number
  className?: string
}

export function GravixMark({ size = 48, className }: GravixMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect width="48" height="48" rx="10" fill="#E24B4A" />
      <path
        d="M12 36 L24 12 L36 36"
        stroke="white"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M17 28 L31 28"
        stroke="white"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="24" cy="12" r="3" fill="white" />
    </svg>
  )
}

interface GravixWordmarkProps {
  size?: number
  variant?: 'light' | 'dark'
  className?: string
}

export function GravixWordmark({ size = 32, variant = 'light', className }: GravixWordmarkProps) {
  const gravColor = variant === 'dark' ? '#fafafa' : '#1a1210'
  const spacing = size >= 28 ? '-0.03em' : size >= 16 ? '-0.02em' : '-0.01em'

  return (
    <span
      className={className}
      style={{
        fontSize: `${size}px`,
        fontWeight: 500,
        letterSpacing: spacing,
        lineHeight: 1,
        color: gravColor,
      }}
    >
      grav<span style={{ color: '#E24B4A' }}>ix</span>
    </span>
  )
}

interface GravixLogoProps {
  markSize?: number
  wordmarkSize?: number
  variant?: 'light' | 'dark'
  className?: string
}

export function GravixLogo({ markSize = 48, wordmarkSize = 32, variant = 'light', className }: GravixLogoProps) {
  const gap = markSize >= 40 ? 12 : markSize >= 28 ? 8 : 6

  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: `${gap}px` }}
    >
      <GravixMark size={markSize} />
      <GravixWordmark size={wordmarkSize} variant={variant} />
    </div>
  )
}
