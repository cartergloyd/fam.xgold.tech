(() => {
  const hero = document.getElementById('streaming-hero');
  const backdrop = document.getElementById('artwork-backdrop');
  const toggle = document.getElementById('artwork-pause');
  const api = 'https://fam-api.xgold.tech';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false, visible = true;
  const paint = () => {
    hero.classList.toggle('is-paused', paused || !visible || document.hidden || reduced.matches);
    toggle.hidden = reduced.matches || !hero.classList.contains('has-artwork');
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? 'Play artwork' : 'Pause artwork');
    toggle.firstElementChild.textContent = paused ? '▶' : 'Ⅱ';
  };
  toggle.addEventListener('click', () => { paused = !paused; paint(); });
  document.addEventListener('visibilitychange', paint);
  reduced.addEventListener('change', paint);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; paint(); }).observe(hero);
  (async () => {
    try {
      const response = await fetch(api + '/family/streaming-artwork/recent.json', { credentials:'omit', signal:AbortSignal.timeout(8000) });
      if (!response.ok) return;
      const feed = await response.json();
      const paths = [...new Set((feed.posters || []).map(p => p.image))]
        .filter(p => /^\/family\/streaming-artwork\/[a-f0-9]{32}\.jpg$/.test(p)).slice(0,24);
      if (!paths.length) return;
      // Decode before revealing so failed or slow artwork never flashes broken images.
      const images = await Promise.all(paths.map(async path => {
        const img = new Image(); img.alt = ''; img.width = 168; img.height = 252;
        img.decoding = 'async'; img.src = api + path;
        try { await img.decode(); return img; } catch { return null; }
      }));
      const loaded = images.filter(Boolean);
      if (!loaded.length) return;
      for (let row = 0; row < 2; row++) {
        const strip = document.createElement('div'); strip.className = 'artwork-row';
        const group = document.createElement('div'); group.className = 'artwork-group';
        // At least twelve posters per row keeps large screens covered throughout the loop.
        for (let i = 0; i < Math.max(12, Math.ceil(loaded.length / 2)); i++) {
          group.append(loaded[(row * 12 + i) % loaded.length].cloneNode());
        }
        strip.append(group, group.cloneNode(true)); backdrop.append(strip);
      }
      hero.classList.add('has-artwork'); paint();
    } catch { /* The launch icon and instructions remain usable without artwork. */ }
  })();
})();
