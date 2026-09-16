import { galleryStories } from './galleryStories';
import { PageHeader } from '@/ui/ai/page-header';

/**
 * Dev-only review surface for the Beautiful UI primitives (tasks 6-24): a sticky index of
 * every story title on the left, and the stories themselves on the right, each in its own
 * card frame. This view and its nav/command entries only exist in dev builds — see the
 * `import.meta.env.DEV` gates in App.tsx and Sidebar.tsx. `galleryStories` is the single
 * catalog every primitive task appends to, so this component never changes to show new work.
 */
export function GalleryView() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb={['Gallery']}
        actions={
          <span className="text-muted-foreground font-book px-2 text-[12px] tabular-nums">
            {galleryStories.length}{' '}
            {galleryStories.length === 1 ? 'primitive' : 'primitives'}
          </span>
        }
      />
      <div className="flex min-h-0 flex-1 gap-6 overflow-y-auto px-6 py-4">
        <nav
          aria-label="Gallery index"
          className="sticky top-0 flex w-48 shrink-0 flex-col gap-px self-start"
        >
          {galleryStories.map((story) => (
            <a
              key={story.id}
              href={`#gallery-${story.id}`}
              className="text-muted-foreground hover:bg-surface-hover rounded-control flex h-7 items-center px-2 text-[13px] font-medium transition-colors duration-100 hover:text-(--text-secondary)"
            >
              {story.title}
            </a>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-6 pb-8">
          {galleryStories.map((story) => (
            <section
              key={story.id}
              id={`gallery-${story.id}`}
              className="bg-surface-quaternary rounded-card shadow-card flex flex-col gap-3 p-4"
            >
              <div className="flex flex-col gap-0.5">
                <h2 className="text-foreground text-[13px] font-medium">
                  {story.title}
                </h2>
                {story.note !== undefined && (
                  <p className="text-muted-foreground font-book text-[12px]">
                    {story.note}
                  </p>
                )}
              </div>
              <div>{story.render()}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
