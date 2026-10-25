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
      }).join('')}</ul><button class="family-ribbon-account" type="button" aria-label="Sign in"><span class="family-ribbon-account-name">Sign in</span><span class="family-ribbon-account-avatar" aria-hidden="true"></span></button></nav>`;
      this.accountButton = this.querySelector('.family-ribbon-account');
      this.accountButton.addEventListener('click', () => window.familyAccount.show());
      this.updateAccount = () => {
        const member = window.familyAccount.current;
        this.accountButton.toggleAttribute('data-member', !!member);
        this.querySelector('.family-ribbon-account-name').textContent = member ? member.name : 'Sign in';
        this.accountButton.setAttribute('aria-label', member ? `Signed in as ${member.name}. Switch person` : 'Sign in');
        this.accountButton.title = this.accountButton.getAttribute('aria-label');
        const avatar = this.querySelector('.family-ribbon-account-avatar');
        avatar.replaceChildren();
        if (member && window.familyAccount.photo) {
          const image = document.createElement('img');
          image.src = window.familyAccount.photo(member.name); image.alt = '';
          avatar.appendChild(image);
        } else {
          avatar.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/></svg>';
        }
      };
      window.addEventListener('family-account-change', this.updateAccount);
      this.updateAccount();
      window.familyAccount.ready.then(this.updateAccount).catch(this.updateAccount);
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
      window.removeEventListener('family-account-change', this.updateAccount);
      window.removeEventListener('scroll', this.updateScrollState);
      window.removeEventListener('pageshow', this.updateScrollState);
      cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = null;
    }
  }
  customElements.define('family-ribbon', FamilyRibbon);
})();
