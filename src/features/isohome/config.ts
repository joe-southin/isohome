export const LONDON_TERMINI = [
  { crs: 'KGX', name: "King's Cross" },
  { crs: 'PAD', name: 'Paddington' },
  { crs: 'WAT', name: 'Waterloo' },
  { crs: 'VIC', name: 'Victoria' },
  { crs: 'LST', name: 'Liverpool Street' },
  { crs: 'BFR', name: 'Blackfriars' },
  { crs: 'CST', name: 'Cannon Street' },
  { crs: 'CHX', name: 'Charing Cross' },
  { crs: 'EUS', name: 'Euston' },
  { crs: 'MYB', name: 'Marylebone' },
] as const;

export const TIME_BUCKETS = [30, 45, 60, 75, 90, 120] as const;

export type TerminusCRS = (typeof LONDON_TERMINI)[number]['crs'];
export type TimeBucket = (typeof TIME_BUCKETS)[number];
