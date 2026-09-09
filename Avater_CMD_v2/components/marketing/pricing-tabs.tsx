"use client"

import { useState } from "react"
import Link from "next/link"

interface Plan {
  badge: string
  badgeClass: string
  name: string
  hw: string
  price: string
  note: string
  features: string[]
  premiumFeatures?: string[]
  popular: boolean
}

export function PricingTabs({
  openclawPlans,
  clawEmpirePlans,
  avatarCmdPlans,
}: {
  openclawPlans: Plan[]
  clawEmpirePlans: Plan[]
  avatarCmdPlans: Plan[]
}) {
  const [activeTab, setActiveTab] = useState<"openclaw" | "claw-empire" | "avatar-cmd">("avatar-cmd")

  const tabs = [
    { id: "openclaw" as const, label: "OpenClaw" },
    { id: "claw-empire" as const, label: "Claw-Empire" },
    { id: "avatar-cmd" as const, label: "⚡ Avatar CMD" },
  ]

  const plans =
    activeTab === "openclaw" ? openclawPlans :
    activeTab === "claw-empire" ? clawEmpirePlans :
    avatarCmdPlans

  const isAvatar = activeTab === "avatar-cmd"

  return (
    <>
      <div className="flex justify-center mb-10">
        <div className="flex gap-1 p-1 bg-white/[0.04] border border-white/[0.08] rounded-full">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-2.5 text-sm font-semibold rounded-full transition-all ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] text-white shadow-lg shadow-blue-500/30"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {isAvatar && (
        <div className="text-center mb-10 p-8 bg-gradient-to-r from-amber-500/[0.06] to-purple-500/[0.06] border border-amber-500/15 rounded-3xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-500 via-purple-500 to-blue-500" />
          <div className="inline-block px-3.5 py-1 bg-amber-500/15 border border-amber-500/30 rounded-full text-[0.7rem] font-bold text-amber-400 tracking-wider mb-3">
            ⚡ PREMIUM PACKAGE
          </div>
          <h3 className="text-xl font-bold bg-gradient-to-r from-amber-400 via-amber-500 to-purple-500 bg-clip-text text-transparent mb-2">
            Avatar CMD 搭載 AI パーソナルPC
          </h3>
          <p className="text-sm text-white/60 max-w-lg mx-auto">
            OpenClaw × AIアバター × SNS自動運用。すべてがセットアップ済みのPCをお届け。<br />
            アップグレード永久無料 + 限定オープンチャット参加権付き。
          </p>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-5">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`relative p-8 bg-white/[0.03] border rounded-2xl transition-all hover:-translate-y-1 overflow-hidden ${
              plan.popular
                ? isAvatar
                  ? "border-amber-500/25 shadow-[0_0_40px_rgba(251,191,36,0.08)]"
                  : "border-blue-500/30 shadow-[0_0_40px_rgba(79,124,255,0.1)]"
                : "border-white/[0.08] hover:border-white/[0.15]"
            }`}
          >
            {plan.popular && (
              <>
                <div className={`absolute top-0 left-0 right-0 h-0.5 ${isAvatar ? "bg-gradient-to-r from-amber-500 to-amber-400" : "bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6]"}`} />
                <div className={`absolute top-3.5 right-[-28px] text-[0.7rem] font-bold px-9 py-1 rotate-45 ${isAvatar ? "bg-gradient-to-r from-amber-500 to-amber-400 text-black" : "bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] text-white"}`}>
                  {isAvatar ? "推奨" : "人気"}
                </div>
              </>
            )}
            <div className="mb-5">
              <span className={`inline-block px-2.5 py-0.5 text-[0.7rem] font-semibold rounded-full border mb-3 ${plan.badgeClass}`}>
                {plan.badge}
              </span>
              <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
              <p className="text-sm text-white/30">{plan.hw}</p>
            </div>
            <div className="mb-6 pb-6 border-b border-white/5">
              <span className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] bg-clip-text text-transparent">
                {plan.price}
              </span>
              <span className="block text-xs text-white/30 mt-1">{plan.note}</span>
            </div>
            <ul className="space-y-3 mb-7 text-sm text-white/60">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <span className="text-blue-400 font-bold shrink-0">✓</span>
                  {f}
                </li>
              ))}
              {plan.premiumFeatures?.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <span className="text-amber-400 font-bold shrink-0">★</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="#contact"
              className={`block text-center py-3.5 rounded-xl font-semibold text-sm transition-all ${
                plan.popular
                  ? "bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40"
                  : "border border-white/[0.08] hover:border-blue-500 hover:bg-blue-500/10"
              }`}
            >
              このプランで相談
            </Link>
          </div>
        ))}
      </div>
    </>
  )
}
