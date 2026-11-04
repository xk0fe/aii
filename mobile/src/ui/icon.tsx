// Icons: SF Symbols on iOS, Material Symbols on Android, by one name each.
import { SymbolView, type SymbolWeight } from 'expo-symbols'
import type { ColorValue } from 'react-native'

const ICONS = {
  down: ['chevron.down', 'expand_more'],
  up: ['chevron.up', 'expand_less'],
  right: ['chevron.right', 'chevron_right'],
  back: ['chevron.left', 'chevron_left'],
  send: ['arrow.up', 'arrow_upward'],
  check: ['checkmark', 'check'],
  close: ['xmark', 'close'],
  permission: ['checkmark.shield', 'shield'],
  question: ['questionmark.bubble', 'help'],
  plan: ['list.bullet.clipboard', 'checklist'],
  bolt: ['bolt.fill', 'bolt'],
  handoff: ['arrow.right', 'arrow_forward'],
  reply: ['arrowshape.turn.up.left', 'reply'],
  mac: ['desktopcomputer', 'computer'],
  network: ['wifi', 'wifi'],
  offline: ['wifi.slash', 'wifi_off'],
  scan: ['qrcode.viewfinder', 'qr_code_scanner'],
  paste: ['doc.on.clipboard', 'content_paste'],
  auto: ['sparkles', 'auto_awesome'],
  terminal: ['apple.terminal', 'terminal'],
  restart: ['arrow.clockwise', 'restart_alt'],
  fresh: ['plus.bubble', 'add_comment'],
  free: ['checkmark.circle', 'task_alt'],
  power: ['power', 'power_settings_new'],
  trash: ['trash', 'delete'],
  bug: ['ladybug', 'bug_report'],
  task: ['checklist', 'checklist'],
  warning: ['exclamationmark.triangle', 'warning'],
  undo: ['arrow.uturn.backward', 'undo'],
  keyboard: ['keyboard', 'keyboard'],
  dash: ['minus', 'remove'],
  yield: ['hand.raised', 'front_hand'],
  note: ['note.text', 'sticky_note_2'],
  crew: ['person.2', 'group'],
  chat: ['bubble.left.and.bubble.right', 'forum'],
  bell: ['bell.badge', 'notifications'],
  settings: ['gearshape', 'settings'],
  message: ['square.and.pencil', 'edit_note'],
  parked: ['moon.zzz', 'bedtime'],
  copy: ['doc.on.doc', 'content_copy'],
  share: ['square.and.arrow.up', 'share'],
  latest: ['arrow.down', 'arrow_downward'],
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 17, color, weight = 'semibold' }: { name: IconName; size?: number; color: ColorValue; weight?: SymbolWeight }) {
  const [ios, android] = ICONS[name]
  return <SymbolView name={{ ios, android }} size={size} tintColor={color} weight={weight} resizeMode="scaleAspectFit" style={{ width: size, height: size }} />
}
