# Family ribbon

`ribbon.js` owns every icon, label, destination, and current-page highlight.
`ribbon.css` owns the complete ribbon layout and appearance.
Home, Fantasy, and Streaming each mount only `<family-ribbon>` and load those shared files.
Keep navigation behavior in the shared component; page scripts must not override ribbon links.
Streaming always opens `/streaming/` in the current tab.

The ribbon account control uses `family-account.js` and `family-account.css` for the
same email/PIN dialog on every page. Existing `destin-who` profiles are preserved;
PINs stay in the server request and are never stored in browser storage. Home listens
for `family-account-change` to refresh its planning controls after sign-in or switching people.
On desktop, the control puts right-aligned text immediately to the left of the avatar.
At 1000px and below, the account is the sixth equal column in the same row as the five
app icons, with its label below. Labels fade away in compact mode. Icon slots stay fixed;
one scroll-linked progress value drives icon transforms, label opacity, and bar height.
A short animation-frame smoothing filter follows scroll changes in either direction,
without restarting separate threshold animations. Reduced motion applies updates immediately.
The ribbon uses a translucent, blurred background that includes `env(safe-area-inset-top)`.
Every page opts into the translucent iOS standalone status bar so the same glass can
extend behind the clock, while interactive controls stay below the safe area.
The actual installed-iPhone status bar must be checked on a device; browser tests simulate
the inset and cannot validate iOS system chrome.

Run the browser regression check after ribbon changes:

```sh
npm ci
npx playwright install chromium
npm run test:ribbon
```

The test compares all three pages at five viewport widths and actually clicks Streaming,
checks the final URL, waits for delayed redirects, and rejects new tabs.
Account checks use mocked directory/login/register responses and never write to live accounts.
They cover sign-in, switching people, saved profiles, focus restoration, and the account layout.
It also checks that desktop Streaming is centered, mobile has six equally spaced icons
in one row, and scrolling compacts the sticky ribbon while preserving accessible labels and 44px touch targets.
Animation checks sample intermediate frames in both directions and verify monotonic icon scaling.
Returning to the top restores the expanded ribbon. The ribbon keeps its document space
to avoid layout jumps when it changes size.
It isolates the home page's sign-in overlay in the test browser without signing in.

To check the deployed site:

```sh
FAM_TEST_URL=https://fam.xgold.tech npm run test:ribbon
```

Publish changes directly to `main`, per the owner's preference.

Minecraft and Condos now resolve to `/mc/` and `/6108/`. Both mount the same ribbon
and account control; the ribbon's existing `/mc` and `/6108` links are preserved.
