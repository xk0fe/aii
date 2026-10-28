// The contract with the Mac, straight from shared/ next to this app (Metro watches it, see metro.config.js). Never
// copied: protocol.js and sync.js are what both sides speak. A relative path, so Metro, Jest, tsc and tsx (from any
// folder) all find it without an alias.
export {
  b64,
  unb64,
  utf8,
  unutf8,
  concat,
  nonce,
  keyInfo,
  pack,
  unpack,
  readPairCode,
  makePairCode,
  VERSION,
  PORT,
  PAIR_PREFIX,
  PAIR_TTL,
  SALT,
  CLOSE,
  CALLS,
  LISTS,
} from '../../../shared/protocol.js'
export { apply, diff } from '../../../shared/sync.js'
