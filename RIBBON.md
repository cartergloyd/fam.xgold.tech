# Family ribbon

`ribbon.js` owns every icon, label, destination, and current-page highlight.
`ribbon.css` owns the complete ribbon layout and appearance.
Home, Fantasy, and Streaming each mount only `<family-ribbon>` and load those shared files.
Keep navigation behavior in the shared component; page scripts must not override ribbon links.
Streaming always opens `/streaming/` in the current tab.

Run the browser regression check after ribbon changes:

```sh
npm ci
npx playwright install chromium
npm run test:ribbon
```

The test compares all three pages at five viewport widths and actually clicks Streaming,
checks the final URL, waits for delayed redirects, and rejects new tabs.
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
