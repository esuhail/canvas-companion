/** The product mark: a grade track with a pin. Same motif as the toolbar icon. */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <rect width="20" height="20" rx="5" fill="var(--cobalt)" />
      <rect x="3.5" y="11" width="13" height="2.4" rx="1.2" fill="#fff" opacity="0.4" />
      <rect x="3.5" y="11" width="8.5" height="2.4" rx="1.2" fill="#fff" />
      <rect x="11.2" y="7" width="2" height="9.5" rx="1" fill="#fff" />
    </svg>
  );
}
