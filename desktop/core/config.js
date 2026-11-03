// config.json, read and written in one place. Every workspace's hub (core/workspaces.js) sees the same file and writes
// through here, so a change one makes is never lost to another's older copy. Edits made by hand apply live (watch).
// No Electron in here.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'

export class Config extends EventEmitter {
  tried = false // read yet (or tried: a broken file is said once)
  discovered = {} // what the CLIs on this computer say about themselves (Codex's models), for providersFrom

  constructor(file, defaults) {
    super()
    this.setMaxListeners(0) // a hub per workspace listens
    this.file = file
    this.defaults = defaults
    this.data = { ...defaults } // until it's read, or when it can't be
  }

  // 'change' once it's read; 'problem' (and the last good one kept) when it can't be. A missing file is written.
  load() {
    this.tried = true
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch (e) {
      if (e.code !== 'ENOENT') return void this.emit('problem', `CLIque couldn't read its settings (${this.file}: ${e.message}), so it carries on with the ones it had`)
      raw = {}
      fs.writeFileSync(this.file, JSON.stringify(this.defaults, null, 2) + '\n')
    }
    this.data = { ...this.defaults, ...raw }
    this.emit('change')
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n')
    this.load()
  }

  watch() {
    if (this.watching) return
    this.watching = true
    fs.watchFile(this.file, { interval: 1000 }, () => this.load())
  }
}
