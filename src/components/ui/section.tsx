import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A titled, full-width dashboard row.
 *
 * Extracted because the dashboard page was repeating three things by hand for
 * every row — the `<section aria-labelledby>` wiring, a locally-defined heading
 * component, and the row wrapper — and each repetition was a chance to get one
 * of them wrong.
 *
 * SCOPE NOTE, so this primitive is not mistaken for more than it is: it does
 * NOT enforce container width, and adding a `span` prop here would not have
 * prevented the bug that prompted it. Every row on the dashboard already
 * inherits its width from the single `max-w-[88rem]` page container; the rows
 * that looked narrow were full-width grids with *empty tracks* (a 3-column grid
 * holding one col-span-2 child, and another holding a child that renders null).
 * Width is not the variable — track occupancy is. The automated guard for that
 * is tests/e2e/dashboard-layout.spec.ts, not a type signature.
 */

export interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  /** Rendered as the row's h2 and wired to the section via aria-labelledby. */
  title: string;
  /** Stable id for the aria-labelledby association. Derived from title if omitted. */
  id?: string;
  /** Optional one-line description under the heading. */
  description?: string;
  /**
   * Suppress the rendered <h2>. Used when the row's only child already carries
   * a visible title of its own (a Card with a CardTitle) — rendering a
   * screen-reader-only h2 with the same words would announce the title twice.
   * The landmark keeps its accessible name via aria-label instead.
   */
  titleHidden?: boolean;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function Section({
  title,
  id,
  description,
  titleHidden = false,
  className,
  children,
  ...props
}: SectionProps) {
  const headingId = id ?? `section-${slugify(title)}`;

  return (
    <section
      // Either the heading names the landmark, or aria-label does — never both,
      // and never neither.
      {...(titleHidden ? { 'aria-label': title } : { 'aria-labelledby': headingId })}
      className={cn('w-full', className)}
      {...props}
    >
      {!titleHidden && (
        <div className="mb-2">
          <h2
            id={headingId}
            className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-dharma-ink"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-data text-dharma-ink-secondary">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Row of equal-width cards whose count is not known at build time.
 *
 * `auto-fit` is the point. A fixed `lg:grid-cols-3` reserves three tracks
 * whether or not three children render, so a child that returns null leaves a
 * visible dead gutter — which is exactly what the Workspace row was doing when
 * ImportedFrameworksCard had nothing to show. With auto-fit the empty track
 * collapses and the surviving cards redistribute: two cards split 50/50, three
 * split evenly, without the parent needing to know which case it is in.
 *
 * `items-stretch` (the grid default, stated explicitly here because it is
 * load-bearing) plus `h-full` on each card keeps their heights equal.
 */
export function CardRow({
  className,
  children,
  minCardWidth = '18rem',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { minCardWidth?: string }) {
  return (
    <div
      // Stable seam for the layout regression test, which must target the card
      // track and not the section's heading block. Class names are not a
      // contract; this attribute is.
      data-card-row=""
      className={cn('grid items-stretch gap-4', className)}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${minCardWidth}, 100%), 1fr))`,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
