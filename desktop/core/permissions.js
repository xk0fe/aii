// What CLIque needs macOS to allow, whether it does, and how to ask: the permissions flow (ui/permissions.js) comes up on
// first launch and whenever something's missing. Each is only for what it says; none of them is needed to run an agent,
// so "not now" is an answer, remembered in config.json (permissions) so it doesn't ask again each launch. One you'd
// allowed and later turned off counts as missing again.
//
// A state: 'granted', 'ask' (macOS hasn't asked yet), 'off' (it's a switch or a list in System Settings now), or 'unknown'
// (can't be told, or can't be changed here: left alone).
//
// Reading has no side effects, which takes some care:
// - Local Network says nothing until something tries the network, and the first try is what makes macOS put up its
//   question. So it isn't probed until you've pressed Allow, or it's been granted before.
// - Notifications: Electron can't say, but System Settings' own preferences can. An app that's never asked isn't listed.
// - Full Disk Access: nothing asks, the app has to be dragged into the list. Reading a folder only it opens tells.
// No Electron in here: main.js hands over the pieces it needs.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probeLocalNetwork } from './discover.js'

export const PERMISSIONS = ['notifications', 'microphone', 'localNetwork', 'fullDisk']

const PRIVACY = 'x-apple.systempreferences:com.apple.preference.security?Privacy_'
const ALLOWED_BIT = 1 << 25 // in a listed app's flags: Allow notifications is on

const defaults = (cb) => execFile('defaults', ['export', 'com.apple.ncprefs', '-'], { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (e, out) => cb(e ? null : String(out)))
const readPrefs = () => new Promise((resolve) => defaults(resolve))

// From System Settings' notification preferences (XML): 'granted', 'off', 'ask' (not listed yet), or 'unknown'.
export function notificationState(xml, bundleId) {
  if (!xml) return 'unknown'
  const app = xml.split('<dict>').find((d) => d.includes(`<string>${bundleId}</string>`))
  if (!app) return 'ask'
  const flags = Number(app.match(/<key>flags<\/key>\s*<integer>(-?\d+)<\/integer>/)?.[1])
  if (!Number.isFinite(flags)) return 'unknown'
  return flags & ALLOWED_BIT ? 'granted' : 'off'
}

// Folders macOS keeps from anything without Full Disk Access, whichever of them this Mac has.
function fullDiskState({ home, files }) {
  for (const probe of [() => files.readdirSync(path.join(home, 'Library', 'Safari')), () => files.closeSync(files.openSync(path.join(home, 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db'), 'r'))]) {
    try {
      probe()
      return 'granted'
    } catch (e) {
      if (e.code === 'EPERM' || e.code === 'EACCES') return 'off'
    }
  }
  return 'unknown'
}

export class Permissions {
  // answers(): the object your answers live in, by permission: 'granted', 'asked' or 'skipped' (config.json's, asked for
  // each time since saving reads the file back into a new one). save(): keep them. notify(): show a notification, which
  // is how macOS comes to ask. Everything else can be handed in for tests.
  constructor({ systemPreferences, openUrl, notify, bundleId, answers, save = () => {}, prefs = readPrefs, network = probeLocalNetwork, home = os.homedir(), files = fs }) {
    Object.assign(this, { systemPreferences, openUrl, notify, bundleId, answers, save, prefs, network, home, files })
  }

  remember(id, answer) {
    if (this.answers()[id] === answer) return
    this.answers()[id] = answer
    this.save()
  }

  async read(id) {
    if (id === 'microphone') {
      // 'restricted': a profile on this Mac decides, and no switch of yours changes that
      return { granted: 'granted', 'not-determined': 'ask', denied: 'off' }[this.systemPreferences.getMediaAccessStatus('microphone')] ?? 'unknown'
    }
    if (id === 'notifications') {
      const state = notificationState(await this.prefs(), this.bundleId)
      // asked and still not listed: macOS isn't going to list this build (one it won't trust, say), so there's no switch
      // to send you to, and nothing more to ask
      return state === 'ask' && this.answers()[id] === 'asked' ? 'unknown' : state
    }
    if (id === 'localNetwork') {
      if (!['asked', 'granted'].includes(this.answers()[id])) return 'ask'
      return { granted: 'granted', blocked: 'off' }[await this.network()] ?? 'unknown'
    }
    if (id === 'fullDisk') return fullDiskState(this)
    return 'unknown'
  }

  // The one state the flow polls. One that's come through is remembered, so turning it off later counts as missing.
  async look(id) {
    const state = await this.read(id)
    if (state === 'granted') this.remember(id, 'granted')
    return state
  }

  // What's missing, in the order to ask. all: from the ⋯ menu, what you said not now to as well.
  async missing({ all = false } = {}) {
    const out = []
    for (const id of PERMISSIONS) {
      const state = await this.look(id)
      if (state === 'granted' || state === 'unknown') continue
      if (this.answers()[id] === 'skipped' && !all) continue
      out.push({ id, state })
    }
    return out
  }

  // Allow. -> the state now (the question may still be up: the flow keeps looking).
  async ask(id) {
    if (id === 'microphone') {
      await this.systemPreferences.askForMediaAccess('microphone')
    } else if (id === 'notifications') {
      this.remember(id, 'asked')
      this.notify()
    } else if (id === 'localNetwork') {
      this.remember(id, 'asked')
      void this.network() // puts up macOS's question; its answer is looked for by the flow, not waited for here
    }
    return this.look(id)
  }

  // Where it's switched on.
  open(id) {
    const urls = {
      notifications: `x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${this.bundleId}`,
      microphone: `${PRIVACY}Microphone`,
      localNetwork: `${PRIVACY}LocalNetwork`,
      fullDisk: `${PRIVACY}AllFiles`,
    }
    if (urls[id]) return this.openUrl(urls[id])
  }

  skip(id) {
    this.remember(id, 'skipped')
  }
}

// The .app folder this is running from, which is what goes in Full Disk Access; null when it isn't in one.
export const appBundle = (exe) => exe.match(/^(.*?\.app)\//)?.[1] ?? null

// What Info.plist says this app is: the id macOS keeps its answers under (a dev build's differs from a release's).
export function bundleIdIn(infoPlist, fallback) {
  return infoPlist?.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? fallback
}
