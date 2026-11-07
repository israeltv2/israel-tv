// A row page's genre filter. The genres are plain links (`?g=…`), so a filtered row has its own address and works
// without the script; the script filters in place instead of loading the page again, and applies `?g=` on arrival.
(() => {
  const chips = document.querySelectorAll('.filters .chip');
  const tiles = document.querySelectorAll('.tiles .tile');
  const pick = (genre) => {
    for (const chip of chips) {
      if (chip.dataset.g === genre) chip.setAttribute('aria-current', 'true');
      else chip.removeAttribute('aria-current');
    }
    for (const tile of tiles) tile.hidden = !!genre && !`|${tile.dataset.g || ''}|`.includes(`|${genre}|`);
  };
  for (const chip of chips)
    chip.addEventListener('click', (e) => {
      // A new tab or window opens the filtered address as it is.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      pick(chip.dataset.g);
      history.replaceState(null, '', chip.getAttribute('href'));
    });
  const filters = document.querySelector('.filters');
  if (filters) {
    filters.removeAttribute('hidden');
    const genre = new URLSearchParams(location.search).get('g') || '';
    if ([...chips].some((c) => c.dataset.g === genre)) pick(genre);
  }
})();
