// Metro, plus shared/ next to this app: the protocol code both the Mac and the phone speak (PROTOCOL.md). It's
// imported by relative path (src/net/shared.ts), so Metro has to watch the folder, and what Babel adds to its files
// (runtime helpers) resolves from this app's node_modules.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../shared')]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]

module.exports = config
