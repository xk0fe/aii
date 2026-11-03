// Everything about the website that changes: the product's name, who makes it, the contact address and where every
// download goes. build.mjs reads this file; nothing else in site/ spells these out.

// The name people see. A rename is this line (the wordmark is drawn from it, letter by letter, capitals and all).
export const PRODUCT = 'CLIque'

export const COMPANY = 'Green Grass Inc.'

// Where people write for help and about privacy. Replace before the site goes live: the stores ask for it.
export const CONTACT_EMAIL = 'CONTACT_EMAIL'

// The site's public address, with a trailing slash (https://<owner>.github.io/<repo>/, or a custom domain). Link
// previews need it to find the preview picture. The release workflow fills it in from the SITE_URL variable.
export const SITE_URL = process.env.SITE_URL || ''

// A custom domain for GitHub Pages (clique.example.com), written to CNAME. Empty for <owner>.github.io/<repo>/.
export const DOMAIN = process.env.SITE_DOMAIN || ''

// Every download button. `href` is one of:
//   null                      the button shows "Coming soon"
//   'https://…'               a fixed link (the App Store and Google Play, once the apps are approved)
//   { release: /pattern/ }    the file whose name matches, in the newest published release on the public repo.
//                             The release workflow looks the release up when it deploys the site, so these links follow
//                             every release by themselves; a draft release never shows here.
export const DOWNLOADS = {
  mac: {
    title: 'Mac',
    icon: 'laptop',
    note: 'Apple menu › About This Mac says which chip you have.',
    files: [
      { id: 'mac-arm64', label: 'Apple silicon', detail: 'M1 and newer', href: { release: /-mac-arm64\.dmg$/ } },
      { id: 'mac-x64', label: 'Intel', detail: 'Older Macs', href: { release: /-mac-x64\.dmg$/ } },
    ],
  },
  windows: {
    title: 'Windows',
    icon: 'monitor',
    note: 'Not sure? Pick x64. Arm is for PCs with a Snapdragon chip.',
    files: [
      { id: 'win-x64', label: 'x64', detail: 'Most PCs', href: { release: /-Setup-.*-x64\.exe$/ } },
      { id: 'win-arm64', label: 'Arm', detail: 'Snapdragon PCs', href: { release: /-Setup-.*-arm64\.exe$/ } },
    ],
  },
  iphone: {
    title: 'iPhone',
    icon: 'smartphone',
    note: `Works with ${PRODUCT} on your Mac or PC.`,
    files: [{ id: 'app-store', label: 'App Store', href: null }],
  },
  android: {
    title: 'Android',
    icon: 'smartphone',
    note: `Works with ${PRODUCT} on your Mac or PC.`,
    files: [{ id: 'google-play', label: 'Google Play', href: null }],
  },
}
