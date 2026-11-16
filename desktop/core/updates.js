// CLIque updating itself: when it looks for a newer version, what it does with one, and what it says about it. Nothing
// in here touches Electron: the thing that really looks, downloads and installs is handed in (`updater`; main.js
// gives electron-updater through electronUpdater below, the tests a fake), as are the clock and the timers.
//
//   off ── (never checks: says why when asked)
//   idle ─▶ checking ─▶ downloading ─▶ ready ─▶ restarting
//     ▲        │             │           │
//     └────────┴─ failed ────┘           └─ "Later": the note goes for this session, Restart to update stays in the menus
//
// It looks a little after CLIque starts, then every six hours, and when the computer wakes if a look was due. A look
// that fails is tried again in 15 minutes, then 30, an hour… up to the six hours, and never says a word unless you
// asked ("Check for Updates…").
const HOUR = 3600e3
export const INTERVAL = 6 * HOUR
export const RETRY = 15 * 60e3
export const START_DELAY = 20e3

export class Updates {
  phase = 'idle'
  next = null // the version that's downloading or ready: { version, notesUrl, hostProtocol }
  later = false // "Later": no note for this version any more
  asking = null // the question before restarting while agents work (restartWords), shown in the note
  stuck = false // a restart that didn't happen
  failures = 0
  due = 0 // when the next look is
  progress = 0
  running = null
  timer = null

  // off: why this CLIque can't update itself (offReason), or null. seen: the version whose note you already put away
  // (saveSeen keeps it). busy: () => who's at work on this computer, for the question before a restart.
  constructor({ updater, version, off = null, seen = '', saveSeen = () => {}, onChange = () => {}, log = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, interval = INTERVAL, retry = RETRY, delay = START_DELAY }) {
    Object.assign(this, { updater, version, off, seen, saveSeen, onChange, log, now, setTimer, clearTimer, interval, retry, delay })
    if (off) this.phase = 'off'
  }

  start() {
    if (!this.off) this.schedule(this.delay)
    return this
  }

  stop() {
    this.stopped = true
    this.clearTimer(this.timer)
  }

  schedule(ms) {
    if (this.stopped || this.off) return
    this.clearTimer(this.timer)
    this.due = this.now() + ms
    this.timer = this.setTimer(() => this.check().catch(() => {}), ms)
    this.timer?.unref?.()
  }

  // The computer woke up: timers stood still while it slept, so a look that was due happens now, and one that wasn't
  // is set again for when it is.
  wake() {
    if (this.off || this.stopped || this.running || this.phase === 'restarting') return
    const left = this.due - this.now()
    if (left <= 0) this.check().catch(() => {})
    else this.schedule(left)
  }

  set(change) {
    Object.assign(this, change)
    this.onChange(this.view())
  }

  // Looks for a newer version and downloads it. Resolves with how it ended: { result: 'current' | 'ready' | 'failed' |
  // 'off' | 'restarting', version? }. manual ("Check for Updates…"): resolves as soon as it's known whether there is
  // one, 'downloading' if so, rather than minutes later when it's here.
  check({ manual = false } = {}) {
    if (this.off) return Promise.resolve({ result: 'off', reason: this.off })
    if (this.phase === 'restarting') return Promise.resolve({ result: 'restarting', version: this.next?.version })
    if (manual && this.phase === 'downloading') return Promise.resolve({ result: 'downloading', version: this.next.version })
    if (!this.running) {
      let decide
      this.decided = new Promise((r) => (decide = r))
      this.running = this.look(decide).then((out) => {
        this.running = null
        decide(out) // (a look that ended before it had anything to say)
        this.schedule(this.failures ? Math.min(this.interval, this.retry * 2 ** (this.failures - 1)) : this.interval)
        return out
      })
    }
    return manual ? this.decided : this.running
  }

  async look(decide) {
    const ready = this.phase === 'ready' ? this.next : null // one that's ready stays ready while CLIque looks again
    try {
      if (!ready) this.set({ phase: 'checking' })
      const found = await this.updater.check()
      this.failures = 0
      this.checkedAt = this.now()
      if (!found || found.version === ready?.version) {
        if (!ready) this.set({ phase: 'idle' })
        return ready ? { result: 'ready', version: ready.version } : { result: 'current' }
      }
      // a newer one (than the one that was ready, too): that one replaces it
      this.set({ phase: 'downloading', next: found, progress: 0, asking: null, stuck: false })
      decide({ result: 'downloading', version: found.version })
      await this.updater.download(found, (pct) => {
        const tenth = Math.min(100, Math.floor(pct / 10) * 10) // in tenths: the app isn't redrawn for every chunk
        if (tenth !== this.progress) this.set({ progress: tenth })
      }, (e) => this.lost(found, e))
      this.set({ phase: 'ready', next: found, progress: 100, later: this.seen === found.version })
      return { result: 'ready', version: found.version }
    } catch (e) {
      this.failures++
      this.log(`update: ${e?.message ?? e}`)
      // the download of a newer one failed: the one before may be half replaced, so nothing counts as ready
      const lost = this.phase === 'downloading'
      this.set(lost || !ready ? { phase: 'idle', next: null, asking: null } : { phase: 'ready' })
      return { result: 'failed' }
    }
  }

