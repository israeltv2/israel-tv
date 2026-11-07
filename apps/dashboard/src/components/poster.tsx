import type { Art } from '@israel-tv/admin-contract';
import { Tv } from 'lucide-react';
import { useState } from 'react';
import { sourceColor } from '#lib/sources.ts';

/**
 * A show's image in a 2:3 box, so rows line up: a poster fills it, a channel logo (square) or a landscape image sits
 * inside it on a soft tile. A show with no image of its own (or one that does not load) gets a tile in its source's
 * colour with its title's first letter.
 */
export function Poster({
  art,
  source,
  title,
  className = 'w-10',
}: {
  art?: Art | undefined;
  source?: string | undefined;
  title?: string | undefined;
  className?: string;
}) {
  const [failed, setFailed] = useState<string>();
  const url = art?.poster;
  const color = sourceColor(source);
  const letter = /[\p{L}\p{N}]/u.exec(title ?? '')?.[0]?.toUpperCase();
  const fits = art?.posterShape === 'square' || art?.posterShape === 'landscape';
  return (
    <div
      className={`${className} @container aspect-[2/3] shrink-0 overflow-hidden rounded-md bg-surface-2`}
      data-poster={url && failed !== url ? (fits ? 'logo' : 'poster') : 'placeholder'}
    >
      {url && failed !== url ? (
        fits ? (
          <div
            className="grid size-full place-items-center p-[12%]"
            style={{ background: `color-mix(in oklab, ${color} 10%, var(--surface-2))` }}
          >
            <img
              src={url}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="max-h-full w-full object-contain"
              onError={() => setFailed(url)}
            />
          </div>
        ) : (
          <img
            src={url}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-full object-cover"
            onError={() => setFailed(url)}
          />
        )
      ) : (
        <div
          className="grid size-full place-items-center"
          style={{
            background: `linear-gradient(160deg, color-mix(in oklab, ${color} 85%, white), color-mix(in oklab, ${color} 60%, black))`,
          }}
          aria-hidden
        >
          {letter ? (
            <span className="select-none font-semibold text-[46cqw] text-white/90 leading-none">
              {letter}
            </span>
          ) : (
            <Tv className="size-[40cqw] text-white/80" />
          )}
        </div>
      )}
    </div>
  );
}
