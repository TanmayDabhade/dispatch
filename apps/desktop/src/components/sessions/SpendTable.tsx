import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { EmptyState } from '@/ui/chrome';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ui/table';

interface SpendRow {
  key: string;
  label: ReactNode;
  sessionCount: number;
  totalCostUsd: number;
}

interface SpendTableProps {
  /** Header for the row-identity column, e.g. "Project" / "Model". */
  columnLabel: string;
  rows: SpendRow[];
  emptyMessage: string;
  /** When set, each row becomes clickable and calls back with its `key` — the Sessions hub's
   * "spend by project" table uses this to toggle the session list below to that project. Rows
   * render as plain (non-interactive) text when omitted, e.g. the "spend by model" table. */
  onRowClick?: (key: string) => void;
  /** The `key` of the row to render in an active/selected state — set together with
   * `onRowClick` so the currently-filtered project stays visually highlighted. */
  activeKey?: string;
}

const HEAD_CLASS =
  'text-muted-foreground h-8 px-0 text-[12px] font-medium whitespace-normal';
const NUMBER_CLASS =
  'text-muted-foreground font-book px-0 py-0 text-right text-[12px] tabular-nums whitespace-normal';

/**
 * The "sessions + spend, grouped by X" table the Sessions hub renders for both its "spend by
 * model" and "spend by project" sections — one shared component owns the markup, each caller
 * only supplies its own rows and the label for the grouping column. Optionally clickable (see
 * `onRowClick`) so the same table doubles as the project filter control. Heads are 12px
 * sentence case, numbers 12px sans with tabular digits, rows 36px.
 */
export function SpendTable({
  columnLabel,
  rows,
  emptyMessage,
  onRowClick,
  activeKey,
}: SpendTableProps) {
  if (rows.length === 0) {
    return <EmptyState description={emptyMessage} className="py-4" />;
  }

  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD_CLASS}>{columnLabel}</TableHead>
          <TableHead className={cn(HEAD_CLASS, 'text-right')}>
            Sessions
          </TableHead>
          <TableHead className={cn(HEAD_CLASS, 'text-right')}>Spend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.key}
            onClick={onRowClick ? () => onRowClick(row.key) : undefined}
            aria-selected={onRowClick ? activeKey === row.key : undefined}
            className={cn(
              'h-9 hover:bg-transparent',
              onRowClick &&
                'hover:bg-surface-hover cursor-pointer transition-colors duration-100',
              activeKey === row.key && 'bg-surface-selected'
            )}
          >
            <TableCell className="text-foreground px-0 py-0 font-medium whitespace-normal">
              {row.label}
            </TableCell>
            <TableCell className={NUMBER_CLASS}>{row.sessionCount}</TableCell>
            <TableCell className={NUMBER_CLASS}>
              ${row.totalCostUsd.toFixed(2)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
