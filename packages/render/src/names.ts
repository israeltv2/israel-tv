// What the public pages call the rows and sources, in English and in Hebrew (the apps show the Hebrew row names).
import { CATALOGS } from '@israel-tv/core';
import type { Lang } from './page.ts';

const CATALOG_EN: Record<string, string> = {
  iltv_keshet12: 'Keshet 12',
  iltv_reshet13: 'Reshet 13',
  iltv_kan11: 'Kan 11',
  iltv_kankids: 'Kan Kids & Teens',
  iltv_kanarchive: 'Kan Archive',
  iltv_live: 'Live channels',
};

const SOURCE_NAMES: Record<Lang, Record<string, string>> = {
  en: { mako: 'Keshet 12', reshet: 'Reshet 13', kan: 'Kan', live: 'Live channels' },
  he: { mako: 'קשת 12', reshet: 'רשת 13', kan: 'כאן', live: 'שידור חי' },
};

/** The row's name: English (with the Hebrew one the app shows beside it) or the Hebrew one. */
export function catalogName(id: string, lang: Lang): string {
  const he = CATALOGS.find((c) => c.id === id)?.name ?? id;
  return lang === 'he' ? he : (CATALOG_EN[id] ?? he);
}

/** The Hebrew name an app shows for a row. */
export const catalogAppName = (id: string) => CATALOGS.find((c) => c.id === id)?.name ?? id;

export const sourceName = (source: string, lang: Lang = 'en') => SOURCE_NAMES[lang][source] ?? source;

/** A channel logo that stands for each row (the live channels' tiles, bundled with the site). */
export const CATALOG_LOGO: Record<string, string> = {
  iltv_keshet12: 'iltv_live_keshet12',
  iltv_reshet13: 'iltv_live_reshet13',
  iltv_kan11: 'iltv_live_kan11',
  iltv_kankids: 'iltv_live_kanedu',
  iltv_kanarchive: 'iltv_live_kan11',
};
