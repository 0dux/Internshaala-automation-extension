# Commands — Internshala Saved Filters

One-page command reference for this repository. Run everything from the repo
root in PowerShell. `npm.cmd` is required instead of `npm` because PowerShell
blocks `npm.ps1` in this environment.

The project has **no dependencies**, so there is no `npm install` step.

---

## Current release artifact

The release zip is already built:

```
dist/internshala-saved-filters-1.3.2.zip
```

Re-run the package command only after changing the code. `dist/` is
gitignored, so the zip is never committed and must be regenerated on a fresh
clone.

---

## Everyday loop

```powershell
# 1. Rebuild chrome-extension/content.js and sync the version everywhere
npm.cmd run build

# 2. Syntax-check the source, the generated copy, and the build script
node --check "internshala-filter-saver.user.js"
node --check "chrome-extension/content.js"
node --check "scripts/build-extension.mjs"
```

Rules that go with these commands:

- Edit `internshala-filter-saver.user.js` only. `chrome-extension/content.js`
  is generated; any manual edit is overwritten by the next build.
- The version lives in one place: `// @version` in the userscript header.
  `npm.cmd run build` copies it into `chrome-extension/manifest.json` and
  `package.json`.
- `npm.cmd run build` also checks that the four icon files exist.

---

## Build the Chrome Web Store zip

```powershell
npm.cmd run package
```

This runs the build first, then zips `chrome-extension/` into
`dist/internshala-saved-filters-<version>.zip` and validates it:

- `manifest.json` is at the zip root;
- `content.js` is present;
- the archive contains only `manifest.json`, `content.js`, `popup.html`,
  `popup.css`, and `icons/icon{16,32,48,128}.png` — anything else fails the
  build.

It prints the zip path, byte size, and entry list.

---

## Verify the zip by hand

```powershell
$zip = "dist\internshala-saved-filters-1.3.2.zip"
$tmp = Join-Path $env:TEMP "isf-zipcheck"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $zip $tmp

Get-ChildItem $tmp | Select-Object Name

$manifest = Get-Content "$tmp\manifest.json" -Raw | ConvertFrom-Json
"version=$($manifest.version)"
"permissions=$($manifest.permissions -join ',')"
"hostPermissions=$($manifest.host_permissions -join ',')"

Remove-Item $tmp -Recurse -Force
```

Expected: `version=1.3.2`, `permissions=storage`, `hostPermissions=` (empty).

---

## Bump the version

```powershell
# 1. Edit the // @version line at the top of the userscript, e.g. 1.3.3
# 2. Sync it into the manifest and package.json
npm.cmd run build

# 3. Rebuild the zip under the new name
npm.cmd run package
```

Then update the zip filename in `README.md` and `PUBLISHING.md` if it is
mentioned there, and add a matching note to `store/listing.md` when the store
copy mentions a version.

---

## Automated test harness (Chrome for Testing 136)

Chrome for Testing 136 is installed at:

```
%LOCALAPPDATA%\Temp\opencode\cft136\chrome-win64\chrome.exe
```

The harness lives outside the repo:

```
%LOCALAPPDATA%\Temp\opencode\isf-test\isf-cdp-test.mjs
```

```powershell
Set-Location "$env:LOCALAPPDATA\Temp\opencode\isf-test"
node isf-cdp-test.mjs
```

It launches CFT 136 with this extension, serves a synthetic application form at
a real Internshala application URL via CDP `Fetch`, and runs 67 checks covering
filters, answers, the apply queue, and a forged-click rejection. Results are
written to `%TEMP%\isf-report.json`; the profile is
`%TEMP%\isf-profile-<timestamp>`.

Notes:

- Branded Chrome 137+ ignores `--load-extension`, so use CFT 136.
- Under the confined DSH sandbox Chrome cannot start (crashpad's named pipe and
  process access are denied). Run the harness with full access.
- Clicking through CDP requires real input for mutating controls; the harness
  uses `Input.dispatchMouseEvent`, not `.click()`.

---

## Load the extension manually

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this repository's `chrome-extension/`
   folder.

To launch a throwaway Chrome for Testing instance directly:

```powershell
$cft = "$env:LOCALAPPDATA\Temp\opencode\cft136\chrome-win64\chrome.exe"
& $cft --disable-gpu --no-first-run --no-default-browser-check `
  --window-position=-32000,-32000 `
  --remote-debugging-port=9235 `
  --user-data-dir="$env:TEMP\isf-manual-profile" `
  --disable-extensions-except="$PWD\chrome-extension" `
  --load-extension="$PWD\chrome-extension" `
  https://internshala.com/internships/
```

---

## Regenerate icons and store artwork

```powershell
npm.cmd run assets
```

Rewrites `chrome-extension/icons/*.png` and the images in `store/` from
`scripts/generate-assets.ps1`.

---

## Git

```powershell
git status --short
git diff --stat
git log --oneline

# Stage only the files you changed; never add dist/ or local plan files
git add internshala-filter-saver.user.js chrome-extension/content.js
git commit -m "type(scope): summary"

git reset                                  # unstage if a path was wrong
git revert <commit>                        # undo a feature commit safely
```

Before every commit:

```powershell
npm.cmd run build
node --check "internshala-filter-saver.user.js"
node --check "chrome-extension/content.js"
```

Never commit `dist/`, `*.zip`, `node_modules/`, browser profiles, `plan.md`,
or `AGENTS.md`. They are covered by `.gitignore`; do not force-add them.

---

## Store upload

The upload itself must be done by the account owner in the Chrome Web Store
Developer Dashboard.

1. `npm.cmd run package`
2. Upload `dist/internshala-saved-filters-1.3.2.zip`.
3. Paste the copy from `store/listing.md`.
4. Answer the privacy questions as "no data collected".
5. Replace `[your-email@example.com]` in `store/privacy-policy.md` and
   `store/listing.md` before submitting, and put the real store URL in
   `README.md`.

`PUBLISHING.md` and `store/listing.md` are kept locally and are gitignored, so
they will not exist in a fresh clone; the full submission checklist is in
`PUBLISHING.md`.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `npm.ps1 cannot be loaded` | PowerShell execution policy. Use `npm.cmd run ...`. |
| `package` fails with "Unexpected files in the package" | A stray file exists under `chrome-extension/`. Move it out and rerun. |
| Manifest version does not match the userscript | Version comes from `// @version` only. Run `npm.cmd run build`. |
| Zip is missing after a fresh clone | `dist/` is gitignored. Run `npm.cmd run package`. |
| Chrome exits with "crash server failed to launch" | Confined sandbox. Run Chrome / the harness with full access. |
| Harness times out waiting for the extension | Build first (`npm.cmd run build`); the harness loads `chrome-extension/` as-is. |
