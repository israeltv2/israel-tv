import { useEffect, useState } from 'react';

export type ThemePick = 'light' | 'dark' | 'system';
const KEY = 'iltv-theme';

function read(): ThemePick {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(pick: ThemePick): void {
  const dark = pick === 'dark' || (pick === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** The theme picked on this device (kept in this browser only), applied to the page. */
export function useTheme(): [ThemePick, (t: ThemePick) => void] {
  const [pick, setPick] = useState<ThemePick>(read);
  useEffect(() => {
    apply(pick);
    try {
      if (pick === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pick);
    } catch {}
    if (pick !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => apply('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [pick]);
  return [pick, setPick];
}
