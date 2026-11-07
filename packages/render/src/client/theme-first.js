// Runs in the page's head, before it paints: a remembered theme never flashes.
try {
  const theme = localStorage.getItem('iltv-theme');
  if (theme) document.documentElement.dataset.theme = theme;
} catch {}
