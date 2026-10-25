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
The control puts right-aligned text immediately to the left of the avatar, then hides
the text in the compact ribbon. Narrow screens give it a separate upper row when expanded
to preserve the centered navigation. The ribbon uses a translucent, blurred background.

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
It also checks that Streaming is centered, icon spacing is equal, and scrolling compacts
the sticky ribbon while preserving accessible labels and 44px touch targets.
Returning to the top restores the expanded ribbon. The ribbon keeps its document space
to avoid layout jumps when it changes size.
It isolates the home page's sign-in overlay in the test browser without signing in.

To check the deployed site:

```sh
FAM_TEST_URL=https://fam.xgold.tech npm run test:ribbon
```

Publish changes directly to `main`, per the owner's preference.