  // What was downloaded turned out to be no good after all (on a Mac, macOS's own installer checks it once more
  // and may refuse it): it isn't ready any more, quietly, and the next look comes as after any failure.
  lost(found, e) {
    if (this.next?.version !== found.version || !['ready', 'restarting'].includes(this.phase)) return
    this.failures++
    this.log(`update: ${found.version} can't be installed: ${e?.message ?? e}`)
    this.set({ phase: 'idle', next: null, asking: null, stuck: false })
    if (!this.running) this.schedule(Math.min(this.interval, this.retry * 2 ** (this.failures - 1)))
  }

  // "Later": the note goes and doesn't come back for this version; the menus keep Restart to update.
  putOff() {
    if (!this.next) return
    this.seen = this.next.version
    this.saveSeen(this.seen)
    this.set({ later: true, asking: null, stuck: false })
  }

  // "Restart to update" from a menu while agents work: the note comes back with the question in it.
  ask(words) {
    this.set({ asking: words, stuck: false })
  }

  // Quits into the new version. A restart that doesn't happen (install throws, or comes back) leaves it ready again.
  async restart() {
    if (this.phase !== 'ready') return false
    this.set({ phase: 'restarting', asking: null, stuck: false })
    try {
      await this.updater.install()
      return true
    } catch (e) {
      this.log(`update: couldn't restart: ${e?.message ?? e}`)
      this.set({ phase: 'ready', stuck: true, later: false })
      return false
    }
  }

  // What the pages and the menus draw from.
  view() {
    return {
      phase: this.phase,
      version: this.version,
      off: this.off,
      next: this.next && { version: this.next.version, notesUrl: this.next.notesUrl ?? null },
      progress: this.progress,
      later: this.later,
      asking: this.asking,
      stuck: this.stuck,
    }
  }
}

// ---- what it says ------------------------------------------------------------------------------------------------

const list = (names) => (names.length <= 3 ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`)

// Before restarting into an update while agents are at work, the truth about what happens to them. null: nobody's at
// work, nothing to ask.
//   outlives: their terminals run in the terminal host, outside CLIque (core/ptyhost.js), which a restart leaves alone
//   hostProtocol: the terminal host's protocol in the version that's ready (the feed says: electron-builder.config.mjs
//     releaseInfo). The same as this CLIque's, the new CLIque picks the running host up, agents and all. Another, it
//     has to replace the host (core/ptyclient.js connect), which ends every terminal. Not said: it can't be promised.
//   protocol: this CLIque's (PROTOCOL in core/ptyhost.js)
// -> { text, go, wait, safe: 'go' | 'wait' }: `safe` is the button that's the default.
export function restartWords({ busy = [], outlives = true, hostProtocol, protocol, product = 'CLIque' }) {
  if (!busy.length) return null
  const who = list(busy)
  const many = busy.length > 1
  if (outlives && hostProtocol === protocol) return { text: `${who} ${many ? 'keep' : 'keeps'} working while ${product} restarts.`, go: 'Restart', wait: 'Not now', safe: 'go' }
  const after = `${many ? 'They pick' : 'It picks'} up the conversation after the restart, but what ${many ? 'they were' : 'it was'} doing right now is lost.`
  const risky = (text) => ({ text: `${text} ${after}`, go: 'Restart anyway', wait: 'Not now', safe: 'wait' })
  if (!outlives) return risky(`${who} will be stopped: this time ${product} runs ${many ? 'their terminals' : 'its terminal'} itself.`)
  if (hostProtocol == null) return risky(`${product} can't tell whether ${who} can keep working through this update, so ${many ? 'they' : 'it'} may be stopped.`)
  return risky(`${who} will be stopped: this update replaces the part of ${product} that runs ${many ? 'their terminals' : 'its terminal'}.`)
}

// The update row of a Mac's app menu, under About: { label, act: 'check' | 'restart' }. Never greyed out: asked while
// it can't check or is already restarting, Check for Updates… says so (checkWords).
export const menuItem = (phase) => (phase === 'ready' ? { label: 'Restart to Update', act: 'restart' } : { label: 'Check for Updates…', act: 'check' })

