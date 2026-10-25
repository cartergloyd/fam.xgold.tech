# Streaming setup and launch links

The live family sync uses email as the Jellyfin username and the four-digit family
PIN as its password. It runs every minute. Canonical operational details are in
`/home/gold/server-platform/fam-jellyfin-sync/README.md` on the server; no credentials
or account exports belong in this repository. The site does not auto-submit a PIN
or assume that signing into the family site is Jellyfin single sign-on.

Desktop opens https://streaming.xgold.tech. iPhone/iPad opens Jellyfin Mobile using
its registered `org.jellyfin.expo` scheme, with an App Store fallback if the page
stays visible. Visibility/pagehide cancel the fallback so returning from a launched
app does not unexpectedly send the user to the store. Actual installed-app launch
must be checked on a phone; browser tests verify the links and fallback lifecycle.

Android opens the official Google Play listing for Open/Install. The official
Android app currently has no BROWSABLE activity, so Chrome cannot reliably launch
it from this page; do not invent a `jellyfin://` handler or promise installation detection.

Sources checked 2026-10-25:
- iOS registration: https://github.com/jellyfin/jellyfin-ios/blob/master/ios/Jellyfin/Info.plist
- Android manifest: https://github.com/jellyfin/jellyfin-android/blob/master/app/src/main/AndroidManifest.xml
- Chrome requirement: https://developer.chrome.com/docs/android/intents
