# Privacy Policy — Internshala Saved Filters

Last updated: 24 October 2026

Internshala Saved Filters is a browser extension that saves Internshala search filters, reuses answers to repeat application questions, and can work through queued applications on your own device, with a manual final submit. This policy explains what is stored and what is not.

## What the extension stores

The extension stores the following in your browser:

- In `localStorage` for `internshala.com` under `isf:v1`: the URL and name of your last filtered internship or job search, saved preset names and URLs, and the auto-open setting.
- In `chrome.storage.local`: application questions you chose to save and their answers under `isf:answers:v1`; the current apply queue under `isf:apply-queue:v1`; apply settings under `isf:apply-settings:v1`; and applied history under `isf:applied:v1`, which records the listing title, URL, time, and whether it was detected or queued. The Tampermonkey userscript uses `localStorage` under the same keys instead.

This information stays in your browser. It is not sent to the developer or to any third party.

## How application answers are used

On an Internshala application page, the extension reads the labels, field types, and available options of the application form so it can match a question to an answer you saved earlier and fill it in. It does not read your account profile, applications, messages, resume files, or credentials.

## How the apply queue works

When you start a queue on an Internshala search page, the extension records the listings on that page, opens them one at a time, and clicks Internshala's own Apply control to reach the application form. It fills saved answers and then stops at a review card. Internshala's submit button is clicked only after you press "Submit application" in that card. The extension does not submit anything on its own.

The extension never stores or fills passwords, OTPs, CAPTCHA responses, payment details, or file uploads, and it does not auto-check consent or terms boxes. It pauses and asks you to complete those yourself.

## What the extension does not do

- No account or login.
- No analytics, tracking, advertising, or profiling.
- No network requests.
- No access to your Internshala account, applications, messages, resumes, or credentials.
- No selling, renting, or sharing of data.

## Export and import

The Export button creates a JSON file of saved searches on your device. You choose where to save it. The Import button reads only the file you select. Neither action uploads anything.

## Deleting your data

You can delete individual presets and saved answers in the panel, stop and clear the apply queue, clear applied history with the "Clear applied history" button, clear Internshala site data in your browser settings, or uninstall the extension. Uninstalling the extension removes its `chrome.storage.local` data. Data saved by the userscript in `localStorage` is removed by clearing site data.

## Changes

If this policy changes, the updated version will be published with the extension listing and the date above will change.

## Contact

Replace this line with your support email before publishing:

`[your-email@example.com]`
