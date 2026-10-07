// Settings and comparison sets in chrome.storage.local.
import { pushRun, type CompareRun, type CompareSet } from './compare';

export interface Settings {
  /** Audit automatically when the panel opens / the tab changes (only on granted origins). */
  autoAudit: boolean;
  /** Max links checked by the broken-link probe. */
  linkCheckMax: number;
}

export const DEFAULT_SETTINGS: Settings = { autoAudit: true, linkCheckMax: 150 };

export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: s });
}

export const DEFAULT_SETS: CompareSet[] = [
  {
    id: 'anime-hubs',
    name: 'Anime hub pages',
    createdAt: 0,
    urls: [
      'https://myanimetrip.com/fr/map/16bit-sensation-another-layer',
      'https://animepilgrimage.com/maps/anime/0AvGlAgPpCxpeHIuaJPN/tonikawa',
      'https://www.seichigo.com/en/anime/yuru-camp',
      'https://anitabi.cn/map',
    ],
  },
];

export async function loadSets(): Promise<CompareSet[]> {
  const { compareSets } = await chrome.storage.local.get('compareSets');
  return (compareSets as CompareSet[] | undefined) ?? DEFAULT_SETS;
}

export async function saveSets(sets: CompareSet[]): Promise<void> {
  await chrome.storage.local.set({ compareSets: sets });
}

export async function loadRuns(setId: string): Promise<CompareRun[]> {
  const key = `compareRuns:${setId}`;
  const res = await chrome.storage.local.get(key);
  return (res[key] as CompareRun[] | undefined) ?? [];
}

export async function saveRun(run: CompareRun): Promise<CompareRun[]> {
  const key = `compareRuns:${run.setId}`;
  const next = pushRun(await loadRuns(run.setId), run);
  await chrome.storage.local.set({ [key]: next });
  return next;
}

export async function deleteRuns(setId: string): Promise<void> {
  await chrome.storage.local.remove(`compareRuns:${setId}`);
}
