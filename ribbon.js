/* One navigation component for every family page. */
(() => {
  const items = [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/mc', label: 'Minecraft', icon: 'minecraft' },
    { href: '/streaming/', label: 'Streaming', icon: 'jellyfin' },
    { href: '/ff/', label: 'Fantasy', icon: 'sleeper' },
    { href: '/6108', label: 'Condos', icon: 'calendar' },
  ];
  class FamilyRibbon extends HTMLElement {
    connectedCallback() {
      const path = location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
      this.innerHTML = `<nav class="family-ribbon" aria-label="Family sites"><ul>${items.map(item => {
        const current = path === (item.href.replace(/\/$/, '') || '/');
        return `<li><a href="${item.href}" aria-label="${item.label}" title="${item.label}"${current ? ' aria-current="page"' : ''}><span class="family-ribbon-icon" aria-hidden="true"><img src="/assets/app-icons/${item.icon}.png" width="40" height="40" alt=""></span><span class="family-ribbon-label">${item.label}</span></a></li>`;
      }).join('')}</ul></nav>`;
      this.updateScrollState = () => {
        if (this.scrollFrame) return;
        this.scrollFrame = requestAnimationFrame(() => {
          this.scrollFrame = null;
          const threshold = this.hasAttribute('compact') ? 16 : 48;
          this.toggleAttribute('compact', window.scrollY > threshold);
        });
      };
      window.addEventListener('scroll', this.updateScrollState, { passive: true });
      window.addEventListener('pageshow', this.updateScrollState);
      this.updateScrollState();
    }
    disconnectedCallback() {
      window.removeEventListener('scroll', this.updateScrollState);
      window.removeEventListener('pageshow', this.updateScrollState);
      cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = null;
    }
  }
  customElements.define('family-ribbon', FamilyRibbon);
})();
