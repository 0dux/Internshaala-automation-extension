# Chrome Web Store listing

## Name

Internshala Saved Filters

## Short description (132 characters max)

Save, rename, and restore Internshala internship and job search filters in one click. Local-only and unofficial.

## Detailed description

Stop re-entering the same Internshala filters.

Internshala Saved Filters remembers the searches you use and lets you reopen them in one click. It works with both internships and jobs, and it saves everything locally in your browser.

HOW IT WORKS

1. Open Internshala and apply your filters as usual.
2. Click "Saved filters" in the bottom-left corner.
3. Save the search with a name.
4. Reopen it later from the panel.

FEATURES

- Automatically remembers your last filtered search for internships and jobs.
- Save as many named presets as you need.
- Rename a preset without deleting and recreating it.
- Shows a "Resume last search" button on the unfiltered page.
- Optional auto-open of your last search, once per new tab.
- Export and import presets as a JSON backup.
- Responsive panel that stays clear of the site's bottom bar.
- Uses the page URL, so it keeps working when Internshala changes its filter UI.

NO PRELOADED SEARCHES

The extension starts empty. Add your own filters once, save the search, and it will be there next time.

PRIVACY

No account, no tracking, no network requests. Presets stay in localStorage on internshala.com. Export creates a file on your device.

NOTES

- Unofficial helper, not affiliated with Internshala.
- Presets are per browser profile and do not sync across devices. Use Export/Import to move them.
- If Internshala changes its URL structure, older saved URLs may stop working.

## Category

Productivity

## Language

English

## Search terms

internshala, saved searches, filters, internships, jobs, presets, job search

## Support

Replace with your support email before publishing:

`[your-email@example.com]`

## Screenshot captions

1. Saved filters panel on an Internshala search page.

## Store assets

- Icon: `store/icon-128.png`
- Screenshot (1280 x 800): `store/screenshot-1280x800.png`
- Small promo tile (440 x 280): `store/promo-tile-440x280.png`

## Single purpose

Save and restore Internshala internship and job search filters.

## Permission justification

The extension requests no `permissions` and no `host_permissions`.

It declares a content script for `https://internshala.com/*` and `https://www.internshala.com/*` so it can show the Saved filters panel on Internshala search pages. The content script reads the current page URL and stores presets in the page's `localStorage`. It does not read page content, credentials, messages, or applications, and it makes no network requests.

Why the host warning appears: Chrome shows "Read and change your data on internshala.com" for any content script that runs on that site. This extension only adds its own panel and stores data locally.

## Privacy practices answers

- Does the extension collect user data? **No.**
- Does it sell or transfer user data? **No.**
- Does it use or transfer data for purposes unrelated to the single purpose? **No.**
- Does it use remote code? **No.**
- Does it use authentication or cookies? **No.**
- Does it collect web history? **No.** It reads the current Internshala URL only to remember the last search, and stores it locally.
- Privacy policy URL: optional when no data is collected. If the dashboard asks for one, host `privacy-policy.md` and paste the public URL.

## Review notes

- This is an unofficial helper. The name and description say so.
- No remote code, no network requests, no analytics.
- To test: open `https://internshala.com/internships/`, apply any filter, click "Saved filters" in the bottom-left, and save the search. The preset can then be reopened from the panel.
- The extension starts with no presets by design.
