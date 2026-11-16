export interface SpinnerProps {
  /** Read out by screen readers, e.g. "Loading". */
  label: string
}

export function Spinner({ label }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex items-center">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent motion-reduce:animate-none"
      />
      <span className="sr-only">{label}</span>
    </span>
  )
}
