import { newSince, nextLine, NEAR, tracker } from '../src/ui/latest'
import { dayLabel, sameDay } from '../src/ui/format'

describe('where the latest message is', () => {
  it('is at -inset on iOS, where the keyboard is a content inset', () => {
    const t = tracker(true)
    expect(t.latest()).toBe(0)
    t.inset(300)
    expect(t.latest()).toBe(-300)
  })

  it('stays at 0 on Android, where the keyboard translates the content', () => {
    const t = tracker(false)
    t.inset(300)
    expect(t.latest()).toBe(0)
  })
})

describe('leaving the latest', () => {
  const at = (ms = 0) => {
    const clock = { now: ms }
    return { clock, t: tracker(true, () => clock.now) }
  }

  it('counts a little way back as still at the latest', () => {
    const { t } = at()
    expect(t.scrolled(NEAR)).toBe(false)
    expect(t.scrolled(NEAR + 1)).toBe(true)
  })

  it('measures from where the latest is with the keyboard up', () => {
    const { t, clock } = at()
    t.inset(300)
    clock.now = 1000
    expect(t.scrolled(-300)).toBe(false)
    expect(t.scrolled(-300 + NEAR)).toBe(false)
    expect(t.scrolled(-300 + NEAR + 1)).toBe(true)
    expect(t.scrolled(0)).toBe(true)
  })

  it('takes no view while the keyboard moves: the inset changes before the offset catches up', () => {
    const { t, clock } = at(1000)
    t.inset(300)
    // the old offset, against the new latest, looks 300 points away
    expect(t.scrolled(0)).toBeNull()
    clock.now = 1200
    expect(t.scrolled(-150)).toBeNull()
    // once it's settled, that really is you scrolling
    clock.now = 2000
    expect(t.scrolled(0)).toBe(true)
  })

  it('takes no view while the keyboard moves the list for it, however long the inset takes to change', () => {
    // Android, closing: the inset only goes at the end, and until then the list is scrolled up to keep the content still
    const clock = { now: 1000 }
    const t = tracker(false, () => clock.now)
    t.inset(300)
    clock.now = 3000
    expect(t.scrolled(0)).toBe(false)
    t.keyboard(true)
    clock.now = 3100
    expect(t.scrolled(150)).toBeNull()
    clock.now = 3250
    expect(t.scrolled(300)).toBeNull()
    t.keyboard(false)
    t.inset(0)
    clock.now = 3300
    expect(t.scrolled(0)).toBe(false)
  })

  it('takes a view again once a keyboard that never reported its end has had its time', () => {
    const { t, clock } = at(1000)
    t.keyboard(true)
    clock.now = 2100
    expect(t.scrolled(900)).toBe(true)
  })

  it("doesn't wait for a jump that has nowhere to go", () => {
    const { t } = at()
    t.scrolled(0)
    t.go()
    expect(t.scrolled(900)).toBe(true)
  })

  it("doesn't count a jump's own scrolls as leaving, until it lands or a finger takes over", () => {
    const { t } = at()
    expect(t.scrolled(900)).toBe(true)
    t.go()
    expect(t.scrolled(600)).toBeNull()
    expect(t.scrolled(50)).toBe(false)
    // landed: you can leave again
    expect(t.scrolled(900)).toBe(true)
    t.go()
    expect(t.scrolled(800)).toBeNull()
    t.grabbed()
    expect(t.scrolled(800)).toBe(true)
  })
})

describe('a row that grows', () => {
  it('moves the list by what it grew, so its start stays put', () => {
    const t = tracker(true)
    t.scrolled(500)
    expect(t.keepingStart(300)).toBe(800)
  })

  it("isn't mistaken for a jump still on its way", () => {
    const t = tracker(true)
    t.scrolled(500)
    t.go()
    t.keepingStart(300)
    expect(t.scrolled(800)).toBe(true)
  })
})

describe('the New line', () => {
  const open = { ready: true, watching: true }
  const elsewhere = { ready: true, watching: false }

  it('waits for the conversation to open', () => {
    expect(nextLine(undefined, null, { ready: false, watching: true })).toBeUndefined()
  })

  it('goes above the oldest unread when a conversation opens, or nowhere', () => {
    expect(nextLine(undefined, 'a', open)).toBe('a')
    expect(nextLine(undefined, null, open)).toBeNull()
  })

  it('stays put while what it marks is read', () => {
    expect(nextLine('a', null, open)).toBe('a')
    expect(nextLine('a', null, elsewhere)).toBe('a')
  })

  it("isn't drawn for what comes in while you watch the latest", () => {
    expect(nextLine(null, 'b', open)).toBeNull()
    expect(nextLine('a', 'b', open)).toBe('a')
  })

  it('is drawn for what comes in while you read back or look elsewhere', () => {
    expect(nextLine(null, 'b', elsewhere)).toBe('b')
  })

  it('moves on once what it marked has been read', () => {
    expect(nextLine('a', 'b', elsewhere)).toBe('b')
  })

  it("doesn't move while what it marks is still unread", () => {
    expect(nextLine('a', 'a', elsewhere)).toBe('a')
  })
})

describe("the button's count", () => {
  // newest first, as the list has them
  const items = ['d', 'c', 'b', 'a'].map((id) => ({ id }))

  it('counts the unread that came in since you left the latest', () => {
    expect(newSince(items, 'b', new Set(['c', 'd']))).toBe(2)
  })

  it('leaves out the unread above where you left', () => {
    expect(newSince(items, 'b', new Set(['a']))).toBe(0)
    expect(newSince(items, 'b', new Set(['a', 'd']))).toBe(1)
  })

  it('counts everything unread when where you left has dropped off the list', () => {
    expect(newSince(items, 'gone', new Set(['a', 'd']))).toBe(2)
  })
})

describe('day lines', () => {
  const now = new Date(2026, 10, 4, 15, 0).getTime()
  const on = (m: number, d: number, y = 2026, h = 12) => new Date(y, m, d, h).getTime()

  it('names today and yesterday', () => {
    expect(dayLabel(on(10, 4), now)).toBe('Today')
    expect(dayLabel(on(10, 3), now)).toBe('Yesterday')
  })

  it("gives other days a date, with the year only when it isn't this one", () => {
    expect(dayLabel(on(10, 2), now)).toMatch(/2/)
    expect(dayLabel(on(10, 2), now)).not.toMatch(/2026/)
    expect(dayLabel(on(11, 30, 2025), now)).toMatch(/2025/)
  })

  it('tells days apart by the calendar, not by 24 hours', () => {
    expect(sameDay(on(10, 3, 2026, 23), on(10, 4, 2026, 1))).toBe(false)
    expect(sameDay(on(10, 4, 2026, 1), on(10, 4, 2026, 23))).toBe(true)
  })
})
