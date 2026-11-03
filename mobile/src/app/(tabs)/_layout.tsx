import { NativeTabs } from 'expo-router/native-tabs'

import { useCrew, useDerived } from '@/state/hooks'
import { themes, useTheme } from '@/ui/theme'

export default function Tabs() {
  const t = useTheme()
  const { state } = useCrew()
  const d = useDerived(state)
  const unread = [...d.unread.values()].reduce((n, x) => n + x, 0)
  return (
    <NativeTabs tintColor={t.accent} badgeBackgroundColor={themes.light.waitingInk}>
      <NativeTabs.Trigger name="chat">
        <NativeTabs.Trigger.Label>Chat</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} md="forum" />
        {unread ? <NativeTabs.Trigger.Badge>{String(unread)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="needs">
        <NativeTabs.Trigger.Label>Needs you</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} md="notifications" />
        {d.open.length ? <NativeTabs.Trigger.Badge>{String(d.open.length)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="crew">
        <NativeTabs.Trigger.Label>Crew</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Computers</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'desktopcomputer', selected: 'desktopcomputer' }} md="computer" />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