// The answer to "Check for Updates…": { message, detail, buttons? } for a plain dialog.
export function checkWords(out, { product = 'CLIque', version = '', mac = true } = {}) {
  const newer = `${product} ${out.version ?? ''}`.trim()
  switch (out.result) {
    case 'current':
      return { message: "You're up to date", detail: `${product} ${version} is the newest version.` }
    case 'downloading':
      return { message: `${newer} is downloading`, detail: `${product} tells you when it's ready. You can keep working.` }
    case 'ready':
      return { message: `${newer} is ready`, detail: `Restart ${product} to use it.`, buttons: ['Restart to Update', 'Later'] }
    case 'restarting':
      return { message: `${product} is restarting`, detail: `${newer} opens in a moment.` }
    case 'off':
      return OFF[out.reason]?.({ product, mac }) ?? OFF.feed({ product })
    default:
      return { message: "Couldn't check", detail: `You can keep using ${product} and try again later.` }
  }
}

// Why a copy of CLIque can't update itself, in words.
const OFF = {
  dev: ({ product }) => ({ message: `This ${product} runs from source`, detail: `It doesn't update itself: pull the newest code instead.` }),
  feed: ({ product }) => ({ message: `This ${product} can't update itself`, detail: `It wasn't told where updates come from. To update, download the newest ${product} and install it over this one.` }),
  location: ({ product }) => ({ message: `Move ${product} to Applications to get updates`, detail: `${product} can only update itself from the Applications folder. Quit ${product}, drag it into Applications, and open it from there.` }),
  unsigned: ({ product }) => ({ message: `This ${product} can't update itself`, detail: `It isn't signed by its maker, and macOS only lets a signed app replace itself. To update, download the newest ${product} and put it in Applications in place of this one.` }),
  platform: ({ product }) => ({ message: `This ${product} can't update itself`, detail: `To update, download the newest ${product} and install it over this one.` }),
}

// ---- can this copy update itself? ---------------------------------------------------------------------------------

// -> null (it can) or why not: 'dev' (running from source), 'platform', 'feed' (nowhere to look), and on a Mac
// 'location' (not in Applications: on a disk image, or run from Downloads, where macOS runs it from a read-only copy)
// or 'unsigned' (ad hoc: Squirrel.Mac refuses to swap in an app it can't check against this one's signature).
export function offReason({ packaged, platform, feed, exe = '', inApplications = true, signature = 'developer-id' }) {
  if (!packaged) return 'dev'
  if (platform !== 'darwin' && platform !== 'win32') return 'platform'
  if (!feed) return 'feed'
  if (platform === 'darwin') {
    if (!inApplications || exe.startsWith('/Volumes/') || exe.includes('/AppTranslocation/')) return 'location'
    if (signature === 'adhoc' || signature === 'none') return 'unsigned'
  }
  return null
}

// What `codesign -dv --verbose=2 CLIque.app` printed -> 'developer-id' | 'signed' (another real identity) | 'adhoc' | 'none'.
export function macSignature(text = '') {
  if (/^Authority=Developer ID Application/m.test(text)) return 'developer-id'
  if (/^Signature=adhoc/m.test(text) || /flags=[^\n]*\badhoc\b/.test(text)) return 'adhoc'
  if (/^TeamIdentifier=(?!not set)\S+/m.test(text)) return 'signed'
  return 'none'
}

// Where updates come from. One address can be set by hand: CLIQUE_UPDATE_FEED, or "updateFeed" in config.json (a
// folder on the web holding latest.yml / latest-mac.yml and the files they name). Otherwise the one the build was
// given (app-update.yml in the app's resources, which electron-builder writes when RELEASE_REPO or UPDATE_FEED is set
// for the build). Neither: null, and CLIque never looks.
// -> { url } | { baked: true, repo?: 'owner/name' } | null
export function feedFrom({ env = {}, config = {}, baked = null }) {
  const url = feedUrl(env.CLIQUE_UPDATE_FEED) ?? feedUrl(config.updateFeed)
  if (url) return { url }
  if (baked == null) return null
  const field = (name) => new RegExp(`^${name}:\\s*['"]?([^'"\\n]+?)['"]?\\s*$`, 'm').exec(baked)?.[1]
  const repo = field('provider') === 'github' && field('owner') && field('repo') ? `${field('owner')}/${field('repo')}` : undefined
  return { baked: true, ...(repo && { repo }) }
}

// An address set by hand, as the file electron-updater reads (it wants one before it downloads): the build's own
// app-update.yml with where to look swapped for the address, so what else the build said stays: on Windows the
// publisher whose signature an update must carry (publisherName), and where downloads are kept.
export function feedConfig(url, baked = null) {
  const where = /^(provider|owner|repo|url|host|releaseType|vPrefixedTagName|private|protocol|channel|token):/
  const kept = String(baked ?? '').split(/\r?\n/).filter((line) => line.trim() && !where.test(line))
  if (!kept.some((line) => line.startsWith('updaterCacheDirName:'))) kept.push('updaterCacheDirName: clique-updater')
  return [`provider: generic`, `url: ${JSON.stringify(url)}`, ...kept, ''].join('\n')
}

