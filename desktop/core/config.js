// config.json, read and written in one place. Every workspace's hub (core/workspaces.js) sees the same file and writes
// through here, so a change one makes is never lost to another's older copy. Edits made by hand apply live (watch).
// No Electron in here.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'

export const BROKEN = "CLIque can't read its settings (config.json) right now, so it changes nothing until it can"

export class Config extends EventEmitter {
  tried = false // read yet (or tried: a broken file is said once)
  discovered = {} // what the CLIs on this computer say about themselves (Codex's models), for providersFrom

  // settle(data): brings what was read to today's layout, each time it's read (saving is what writes it).
  constructor(file, defaults, { settle } = {}) {
    super()
    this.setMaxListeners(0) // a hub per workspace listens
    this.file = file
    this.defaults = defaults
    this.settle = settle
    this.data = { ...defaults } // until it's read, or when it can't be
  }

  // 'change' once it's read; 'problem' (and the last good one kept) when it can't be. A missing file is written.
  load() {
    this.tried = true
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch (e) {
      // broken: what's in memory isn't what's on disk, so nothing should save over the file until it reads again
      if (e.code !== 'ENOENT') return void ((this.broken = true), this.emit('problem', `CLIque couldn't read its settings (${this.file}: ${e.message}), so it carries on with the ones it had`))
      raw = {}
      fs.writeFileSync(this.file, JSON.stringify(this.defaults, null, 2) + '\n')
    }
    this.data = { ...this.defaults, ...raw }
    this.settle?.(this.data)
    this.broken = false
    this.emit('change')
  }

  // Never over a file that can't be read, whoever asks: what's in memory isn't what's on disk, and the file can still be
  // fixed. It's looked at now as well, since it may have gone bad (or been fixed) since the last time it was read.
  save() {
    let readable = true
    try {
      JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch (e) {
      readable = e.code === 'ENOENT'
    }
    const broken = Boolean(this.broken)
    if (broken || !readable) {
      if (broken === readable) this.load() // changed since the last read: says so if it's broken, picks it up if it's fixed
      throw new Error(BROKEN)
    }
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n')
    this.load()
  }

  watch() {
    if (this.watching) return
    this.watching = true
    fs.watchFile(this.file, { interval: 1000 }, () => this.load())
  }
}
