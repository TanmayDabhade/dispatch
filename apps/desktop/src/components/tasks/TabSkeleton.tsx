import { Skeleton } from '@/ui/skeleton';

// What the Chat and Diff tabs show while the selected run's detail is still
// loading: three 36px row placeholders on the list-row rhythm.
export function TabSkeleton() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-col gap-1 py-1">
        <Skeleton className="h-9 w-2/5" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    </div>
  );
}
