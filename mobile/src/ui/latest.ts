// Where the chat stands against its latest message, the way Slack, Discord and WhatsApp handle it: near the latest it
// follows new messages; scrolled back, nothing moves under you and a button leads down; sending always takes you down.
// No React here, so it's tested on its own (test/latest.test.ts).
//
// The list is inverted, so the latest is at the start of its scroll range, and the keyboard changes where that start
// is. On iOS its room is a content inset, which puts the latest at -inset. On Android the content is translated
// instead, so the latest stays at 0. Scrolling to 0 with the keyboard up on iOS would leave the latest behind it.

export const NEAR = 60 // this far back still counts as at the latest (what the computer's chat counts)
const MOVING = 1000 // the most a keyboard takes to move, in case its end never reports
const SETTLE = 450 // and the offset catches up after it: a scroll this soon says nothing about where you are

export function tracker(ios: boolean, now: () => number = Date.now) {
  let inset = 0
  let settled = -Infinity
  let going = false // a jump to the latest is on its way: the scrolls it makes aren't you leaving
  let at = 0
  const latest = () => (ios ? 0 - inset : 0)
  return {
    latest,
    // In an inverted list a row that grows pushes its own start up and away. This offset puts its start back where it
    // was, so it opens downward the way you read it.
    keepingStart(by: number) {
      going = false
      return at + by
    },
    inset(next: number) {
      if (next === inset) return
      inset = next
      settled = Math.max(settled, now() + SETTLE)
    },
    // The keyboard started or stopped moving. While it does the list is moved for it: none of that is you scrolling.
    keyboard(moving: boolean) {
      settled = now() + (moving ? MOVING : SETTLE)
    },
    // A scroll: true when you've left the latest, false when you're at it, null when this one doesn't say.
    scrolled(y: number): boolean | null {
      at = y
      if (y - latest() <= NEAR) {
        going = false
        return false
      }
      return going || now() < settled ? null : true
    },
    // A jump to the latest starts. Already there, nothing will scroll, so nothing would ever say it arrived.
    go() {
      going = at - latest() > 1
    },
    // your finger takes over from a jump
    grabbed() {
      going = false
    },
  }
}

// The "New" line: the entry it goes above, undefined until the conversation has opened. It stays where it first went
// while you read, so it doesn't pull the messages around, until you leave or send. Once what it marks has been read,
// what comes in while you read back or look elsewhere takes it over; what comes in while you watch the latest needs no
// line.
export function nextLine(line: string | null | undefined, oldestUnread: string | null, { ready, watching }: { ready: boolean; watching: boolean }) {
  if (line === undefined) return ready ? oldestUnread : undefined
  return oldestUnread && !watching ? oldestUnread : line
}

// What the button's badge counts: the unread that came in below you since you left the latest (`leftAt`, the newest
// entry then). Items are newest first, as the list has them. Something unread far above you isn't down there.
export function newSince(items: { id: string }[], leftAt: string | null, unread: Set<string>) {
  let n = 0
  for (const e of items) {
    if (e.id === leftAt) break
    if (unread.has(e.id)) n++
  }
  return n
}
