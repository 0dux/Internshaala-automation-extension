# Publishing to the Chrome Web Store

This folder is ready to upload as a Manifest V3 extension. The behavior is the same as the Tampermonkey userscript; the only difference is how it is installed.

## What gets uploaded

Upload the zip from `dist/`. Its root must contain `manifest.json`, `content.js`, `popup.html`, and `icons/`.

```
dist/internshala-saved-filters-1.1.1.zip
```

Do **not** zip the whole project folder. If the zip contains a top-level `chrome-extension/` folder, the Chrome Web Store will reject it.

## 1. Test the unpacked extension first

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `chrome-extension/` folder.
4. Open `https://internshala.com/internships/`.
5. Apply a filter, click **Saved filters** in the bottom-left, and save the search.
6. Reload the page and confirm the preset is still there.
7. Click the extension's toolbar icon and check that the popup opens.

No presets are included on purpose. The extension starts empty.

## 2. Create the store listing

You need a Chrome Web Store developer account. Google charges a one-time registration fee (currently US$5) and requires email verification.

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Click **Add new item** and upload the zip.
3. Open the **Store listing** tab and copy the text from [`listing.md`](listing.md).
4. Upload:
   - `store/icon-128.png`
   - `store/screenshot-1280x800.png`
   - `store/promo-tile-440x280.png` (optional promo tile)
5. Choose **Productivity** as the category and **English** as the language.
6. Add the screenshot caption from the listing.

## 3. Privacy practices

In the **Privacy practices** tab:

- Single purpose: "Save and restore Internshala internship and job search filters."
- Explain that the content script adds the saved-filters panel on Internshala and reads only the current URL.
- Answer **No** to collecting user data, selling data, using remote code, and using authentication/cookies.
- A privacy policy URL is normally optional when no data is collected. If the dashboard asks for one, publish [`privacy-policy.md`](privacy-policy.md) somewhere public (GitHub Pages, for example) and paste the URL.

The extension requests no `permissions` and no `host_permissions`. Chrome will still show a host warning because the content script runs on `internshala.com`; that is expected.

## 4. Distribution and review

1. Set distribution to **Public**, **Free**, and all regions.
2. Submit for review.
3. Review usually takes a few days. Watch the developer email for questions.
4. After approval, copy the store URL into the root `README.md`.

## Trademark note

"Internshala" is used descriptively to explain what the extension works with. The listing and popup say **Unofficial helper. Not affiliated with Internshala.** If review objects to the name, rename it to **Saved Filters for Internshala** and keep the same functionality.

## Making changes later

The userscript is the source of truth. `chrome-extension/content.js` is generated from it.

1. Edit `internshala-filter-saver.user.js`.
2. Bump `@version` at the top of the userscript.
3. Run:

```powershell
npm.cmd run package
```

This rebuilds `chrome-extension/content.js`, syncs the manifest version, and creates a new zip in `dist/`.

4. Upload the new zip in the developer dashboard. Chrome Web Store requires a higher version number than the previous upload.

## Files

| Path | Purpose |
| --- | --- |
| `chrome-extension/manifest.json` | Extension manifest |
| `chrome-extension/content.js` | Generated content script (do not edit directly) |
| `chrome-extension/popup.html` | Toolbar popup |
| `chrome-extension/popup.css` | Popup styles |
| `chrome-extension/icons/` | Extension icons |
| `store/` | Listing copy, privacy policy, screenshot, promo tile |
| `dist/` | Uploadable zip |

## Before you publish

- [ ] Replace the contact email in `store/privacy-policy.md`.
- [ ] Test the unpacked extension on a clean Chrome profile.
- [ ] Confirm the zip has `manifest.json` at its root.
- [ ] Add the published store URL to `README.md` after approval.
