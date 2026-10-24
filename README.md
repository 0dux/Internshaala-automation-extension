# Internshala Saved Filters

A Chrome extension (and optional Tampermonkey userscript) that remembers your Internshala search filters, restores them in one click, and reuses your answers to repeat application questions.

![Saved filters panel](preview.png)

## The idea

Internshala already puts every filter into the page URL. For example:

```
https://internshala.com/internships/full-stack-development-internship/
https://internshala.com/internships/full-stack-development,front-end-development,back-end-development-internship-in-delhi/
https://internshala.com/jobs/full-stack-development-jobs/
```

So there is no need to automate the dropdowns, checkboxes, or the **Apply** button (which would break every time the site's markup changes). The extension simply saves the filtered URL, gives it a name, and opens it later.

That also means a plain browser bookmark is enough for a no-install solution. The extension adds the quality-of-life parts: a preset list, automatic saving of the last search, rename, backup, and one-click restore.

## What it does

- **Save any filtered search** as a named preset (e.g. "Full stack + Delhi").
- **Rename** a saved search without deleting and recreating it.
- **Export and import** presets as a JSON backup, so they can be moved to another browser or restored later.
- **Remembers your last search automatically** whenever you apply filters.
- Shows a **"Resume last search"** button when you land on the unfiltered internships/jobs page.
- Optional **auto-open last search** in a new tab.
- Works for both **internships** and **jobs**, and groups presets by section.
- **Remembers application answers** (cover letters, availability, skills, and similar questions) and fills them into matching fields on later applications.
- **Prompts for new questions** instead of guessing, with an Answers tab to search, edit, and delete saved answers.
- **Queues listings into an assisted apply flow**: it opens each listing, fills the form from your saved answers, and shows a review card. It submits only after you press **Submit application**.
- Tracks **applied history** so listings you already applied to are skipped next time, with a 20-per-24-hours cap and a cooldown between applications.
- Stores everything **locally in your browser**. No account, no server, no network requests.
- Has a small, isolated UI built with Shadow DOM, so Internshala's CSS does not affect it.
- Starts with **no presets**. You add only the searches you actually use.

## Install the Chrome extension

### From the Chrome Web Store

After the extension is approved, the store link will go here:

> **Chrome Web Store:** _add the published URL here_

### Load it manually for testing

1. Download or clone this folder.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `chrome-extension/` folder.
5. Open [internshala.com/internships](https://internshala.com/internships), apply filters, and click **Saved filters** in the bottom-left corner.

The extension requests only the `storage` permission, which keeps saved application answers out of the page's `localStorage`. Chrome will show a host warning because it adds the panel to Internshala pages; that is expected.

### Build the uploadable zip

```powershell
npm.cmd run package
```

The file is created at `dist/internshala-saved-filters-1.3.0.zip`. The zip has `manifest.json` at its root, ready for the Chrome Web Store.

See [`PUBLISHING.md`](PUBLISHING.md) for the full upload and review checklist.

## Install the Tampermonkey userscript (alternative)

The original userscript is still included for Firefox users or anyone who prefers Tampermonkey.

1. Install [Tampermonkey](https://www.tampermonkey.net/) for Chrome, Edge, or Firefox.
2. Click the Tampermonkey icon → **Create a new script**.
3. Delete the template and paste the contents of [`internshala-filter-saver.user.js`](internshala-filter-saver.user.js).
4. Save with `Ctrl+S` (or `Cmd+S`).
5. Open [internshala.com/internships](https://internshala.com/internships), apply your filters, then click **Saved filters** in the bottom-left corner.

If you host the `.user.js` file somewhere (GitHub Gist raw URL, for example), opening that URL will show Tampermonkey's install screen instead of requiring a copy-paste.

## Usage

### Save a search

1. Apply any combination of filters normally: profile, location, work from home, part-time, stipend, duration, PPO, and so on.
2. Click **Saved filters**.
3. Click **Save this search**.
4. Give it a name (the name is pre-filled from the URL) and click **Save**.

The URL is cleaned before saving: tracking parameters and `page-2`-style pagination are removed, so the preset always starts at the first page.

### Restore a search

- On an unfiltered page, click **Resume last search**.
- Or open **Saved filters** and click any preset.
- If **Auto-open my last search** is enabled, the last search opens automatically once per new tab when you land on the unfiltered page.

### Delete or clear

- Click the trash icon next to a preset to delete it.
- **Clear** in the panel footer forgets the last-used search for the current section.
- Turning off **Auto-open** stops the automatic redirect.

### Rename a saved search

1. Open **Saved filters**.
2. Click the pencil icon next to the preset.
3. Edit the name and press **Save** (or `Enter`). Press **Cancel** or `Esc` to leave it unchanged.

### Back up or move presets

- **Export** downloads a `.json` file containing your presets and last-used searches.
- **Import** reads that file back. Existing searches with the same URL are skipped, so importing twice is safe.
- Import also works with a plain JSON array of presets, in case you build one by hand.

The file is created and read locally. Nothing is uploaded. This is useful when changing browsers or computers, because `localStorage` does not sync between them.

### Reuse application answers

1. Open an internship or job application form.
2. The assistant scans the form and fills any question you have answered before.
3. New questions appear in the card at the bottom right. Type your answer and choose **Save answer**, or **Skip** it for now.
4. Open **Application answers** in the bottom-left to search, edit, or delete saved answers.

Only exact question matches are filled. If a saved answer does not fit the field type or the available options, the assistant asks instead of guessing. File uploads, passwords, OTPs, CAPTCHAs, and consent checkboxes are never filled or stored.

### Queue applications

1. Open a filtered internships or jobs search page.
2. Click **Saved filters** → **Apply** → **Start queue**. The panel lists the cards on the page, drops listings already in your applied history, and asks you to confirm the queue.
3. The assistant opens each listing, then the application form. Saved answers are filled in; anything it does not know is shown in the question card.
4. Before anything is sent, a review card at the top right shows which required questions are answered and what still blocks submission: a missing required file, an unticked consent box, a CAPTCHA, or a validation error.
5. Fix those yourself. When the card says the form is ready, press **Submit application**. That is the only moment the assistant clicks Internshala's submit button.
6. After the site confirms, the listing is added to applied history and the next one starts after a short cooldown. **Skip**, **Stop**, **Resume**, and **Clear queue** are always available.

Auto-submit is not part of this release; the mode selector is fixed to **Review before submit**. The assistant also pauses on its own when something is unexpected (login, OTP, CAPTCHA, a missing Apply button, a form that will not load, or three problems in a row) and tells you what to check. Nothing is retried automatically.

If no real `<form>` contains the fields, or the submit button cannot be identified reliably, the assistant does not click blindly. It offers **Mark applied** instead, so you can submit on the site yourself and still keep the history accurate.

## No-install alternative

If you only need two or three searches, you do not need this extension at all:

1. Apply your filters.
2. Copy the URL from the address bar.
3. Bookmark it with a clear name.

Opening the bookmark restores the filtered search. The extension is essentially a nicer manager for the same trick.

## Why not Python / Selenium?

A Python + Selenium or Playwright script would launch a separate automated browser. That means dealing with login sessions, CAPTCHAs, changing markup, and a slower workflow. For "save my filters and reopen them while I browse", an extension is the right tool because it runs inside your normal, already-logged-in browser.

Python is still a good choice if you later want something different, such as a scheduled job that checks for new internships and emails you. That is a separate project.

## How it works

- Detects whether the current page is an internship search, a job search, a detail page, or an application form.
- Reads the current URL and normalizes it:
  - removes `utm_*`, `gclid`, `fbclid`, and similar tracking parameters;
  - removes `page-N` from the path;
  - normalizes the trailing slash.
- Derives a readable name from the URL, e.g.  
  `full-stack-development,front-end-development-internship-in-delhi` →  
  `Full Stack Development, Front End Development in Delhi`.
- Stores presets and the last search in `localStorage` under the key `isf:v1`.
- Reads application question labels and options, looks for an exact saved match, and fills text, select, radio, and checkbox fields through native events.
- Stores saved answers separately (`chrome.storage.local` in the extension, `localStorage` in the userscript) so page scripts cannot read them.
- Keeps the apply queue and applied history in the same private storage, so progress survives page navigation and reopened tabs.
- Paces the queue: one application at a time, one tab, 8–15 second cooldown, and a daily limit.
- Exports and imports the same filter data as JSON, merging presets by their cleaned URL.
- Renders the UI inside a Shadow DOM so page styles cannot leak in.
- Uses the URL as the source of truth for filters. No clicks on Internshala's filter controls, no fragile selectors.

The Chrome extension's content script is generated from the userscript, so both versions share the same behavior.

## Data and privacy

- Saved searches and settings stay in `localStorage` on `internshala.com` under `isf:v1`.
- Saved application answers stay in `chrome.storage.local` when the extension is used, and in `localStorage` under `isf:answers:v1` in the userscript. The apply queue, settings, and applied history use the same storage.
- The extension makes no network requests. It reads application form labels and options only on Internshala application pages, so it can match and fill saved answers.
- It does not read your account profile, applications, messages, resume files, or credentials. It clicks Internshala's submit button only after you press **Submit application** in the review card, and it never ticks consent boxes or attaches files.
- The toolbar popup is a static help card with a link to Internshala.
- Clearing the site's cookies/site data removes saved searches; extension storage is removed by uninstalling the extension or clearing its data.
- Saved searches, answers, and queue progress do not sync between browsers or devices. Use Export/Import to move searches.

The full policy is in [`store/privacy-policy.md`](store/privacy-policy.md).

## Limitations

- Presets and answers are per browser profile.
- Only `https://internshala.com` links are accepted; invalid or non-Internshala links are ignored.
- Imports are capped at 2 MB / 500 presets to keep the panel responsive. Saving new searches is not capped.
- Answers match only when the question text is the same (ignoring case, spacing, and required markers). Reworded questions are asked again.
- The apply queue works on the listings of the current page. Pagination, retries, and auto-submit are not included yet.
- The assistant never attaches files, solves CAPTCHAs, ticks consent boxes, or signs in for you. It pauses and waits for you in those cases.
- If Internshala changes its application form markup, the assistant stops with a "layout changed" style message instead of clicking blindly.
- Applied history records what the assistant saw. If you apply manually outside the queue, that listing is not known until it shows an "already applied" state or you press **Mark applied**.
- If Internshala changes its URL scheme, older saved URLs may stop working.
- Filters that are stored only in a cookie or in "As per my preferences" may not be represented in the URL, so they may not be captured.
- This is an unofficial helper and is not affiliated with Internshala.
- Tested with the current desktop search page. Internshala changes its UI regularly; the URL-based approach is chosen specifically to survive most of those changes.

## Project structure

| Path | Purpose |
| --- | --- |
| `chrome-extension/` | Manifest V3 Chrome extension |
| `chrome-extension/manifest.json` | Extension manifest |
| `chrome-extension/content.js` | Generated content script (do not edit directly) |
| `chrome-extension/popup.html` | Toolbar popup |
| `internshala-filter-saver.user.js` | Tampermonkey userscript and source of truth |
| `scripts/build-extension.mjs` | Regenerates `content.js` and syncs the version |
| `scripts/generate-assets.ps1` | Regenerates icons and store images |
| `scripts/package-extension.ps1` | Builds the uploadable zip |
| `store/` | Listing copy, privacy policy, screenshot, promo tile |
| `dist/` | Uploadable Chrome Web Store zip |
| `PUBLISHING.md` | Step-by-step store submission guide |
| `preview.png` | Screenshot of the panel |

## Development

Edit `internshala-filter-saver.user.js`; it is the source of truth for the extension.

```powershell
# Rebuild chrome-extension/content.js and sync the manifest version
npm.cmd run build

# Regenerate icons and Chrome Web Store images
npm.cmd run assets

# Build the uploadable zip
npm.cmd run package
```

`chrome-extension/content.js` is generated. Do not edit it directly.

## Publishing

See [`PUBLISHING.md`](PUBLISHING.md). The short version:

1. Test with **Load unpacked**.
2. Upload `dist/internshala-saved-filters-1.3.0.zip` to the Chrome Web Store Developer Dashboard.
3. Use the copy in [`store/listing.md`](store/listing.md).
4. Answer the privacy questions as "no data collected."
5. Submit for review.

The extension name uses "Internshala" descriptively. The listing and popup clearly say it is unofficial. If review objects, rename it to **Saved Filters for Internshala**.
