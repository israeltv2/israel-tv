// Before the first paint: the theme the owner picked on this device (light, dark or the system's).
(() => {
  let pick = 'system';
  try {
    pick = localStorage.getItem('iltv-theme') || 'system';
  } catch {}
  const dark = pick === 'dark' || (pick === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
