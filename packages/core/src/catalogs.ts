// Catalog rows: one per channel, Hebrew names, newest episode first.
export interface CatalogDef {
  id: string;
  /** Stremio content type of the row. */
  type: 'series' | 'tv';
  name: string;
}

export const CATALOGS: readonly CatalogDef[] = [
  { id: 'iltv_keshet12', type: 'series', name: 'קשת 12' },
  { id: 'iltv_reshet13', type: 'series', name: 'רשת 13' },
  { id: 'iltv_kan11', type: 'series', name: 'כאן 11' },
  { id: 'iltv_kankids', type: 'series', name: 'כאן חינוכית: ילדים ונוער' },
  { id: 'iltv_live', type: 'tv', name: 'שידור חי' },
];

export function catalogDef(id: string): CatalogDef | undefined {
  return CATALOGS.find((c) => c.id === id);
}
