import { Redirect } from 'expo-router'

import { useSession } from '@/state/hooks'

// Paired (or in the demo): the chat. Otherwise: pairing.
export default function Index() {
  const s = useSession()
  if (!s.loaded) return null
  return <Redirect href={s.active ? '/chat' : '/pair'} />
}