// https only, or this computer itself (trying a feed out).
export function feedUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) return null
  return url.href.replace(/\/?$/, '/')
}

// a.b.c against a.b.c: is `a` newer? (A version with a -tail counts as older than the same one without.)
export function newer(a, b) {
  const parts = (v) => String(v).replace(/^v/, '').split('-')
  const [x, xt] = parts(a)
  const [y, yt] = parts(b)
  const [p, q] = [x.split('.').map(Number), y.split('.').map(Number)]
  for (let i = 0; i < 3; i++) if ((p[i] || 0) !== (q[i] || 0)) return (p[i] || 0) > (q[i] || 0)
  return Boolean(yt) && !xt
}

// ---- electron-updater, as the `updater` Updates wants ---------------------------------------------------------------

const within = (promise, ms, what) => {
  let t
  return Promise.race([promise, new Promise((_r, reject) => (t = setTimeout(() => reject(new Error(`${what} took too long`)), ms)))]).finally(() => clearTimeout(t))
}

// autoUpdater: electron-updater's (an EventEmitter with checkForUpdates, downloadUpdate, quitAndInstall). feed: from
// feedFrom. The release notes' address: the feed's own releaseNotesUrl, else the release's page on GitHub.
// configPath: for an address set by hand, a file saying the same (provider, url, updaterCacheDirName), which
// electron-updater reads before it downloads anything; the build's own app-update.yml otherwise.
export function electronUpdater(autoUpdater, { feed, version, configPath, log = () => {}, checkTimeout = 60e3, downloadTimeout = 30 * 60e3, quitTimeout = 120e3 } = {}) {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true // quitting the ordinary way installs what's downloaded too
  autoUpdater.allowDowngrade = false
  autoUpdater.logger = { info: () => {}, debug: () => {}, warn: (m) => log(`update: ${m}`), error: (m) => log(`update: ${m?.message ?? m}`) }
  // A failure comes back from the call that caused it, and as an 'error' event too. One that comes with no call under
  // way is macOS's own installer (Squirrel) refusing what was downloaded, after the download counted as done.
  let calls = 0
  let lost = null
  autoUpdater.on('error', (e) => !calls && lost?.(e))
  const during = async (work) => {
    calls++
    try {
      return await work()
    } finally {
      calls--
    }
  }
  if (feed?.url) {
    if (configPath) autoUpdater.updateConfigPath = configPath
    autoUpdater.setFeedURL({ provider: 'generic', url: feed.url })
  }
  return {
    check: () => during(async () => {
      const res = await within(autoUpdater.checkForUpdates(), checkTimeout, 'looking for an update')
      const info = res?.updateInfo
      if (!info?.version || !(res.isUpdateAvailable ?? newer(info.version, version))) return null
      const url = feedUrl(info.releaseNotesUrl) && /^https:/.test(info.releaseNotesUrl) ? info.releaseNotesUrl : feed?.repo ? `https://github.com/${feed.repo}/releases/tag/v${encodeURIComponent(info.version)}` : null
      const protocol = Number(info.hostProtocol)
      return { version: String(info.version), notesUrl: url, hostProtocol: Number.isInteger(protocol) && protocol > 0 ? protocol : null }
    }),
    // Done once the files are here and checked against the feed's checksum. On a Mac electron-updater then hands them
    // to macOS's own installer, which unpacks them and checks the app's signature against this one's; if it refuses
    // them, that comes through onLost, after the download counted as done.
    download: (_found, onProgress = () => {}, onLost = () => {}) => during(() => {
      const progress = (p) => onProgress(p?.percent ?? 0)
      autoUpdater.on('download-progress', progress)
      let done = false
      lost = (e) => ((lost = null), onLost(e))
      const here = new Promise((resolve, reject) => {
        const arrived = () => resolve((done = true))
        autoUpdater.once('update-downloaded', arrived)
        Promise.resolve().then(() => autoUpdater.downloadUpdate()).then(arrived, (e) => {
          autoUpdater.removeListener('update-downloaded', arrived)
          done ? lost?.(e) : reject(e)
        })
      })
      return within(here, downloadTimeout, 'the download').finally(() => autoUpdater.removeListener('download-progress', progress))
    }),
    // Quits and opens the new version. It only comes back if that didn't happen.
    install() {
      autoUpdater.quitAndInstall(true, true)
      return new Promise((_r, reject) => setTimeout(() => reject(new Error('still running after asking to quit and install')), quitTimeout).unref?.())
    },
  }
}
