# Privacy Policy — Internshala Saved Filters

Last updated: 24 October 2026

Internshala Saved Filters is a browser extension that saves Internshala search filters and reuses answers to repeat application questions on your own device. This policy explains what is stored and what is not.

## What the extension stores

The extension stores the following in your browser:

- In `localStorage` for `internshala.com` under `isf:v1`: the URL and name of your last filtered internship or job search, saved preset names and URLs, and the auto-open setting.
- In `chrome.storage.local` under `isf:answers:v1`: application questions you chose to save, the answer text or selected options, and usage timestamps. The Tampermonkey userscript uses `localStorage` under the same key instead.

This information stays in your browser. It is not sent to the developer or to any third party.

## How application answers are used

On an Internshala application page, the extension reads the labels, field types, and available options of the application form so it can match a question to an answer you saved earlier and fill it in. It does not read your account profile, applications, messages, resume files, or credentials, and it does not submit the form. You always make the final submission.

The extension never stores or fills passwords, OTPs, CAPTCHA responses, payment details, or file uploads, and it does not auto-check consent or terms boxes.

## What the extension does not do

- No account or login.
- No analytics, tracking, advertising, or profiling.
- No network requests.
- No access to your Internshala account, applications, messages, resumes, or credentials.
- No selling, renting, or sharing of data.

## Export and import

The Export button creates a JSON file of saved searches on your device. You choose where to save it. The Import button reads only the file you select. Neither action uploads anything.

## Deleting your data

You can delete individual presets and saved answers in the panel, clear the last search with the Clear button, clear Internshala site data in your browser settings, or uninstall the extension. Uninstalling the extension removes its `chrome.storage.local` data. Answers saved by the userscript in `localStorage` are removed by clearing site data.

## Changes

If this policy changes, the updated version will be published with the extension listing and the date above will change.

## Contact

Replace this line with your support email before publishing:

`[your-email@example.com]`
