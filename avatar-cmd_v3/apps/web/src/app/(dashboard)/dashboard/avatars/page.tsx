import { Suspense } from "react"
import { AvatarsPage } from "@/components/dashboard/pages/avatars-page"

export default function Page() {
  return (
    <Suspense>
      <AvatarsPage />
    </Suspense>
  )
}
