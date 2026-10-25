/* Jellyfin Mobile's iOS scheme is registered in its native Info.plist. */
(() => {
  const icon = document.getElementById('open-jellyfin');
  const note = document.getElementById('launch-note');
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(navigator.userAgent);
  const iosStore = 'https://apps.apple.com/app/jellyfin-mobile/id1480192618';
  const androidStore = 'https://play.google.com/store/apps/details?id=org.jellyfin.mobile';
  let fallback;
  const cancelFallback = () => { clearTimeout(fallback); fallback = null; };
  if (ios) {
    icon.href = 'org.jellyfin.expo://';
    note.textContent = 'Opens Jellyfin Mobile, or the App Store if it is not installed.';
    icon.addEventListener('click', () => {
      cancelFallback();
      const started = Date.now();
      fallback = setTimeout(() => {
        if (!document.hidden && Date.now() - started < 4000) location.assign(iosStore);
      }, 2200);
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelFallback(); });
    window.addEventListener('pagehide', cancelFallback);
    window.addEventListener('pageshow', cancelFallback);
  } else if (android) {
    // The official Android app has no BROWSABLE activity; do not invent a launch scheme.
    icon.href = androidStore;
    note.textContent = 'Choose Open if installed, or Install to get Jellyfin Mobile.';
  }
  document.getElementById('streaming-signin').addEventListener('click', () => window.familyAccount.show());
  const paintLogin = () => {
    const current = window.familyAccount.current;
    document.getElementById('login-email').textContent = current ? current.email : 'your family email';
    document.getElementById('streaming-signin').textContent = current ? `Signed in as ${current.name}` : 'Sign in or create your profile';
  };
  window.addEventListener('family-account-change', paintLogin);
  window.familyAccount.ready.then(paintLogin).catch(() => {});
})();
