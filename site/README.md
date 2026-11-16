# The website, and where releases go

CLIque's source stays in this private repo. The website and the downloads live in a separate **public** repo: its
GitHub Pages serves the site, and its Releases hold the Mac and Windows apps. `.github/workflows/release.yml` builds
both from here and puts them there. Nothing else goes into the public repo.

The site is plain HTML and CSS: no JavaScript, no cookies, no trackers, nothing loaded from other sites. It has a home
page, `privacy.html`, `support.html` and a 404 page, in light and dark (following the system).

| | |
|---|---|
| `config.mjs` | the product name, company, contact address and **every download link** |
| `privacy.md` | the privacy policy (the source of `privacy.html`, and plain text for the store forms) |
| `src/` | the pages' words (`index.html`, `support.html`, `404.html`) |
| `build.mjs` | makes the site in `_site/` from all of the above |
| `assets/` | styles, the Fredoka font (and its licence), icons, the link-preview picture, screenshots |
| `creatures/` | the demo clique as SVGs, drawn by the app's own avatar code |
| `tools/` | `creatures.mjs` redraws the creatures, `icons.mjs` the icons and `og.png` |

## See it on your computer

```sh
node site/build.mjs
python3 -m http.server -d site/_site 8000    # then open http://localhost:8000
```

Locally the Mac and Windows buttons point at the public repo's releases page; the deployed site points them at the
files themselves.

## One-time setup

Do these in order. Steps 4 and 5 can come later; until then the apps are built unsigned and the run says so.

1. **Create the public repo.** On GitHub, under the account or organization that will own the product: New repository,
   a name (the site will be at `https://<owner>.github.io/<name>/`), **Public**, and tick **Add a README file** (a
   release needs one commit to tag). Nothing else goes in it by hand.

2. **Make a token for it.** GitHub › Settings › Developer settings › Personal access tokens › Fine-grained tokens ›
   Generate new token. Resource owner: the public repo's owner. Repository access: **Only select repositories** › the
   public repo. Permissions › Repository permissions › **Contents: Read and write** (Metadata: Read comes with it).
   Pick an expiry and put a reminder in your calendar to renew it. (An organization may have to approve the token
   under its Settings › Personal access tokens.)

3. **Tell this repo about it.** In this repo: Settings › Secrets and variables › Actions.
   - Variables tab › New repository variable: `RELEASE_REPO` = `<owner>/<name>` of the public repo.
     Optional: `SITE_DOMAIN` = a custom domain such as `clique.example.com` (step 7), or `SITE_URL` = the site's full
     address with a trailing slash, if it isn't `https://<owner>.github.io/<name>/`.
   - Secrets tab › New repository secret: `RELEASE_TOKEN` = the token from step 2.

4. **Sign and notarize the Mac app** (needs the Apple Developer account, as the Account Holder):
   1. Make a **Developer ID Application** certificate: Xcode › Settings › Accounts › your team › Manage Certificates ›
      + › Developer ID Application (or developer.apple.com › Certificates). In Keychain Access, find it under My
      Certificates, right-click › Export as a `.p12` with a password.
   2. Secret `MAC_CERTIFICATE` = the `.p12` as base64: `base64 -i Certificates.p12 | pbcopy`, then paste.
      Secret `MAC_CERTIFICATE_PASSWORD` = its password.
   3. Make an **App Store Connect API key**: App Store Connect › Users and Access › Integrations › App Store Connect
      API › Team Keys › + (access: Developer). Download the `AuthKey_XXXXXXXXXX.p8` (it can be downloaded only once).
   4. Secret `APPLE_API_KEY_P8` = the whole text of the `.p8` file, `BEGIN` and `END` lines included.
      Secret `APPLE_API_KEY_ID` = the key's Key ID. Secret `APPLE_API_ISSUER` = the Issuer ID shown above the keys.
   5. Try it without a release: Actions › Release › Run workflow › branch `main`, untick the site. The run's summary
      should say "signed with the Developer ID certificate and notarized", with no Mac warnings.

5. **Sign the Windows installers** (optional). Unsigned, they install and run fine, but Windows warns first: Edge may
   say the file "isn't commonly downloaded", and SmartScreen shows **"Windows protected your PC"** with *Publisher:
   Unknown publisher* until people choose **More info › Run anyway** (the support page tells them so). Signing puts
   the company's name there; SmartScreen can still warn for a while, until the downloads build a reputation. Either:
   - an Authenticode certificate: secret `WIN_CERTIFICATE` = the `.pfx` as base64, `WIN_CERTIFICATE_PASSWORD`; or
   - Azure Trusted Signing: secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and variables
     `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`.

