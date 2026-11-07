// A row page's genre filter: show only the shows of the chosen genre (without the script every show is shown and the
// filter stays hidden).
(() => {
  const buttons = document.querySelectorAll('.filters .chip');
  const tiles = document.querySelectorAll('.tiles .tile');
  for (const button of buttons)
    button.addEventListener('click', () => {
      const genre = button.dataset.g;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
      for (const tile of tiles) tile.hidden = !!genre && !`|${tile.dataset.g || ''}|`.includes(`|${genre}|`);
    });
  document.querySelector('.filters')?.removeAttribute('hidden');
})();
