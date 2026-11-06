// Shapes of the Mako responses we read. Unknown fields are ignored (Mako sends hundreds); the fields we
// use are checked strictly so a change at Mako fails loudly with a path to the field.
import { z } from 'zod';

const Pic = z.looseObject({ picUrl: z.string() });

export const IndexItem = z.looseObject({
  itemVcmId: z.string().optional(),
  title: z.string().min(1),
  pageUrl: z.string().startsWith('/'),
  pic: z.string().optional(),
});
export const IndexResponse = z.looseObject({ items: z.array(IndexItem).min(1) });

export const VodSlot = z.discriminatedUnion('componentLayout', [
  z.looseObject({
    componentLayout: z.literal('vod'),
    itemVcmId: z.string().min(1),
    channelId: z.string().optional(),
    galleryChannelId: z.string().optional(),
    title: z.string().default(''),
    pageUrl: z.string().optional(),
    extraInfo: z.string().nullish(),
    pics: z.array(Pic).nullish(),
    aIL: z.boolean().optional(),
    aINT: z.boolean().optional(),
  }),
  z.looseObject({ componentLayout: z.literal('ad') }),
]);
export type VodSlot = z.infer<typeof VodSlot>;

const MenuTab = z.looseObject({
  pageUrl: z.string(),
  vods: z.array(z.looseObject({ componentLayout: z.string() })).nullish(),
});

export const ShowPage = z.looseObject({
  channelId: z.string(),
  pageUrl: z.string(),
  seo: z
    .looseObject({
      description: z.string().optional(),
      image: z.string().optional(),
      schema: z.looseObject({ genre: z.union([z.array(z.string()), z.string()]).nullish() }).nullish(),
    })
    .nullish(),
  hero: z
    .looseObject({
      description: z.string().nullish(),
      logo: z.string().nullish(),
      pics: z.array(Pic).nullish(),
    })
    .nullish(),
  seasons: z
    .array(
      z.looseObject({
        seasonTitle: z.string().nullish(),
        pageUrl: z.string(),
        current: z.boolean().optional(),
      }),
    )
    .nullish(),
  menu: z.array(MenuTab).nullish(),
});
export type ShowPage = z.infer<typeof ShowPage>;

export const PlaylistResponse = z.looseObject({
  media: z.array(
    z.looseObject({ url: z.string(), cdn: z.string().optional(), format: z.string().optional() }),
  ),
});
