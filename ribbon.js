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
        return `<li><a href="${item.href}"${current ? ' aria-current="page"' : ''}><span class="family-ribbon-icon" aria-hidden="true"><img src="/assets/app-icons/${item.icon}.png" width="40" height="40" alt=""></span><span>${item.label}</span></a></li>`;
      }).join('')}</ul></nav>`;
    }
  }
  customElements.define('family-ribbon', FamilyRibbon);
})();
