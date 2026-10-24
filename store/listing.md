# Chrome Web Store listing

## Name

Internshala Saved Filters

## Short description (132 characters max)

Save Internshala searches, reuse answers to repeat application questions, and review applications before you submit. Local-only, no tracking, unofficial.

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
- Remembers answers to repeat application questions and fills them into matching fields.
- Prompts for new questions instead of guessing, with an Answers tab to search, edit, and delete saved answers.
- Queues the listings on a search page and opens them one at a time, filling each application with your saved answers.
- Shows a review card with what is answered and what still blocks submission, then submits only after you press "Submit application".
- Keeps applied history so listings you already applied to are skipped, with a 20-per-24-hours cap and a cooldown between applications.
- Never fills passwords, OTPs, CAPTCHAs, file uploads, or consent boxes. It pauses instead.
- Responsive panel that stays clear of the site's bottom bar.
- Uses the page URL, so it keeps working when Internshala changes its filter UI.

NO PRELOADED SEARCHES

The extension starts empty. Add your own filters once, save the search, and it will be there next time.

NO ACCOUNT, NO TRACKING

No account, no tracking, no network requests. Searches stay in localStorage on internshala.com. Saved answers, the apply queue, and applied history stay in the extension's local storage (or localStorage in the userscript). Export creates a file on your device.

ABOUT SUBMITTING

The default flow is assisted: the extension opens each application, fills what it knows, and stops at a review card. Internshala's submit button is clicked only after you press "Submit application" in that card. Auto-submit is not included in this version.

NOTES

- Unofficial helper, not affiliated with Internshala.
- Presets are per browser profile and do not sync across devices. Use Export/Import to move them.
- If Internshala changes its URL structure or application form markup, older saved URLs may stop working and the assistant pauses instead of guessing.

## Category

Productivity

## Language

English

## Search terms

internshala, saved searches, filters, internships, jobs, presets, job search, application answers, apply queue

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

Save and restore Internshala internship and job searches, reuse answers to repeat application questions, and review queued applications before submitting them.

## Permission justification

The extension requests only the `storage` permission, used to keep saved application answers, the apply queue, settings, and applied history in `chrome.storage.local` instead of the page's `localStorage`.

It declares a content script for `https://internshala.com/*` and `https://www.internshala.com/*` so it can show the panel on Internshala search pages and fill saved answers on application pages. It reads the current page URL, application question labels, field types, and available options, and it clicks Internshala's own Apply and submit controls: Apply when moving through a queue the user started, and submit only after the user presses "Submit application" in the review card. It stores data locally and makes no network requests. It does not read account credentials, messages, resume files, or profile data, and it never ticks consent boxes or attaches files.

Why the host warning appears: Chrome shows "Read and change your data on internshala.com" for any content script that runs on that site. This extension only adds its own panel, reads the application form, and stores data locally.

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
- To test filters: open `https://internshala.com/internships/`, apply any filter, click "Saved filters" in the bottom-left, and save the search. The preset can then be reopened from the panel.
- To test answers: open any internship application form, answer a question in the "Application questions" card, and save it. The answer is filled automatically the next time the same question appears. The extension does not submit the form on its own.
- To test the apply queue: open an internships search page, open the panel, switch to Apply, and press "Start queue". The extension opens the first listing and its application form, fills saved answers, and shows a review card. Submission requires pressing "Submit application" in that card. Press "Stop" to end the run.
- The extension starts with no presets by design.
