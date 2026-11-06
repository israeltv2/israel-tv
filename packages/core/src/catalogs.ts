// Catalog rows: one per channel, Hebrew names, newest episode first.
import type { Source } from './ids.ts';

export interface CatalogDef {
  id: string;
  /** The source whose shows fill this row (and whose failures are flagged in it). */
  source: Source;
  /** Stremio content type of the row. */
  type: 'series' | 'tv';
  name: string;
}

export const CATALOGS: readonly CatalogDef[] = [
  { id: 'iltv_keshet12', source: 'mako', type: 'series', name: 'קשת 12' },
  { id: 'iltv_reshet13', source: 'reshet', type: 'series', name: 'רשת 13' },
  { id: 'iltv_kan11', source: 'kan', type: 'series', name: 'כאן 11' },
  { id: 'iltv_kankids', source: 'kan', type: 'series', name: 'כאן חינוכית: ילדים ונוער' },
  { id: 'iltv_live', source: 'live', type: 'tv', name: 'שידור חי' },
];

export function catalogDef(id: string): CatalogDef | undefined {
  return CATALOGS.find((c) => c.id === id);
}
