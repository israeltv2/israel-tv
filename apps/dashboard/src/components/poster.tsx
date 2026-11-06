import { Tv } from 'lucide-react';
import { useState } from 'react';
import { sourceColor } from '#lib/sources.ts';

/** A show's poster (2:3), or a tile in its source's colour when there is none or it does not load. */
export function Poster({
  url,
  source,
  className = 'w-10',
}: {
  url?: string | undefined;
  source?: string | undefined;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`${className} aspect-[2/3] shrink-0 overflow-hidden rounded-md bg-surface-2`}>
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="grid size-full place-items-center"
          style={{ background: `color-mix(in oklab, ${sourceColor(source)} 18%, var(--surface-2))` }}
        >
          <Tv className="size-4 text-muted" aria-hidden />
        </div>
      )}
    </div>
  );
}
