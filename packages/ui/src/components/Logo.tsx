export interface LogoProps {
  /** The accessible name, e.g. "AI Commerce". */
  label: string
  /** Height of the mark in pixels. */
  size?: number
  /** Text set beside the mark; the brand name comes in as a prop like every other string. */
  wordmark?: string
}

/**
 * The "Orbit a" mark: a lowercase a with a dot orbiting its bowl. The dotted trail shows only
 * above 64 px, and strokes thicken at 16 px, as in the logo sheet.
 */
export function Logo({ label, size = 32, wordmark }: LogoProps) {
  const tiny = size <= 16
  const stroke = tiny ? 9 : 8
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-3 text-fg">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="28" cy="36" r="14" fill="none" stroke="currentColor" strokeWidth={stroke} />
        <rect x="38" y="20" width={stroke} height="30" rx={stroke / 2} fill="currentColor" />
        {size > 64 && (
          <path
            data-part="trail"
            d="M8 20A26 26 0 0 1 40 8"
            fill="none"
            stroke="var(--ai-accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="0.1 5"
          />
        )}
        <circle cx="48" cy="10" r={tiny ? 6 : 5} fill="var(--ai-accent)" />
      </svg>
      {wordmark !== undefined && (
        <span aria-hidden="true" className="text-lg font-semibold tracking-tight">
          {wordmark}
        </span>
      )}
    </span>
  )
}
