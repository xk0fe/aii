// Reactions: one emoji on a message in place of a written acknowledgement (`clique react`, Hub.react). A reaction is not
// a message: it changes the entry it's on (`reactions`, see clique-shared/protocol.js) and nothing else. No Electron and
// no hub in here.
import { HANDY_REACTIONS } from 'clique-shared/protocol.js'

// An agent reacts at most this many times within this long: an acknowledgement here and there, not one on everything.
export const REACT_MAX = 5
export const REACT_WINDOW = 10 * 60000
// What an agent says with its reaction is left out of the chat when it's no more than this many words (justAnAck).
const ACK_WORDS = 25
const SAID_MAX = 200

// Names for the common ones, for a shell that can't pass an emoji through (PowerShell re-encodes arguments).
const NAMED = {
  '+1': '👍', thumbsup: '👍', ok: '👍', yes: '👍', ack: '👍', eyes: '👀', looking: '👀', check: '✅', done: '✅', thanks: '🙏', pray: '🙏',
  heart: '❤️', love: '❤️', tada: '🎉', party: '🎉', 100: '💯', fire: '🔥', rocket: '🚀', clap: '👏', laugh: '😂', thinking: '🤔', wave: '👋', salute: '🫡',
}
export const REACT_USAGE = `usage: clique react <emoji>   one emoji on the message you're answering, in place of a written acknowledgement (${HANDY_REACTIONS.join(' ')}, or a name: +1 eyes check thanks heart tada)`

const graphemes = (text) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment)

// What was typed as the one emoji it means: an emoji itself, or a name for one (:eyes:, +1). null when it's neither:
// a word, two emoji, a letter.
export function emojiOf(word) {
  const text = String(word ?? '').trim()
  if (!text) return null
  const named = NAMED[text.replace(/^:|:$/g, '').toLowerCase()]
  if (named) return named
  if (text.length > 24) return null
  const parts = graphemes(text)
  if (parts.length !== 1) return null
  const flag = /^\p{Regional_Indicator}{2}$/u.test(text)
  const keycap = /^[0-9#*]️?⃣$/u.test(text)
  if (!flag && !keycap && !/\p{Extended_Pictographic}/u.test(text)) return null
  // one a terminal passed on without its "as an emoji" mark (❤ for ❤️) gets it back, so it's the same reaction
  return !flag && !keycap && !/\p{Emoji_Presentation}|️/u.test(text) ? `${text}️` : text
}

const ASKS = /\?[\s*_`)"”']*$/
const BAD_NEWS = /\b(fail\w*|errors?|block\w*|broke\w*|couldn['’]t|can['’]t|cannot|unable|not (yet|verified|tested|checked|done))\b/i
// The final message of a turn that reacted: is it only the acknowledgement over again ("Reacted 👍.", "Noted, thanks")?
// Then the reaction says it and the chat needs no line. A question, bad news or anything longer is a message of its own.
export function justAnAck(text) {
  const said = String(text ?? '').trim()
  if (!said) return true
  if (said.includes('```') || said.split('\n').filter((l) => l.trim()).length > 2) return false
  return said.split(/\s+/).length <= ACK_WORDS && !ASKS.test(said) && !BAD_NEWS.test(said)
}

// The words that came with a reaction, kept on it (the pill's tooltip): nothing when they only name the reaction.
export function saidWith(text, emoji) {
  const said = String(text ?? '').replace(/\s+/g, ' ').trim()
  const bare = said.replaceAll(emoji, '').replace(/[\s.!]+/g, ' ').trim()
  if (!bare || /^(i )?(have )?(reacted|acknowledged|ack|done|ok|okay)( with)?( it)?$/i.test(bare)) return ''
  return said.length > SAID_MAX ? `${said.slice(0, SAID_MAX - 1)}…` : said
}
