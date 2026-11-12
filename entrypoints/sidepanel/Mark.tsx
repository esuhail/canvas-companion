/** The product mark: a grade line with a target notch. Drawn in the text colour. */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" fill="currentColor">
      <rect x="1" y="8" width="16" height="2" rx="1" opacity="0.25" />
      <rect x="1" y="8" width="10" height="2" rx="1" />
      <rect x="12.5" y="4" width="1.5" height="10" rx="0.75" />
    </svg>
  );
}