6. **Fill in `config.mjs`**: `CONTACT_EMAIL` (the App Store and Google Play require a contact; the build warns while
   it's the placeholder) and, if the name changed, `PRODUCT` (see *Renaming*). Commit and push to `main`.

7. **Put the site up.** Actions › Release › Run workflow › branch `main`, untick the apps. This makes the public repo's
   `gh-pages` branch. Then in the **public** repo: Settings › Pages › Build and deployment › Source: **Deploy from a
   branch**, Branch: **gh-pages**, folder **/ (root)**, Save. A minute later the site is at the address in the run's
   summary. For a custom domain: point a `CNAME` DNS record at `<owner>.github.io`, set `SITE_DOMAIN` (step 3), run
   the site again, enter the domain under Pages › Custom domain and tick Enforce HTTPS.

8. **Release.** With `desktop/package.json` at the version (`1.0.0`), tag and push:
   `git tag v1.0.0 && git push origin v1.0.0`. The workflow builds every app, puts them in a **draft** release on the
   public repo, and redeploys the site. Open the public repo's Releases, download and try the apps, then **Publish**
   the draft.

9. **Point the downloads at it.** Actions › Release › Run workflow › untick the apps. The site's buttons always go to
   the newest *published* release, so until a release is published they keep pointing at the one before it (or say
   "Coming soon" before the first).

## Every release after that

1. Bump `version` in `desktop/package.json`, commit, tag `v<version>` and push the tag (the run stops if they differ).
2. Check the draft on the public repo and publish it.
3. Run Release by hand with only the site. The Mac and Windows links follow the release by themselves: nothing to
   edit.

Only the store links are typed in by hand, in `DOWNLOADS` in `config.mjs`: when the iPhone or Android app is approved,
set its `href` to the App Store or Google Play address (instead of `null`, which shows "Coming soon"), commit, and run
the site. Any button can go back to "Coming soon" the same way.

## For the App Store and Google Play

- Privacy policy URL: `<site>/privacy.html`. Support URL: `<site>/support.html`. Marketing URL: the site itself.
- `privacy.md` is the same policy as plain text, if a form asks for the text.
- The policy says CLIque collects no data; the stores' privacy questions should be answered the same way, checked
  against the app being submitted.

## Pictures to replace with real screenshots

Until the app looks like the approved design, the screenshots are the design's renders with the demo clique. Replace
each file with a real screenshot of the same thing (demo clique and the Storefront workspace only, nothing personal),
at the same size, as WebP (`cwebp -q 82`). If a size changes, change the `width` and `height` in `src/index.html`.

| File in `assets/shots/` | Shows | Size |
|---|---|---|
| `clique-light.webp`, `clique-dark.webp` (+ `-800` halves) | the Mac app, CLIque tab: the room, the cards, the chat | 1600 × 978 (a 1440 × 880 window) |
| `needs-you-light.webp`, `needs-you-dark.webp` | the Needs you panel: Milo's "Can I run npm run build?", Iris's question | 782 × 822 |
| `computers-light.webp`, `computers-dark.webp` (+ `-800`) | the Mac (Studio) and the PC (Workstation) showing the same clique | 1600 × 1067 |
| `phone-clique-light.webp`, `phone-clique-dark.webp` | the phone app's CLIque tab | 600 × 1301 |
| `phone-ask-light.webp`, `phone-ask-dark.webp` | the phone app's Needs you tab | 600 × 1301 |

Also drawn from the design for now:
- `creatures/*.svg`: from the design's avatar code with poses. Once `desktop/ui/avatar.js` has the poses, redraw them
  from the app: `desktop/node_modules/.bin/electron site/tools/creatures.mjs` (it reads the app's avatar code and
  `desktop/ui/common.css` by default).
- `assets/favicon.ico`, `icon-192.png`, `apple-touch-icon.png`, `og.png`: from the app icon's full-bleed square (no
  corners: the browser and iOS cut their own). Draw the square, then the site's pictures from it:
  `(cd desktop && npx electron scripts/make-icon.mjs --bleed /tmp/icon-bleed.png)`, then
  `desktop/node_modules/.bin/electron site/tools/icons.mjs --icon /tmp/icon-bleed.png`.

## Renaming

Change `PRODUCT` in `config.mjs`: every page, title, the wordmark (drawn letter by letter in Fredoka, as written, in
the creatures' colours) and `privacy.html` follow. Then redraw `og.png` (it shows the wordmark) with `tools/icons.mjs`.
`privacy.md` itself says "CLIque" for anyone pasting it into a store form: replace the word there too, and in the
`replace` that `build.mjs` gives it. The headline's "working as a clique" is the ordinary word and stays. (`og.png` still
shows the wordmark from before the rename to CLIque until it's redrawn.)
