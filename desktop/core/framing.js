// Whose words are whose, in what CLIque types into an agent's CLI.
//
// Three voices reach an agent: the user (their message as they typed it, nothing around it), CLIque itself (a line that
// starts "[clique]", and the bracket in front of a message: "[from @ada: …]", "[question from @ada, …]", "[in #ship]"),
// and everybody else: a teammate, an agent on a linked computer, and whatever either of them passes on (a web page, a
// file, a tool's output). Everybody else's words go between <relayed from="name"> and </relayed>, and inside them
// anything that looks like the fence or like one of CLIque's brackets is changed so it can't be taken for the real one.
// So nothing a teammate writes can end its own message early and carry on as the user or as CLIque.
//
// A teammate's hand-off is still work to do: the fence says who is speaking, not that they should be ignored.
// Nothing else is escaped, and nothing is scanned for "suspicious" wording.

const TAG = 'relayed'
// The fence itself, and the start of each bracket CLIque writes (Hub.framed, tagged, briefed, pump's batch line, a
// task's first line in core/tickets.js): one underscore after the "<" or "[" and it's no longer one of ours.
const LOOKALIKE = /(<\/?|\[)(?=relayed\b|clique\]|(?:question |answer )?from @|in #|(?:bug|feature|task) #\d|\d+ (?:hand-offs|answers) )/gi

// Text that isn't the user's or CLIque's, safe to put inside a fence or after one of CLIque's own lines.
export const defused = (text) => String(text ?? '').replace(LOOKALIKE, '$1_')

// The same for a few words quoted inside one of CLIque's brackets (the message a reply answers, the question an answer
// is for): they can't close the bracket they're in either.
export const inBracket = (text) => defused(text).replace(/\[/g, '(').replace(/\]/g, ')')

// Who it's from, as the fence names them: a name, or name@computer.
const who = (from) => String(from ?? '').replace(/[^\w@.-]/g, '').slice(0, 64) || 'someone'

// What `from` said, fenced.
export const relayed = (from, text) => `<${TAG} from="${who(from)}">\n${defused(text)}\n</${TAG}>`

// What goes to a terminal as a paste (Runner.submit): no escape sequences or other control characters, which could end
// the paste early and type the rest as keys (an Enter, then a line of its own that reads as the user's).
export const pasteable = (text) => String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]/g, '')
