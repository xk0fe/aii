import { router } from 'expo-router'

import { DEMO, session } from '@/state/session'
import { useMountEffect } from '@/ui/hooks'

// clique://demo opens the demo clique straight away (for screenshots and App Review).
export default function Demo() {
  useMountEffect(() => {
    void session.whenLoaded().then(() => {
      if (session.getSnapshot().active !== DEMO) session.startDemo()
      router.replace('/chat')
    })
  })
  return null
}
