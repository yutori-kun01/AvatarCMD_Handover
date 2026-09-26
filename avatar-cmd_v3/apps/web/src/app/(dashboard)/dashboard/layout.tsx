import { redirect } from "next/navigation"
import { auth, signOut } from "@/auth"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"

export const dynamic = "force-dynamic"
export const metadata = { title: "ダッシュボード | Avatar CMD" }

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  async function signOutAction() {
    "use server"
    await signOut({ redirectTo: "/login" })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header user={session.user} signOutAction={signOutAction} />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  )
}
