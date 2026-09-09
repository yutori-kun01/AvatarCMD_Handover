import Link from "next/link"
import type { Metadata } from "next"
import { PricingTabs } from "@/components/marketing/pricing-tabs"

export const metadata: Metadata = {
  title: "Avatar CMD | AIアバター搭載PCセットアップ",
  description: "OpenClaw × AIアバター × SNS自動運用。すべてがセットアップ済みのPCをお届け。アップグレード永久無料 + 限定コミュニティ付き。",
}

const features = [
  { icon: "🖥️", title: "選べるハードウェア", desc: "Mac mini M4 / GMKtec ミニPC / お手持ちのPCへのリモート導入。予算と用途に応じて最適な環境を選択。" },
  { icon: "💰", title: "コスパ重視の料金設計", desc: "リモートプランなら ¥49,800〜。GMKtecミニPC込みでも ¥118,000〜。無駄を省いた価格で本格AIを導入。" },
  { icon: "⚡", title: "Avatar CMD 搭載", desc: "OpenClaw + AIアバター(AI Monsters)による自律SNS運用。ダッシュボードから全てを管理・モニタリング。" },
  { icon: "🤝", title: "7日間ハイパーケア付き", desc: "導入後7日間、プロンプト調整・エラー対処・追加設定を伴走サポート。自走できる状態まで導きます。" },
]

const openclawPlans = [
  { badge: "最安プラン", badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", name: "リモートセットアップ", hw: "お手持ちのPCを使用", price: "¥49,800", note: "税込 / 一括", features: ["Zoomでのリモートセットアップ", "OpenClaw 初期設定・最適化", "チャットツール連携 (Slack / Discord等)", "初期ワークフロー 1本構築", "7日間ハイパーケアサポート"], popular: false },
  { badge: "コスパ最強", badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/20", name: "GMKtec ミニPC セットアップ", hw: "GMKtec ミニPC 本体込み", price: "¥118,000", note: "税込 / 一括 (GMKtec本体込み)", features: ["GMKtec ミニPC (16GB RAM / 512GB SSD) 納品", "OpenClaw セットアップ済みで郵送", "チャットツール連携", "Sandbox / Firewall 設定済み", "初期ワークフロー 2本構築", "7日間ハイパーケアサポート"], popular: true },
  { badge: "プレミアム", badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/20", name: "Mac mini セットアップ", hw: "Apple Mac mini M4 本体込み", price: "¥198,000", note: "税込 / 一括 (Mac mini込み)", features: ["Mac mini M4 (16GB / 256GB) 納品", "OpenClaw セットアップ済みで郵送", "チャットツール連携", "Sandbox / Firewall / Allowlist 設定", "初期ワークフロー 3本構築", "7日間ハイパーケアサポート", "macOS最適化チューニング"], popular: false },
]

const clawEmpirePlans = [
  { badge: "最安プラン", badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", name: "リモートセットアップ", hw: "お手持ちのPCを使用", price: "¥59,800", note: "税込 / 一括", features: ["Zoomでのリモートセットアップ", "Claw-Empire フルセットアップ", "ダッシュボード初期設定", "チャットツール連携", "初期ワークフロー 1本構築", "7日間ハイパーケアサポート"], popular: false },
  { badge: "コスパ最強", badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/20", name: "GMKtec ミニPC セットアップ", hw: "GMKtec ミニPC 本体込み", price: "¥138,000", note: "税込 / 一括 (GMKtec本体込み)", features: ["GMKtec ミニPC (16GB RAM / 512GB SSD) 納品", "Claw-Empire フルセットアップ済み郵送", "ダッシュボード + 全モジュール設定", "チャットツール連携", "Sandbox / Firewall 設定済み", "初期ワークフロー 2本構築", "7日間ハイパーケアサポート"], popular: true },
  { badge: "プレミアム", badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/20", name: "Mac mini セットアップ", hw: "Apple Mac mini M4 本体込み", price: "¥228,000", note: "税込 / 一括 (Mac mini込み)", features: ["Mac mini M4 (16GB / 256GB) 納品", "Claw-Empire フルセットアップ済み郵送", "ダッシュボード + 全モジュール設定", "チャットツール連携", "Sandbox / Firewall / Allowlist 設定", "初期ワークフロー 3本構築", "7日間ハイパーケアサポート", "macOS最適化チューニング"], popular: false },
]

const avatarCmdPlans = [
  { badge: "エントリー", badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", name: "Avatar CMD リモート", hw: "お手持ちのPCを使用", price: "¥49,800", note: "税込 / 一括", features: ["Zoomでのリモートセットアップ", "OpenClaw フルセットアップ", "Avatar CMD (AIアバター1体) 構築", "SNS自動運用 初期設定", "チャットツール連携", "7日間ハイパーケアサポート"], premiumFeatures: ["ソフトウェアアップグレード永久無料", "限定オープンチャット参加権"], popular: false },
  { badge: "BEST VALUE", badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30", name: "Avatar CMD × GMKtec", hw: "GMKtec ミニPC 本体込み", price: "¥168,000", note: "税込 / 一括 (GMKtec本体込み)", features: ["GMKtec ミニPC (16GB RAM / 512GB SSD) 納品", "OpenClaw + Avatar CMD フルセットアップ済み郵送", "AIアバター 2体 構築 + SNS自動運用設定", "チャットツール連携 (Slack / Discord / LINE)", "Sandbox / Firewall 設定済み", "初期ワークフロー 3本構築", "7日間ハイパーケアサポート"], premiumFeatures: ["ソフトウェアアップグレード永久無料", "限定オープンチャット参加権"], popular: true },
  { badge: "ULTIMATE", badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/20", name: "Avatar CMD × Mac mini", hw: "Apple Mac mini M4 本体込み", price: "¥248,000", note: "税込 / 一括 (Mac mini込み)", features: ["Mac mini M4 (16GB / 256GB) 納品", "OpenClaw + Avatar CMD フルセットアップ済み郵送", "AIアバター 3体 構築 + SNS自動運用設定", "チャットツール連携 (全プラットフォーム)", "Sandbox / Firewall / Allowlist 設定", "初期ワークフロー 5本構築", "14日間ハイパーケアサポート", "macOS最適化チューニング"], premiumFeatures: ["ソフトウェアアップグレード永久無料", "限定オープンチャット参加権", "優先サポート (DM直通)"], popular: false },
]

const workflowSteps = [
  { num: "01", title: "ヒアリング & 要件確認", desc: "用途・予算・環境をヒアリングし、最適なプランをご提案。Zoom or チャットで30分程度。" },
  { num: "02", title: "ハードウェア準備 & セットアップ", desc: "Mac mini / GMKtecの場合は本体を調達しセットアップ後に郵送。リモートの場合はZoomで実施。" },
  { num: "03", title: "連携設定 & ワークフロー構築", desc: "Slack / Discord / LINE などツール連携を設定。初期ワークフローをプランに応じて構築。" },
  { num: "04", title: "ハイパーケア（7日間〜）", desc: "導入後、プロンプト調整・エラー対処・追加設定を伴走支援。自走できる状態まで導きます。" },
]

const faqItems = [
  { q: "OpenClaw と Claw-Empire の違いは何ですか？", a: "OpenClaw はシンプルで軽量なAIエージェントプラットフォームです。Claw-Empire はダッシュボード・複数モジュール・高度な自動化機能を備えた多機能エコシステムです。" },
  { q: "Avatar CMD とは何ですか？", a: "Avatar CMD は OpenClaw をベースに、AIアバター（AI Monsters）を搭載したプレミアムパッケージ。AIアバターがSNSを自律運用し、コンテンツ制作・収益化まで自動化します。" },
  { q: "ミニPCのスペックはどの程度ですか？", a: "GMKtec製のミニPC（16GB RAM / 512GB SSD）を標準でご用意。AIエージェントの実行には十分なスペックで、Mac miniと比べてコストを抑えて導入可能。" },
  { q: "リモートセットアップは自分のPCで大丈夫ですか？", a: "はい、Windows / Mac / Linux いずれでも対応可能。推奨スペックは 8GB RAM以上・50GB以上の空き容量です。" },
  { q: "別途かかる費用はありますか？", a: "各AIモデルのAPI利用料（OpenAI / Anthropic / Google 等）が別途。月額数百円〜数千円程度が一般的です。" },
  { q: "アップグレード永久無料とは？", a: "Avatar CMD プランでは、ソフトウェアの新バージョンリリース時に無料でアップデートを受けられます。ハードウェアの交換は含まれません。" },
]

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative pt-40 pb-24 text-center overflow-hidden">
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[radial-gradient(ellipse_at_50%_0%,rgba(79,124,255,0.12)_0%,transparent_60%)] blur-[60px] pointer-events-none" />
        <div className="relative z-10 max-w-[1200px] mx-auto px-6">
          <div className="inline-block px-4 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full text-sm text-blue-400 mb-6">
            ⚡ AIアバター搭載PC セットアップ代行
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-5">
            AIエージェント、<br />
            <span className="bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] bg-clip-text text-transparent">最安で最速</span>の導入を。
          </h1>
          <p className="max-w-xl mx-auto text-base text-white/60 leading-relaxed mb-9">
            OpenClaw / Claw-Empire を、Mac mini・GMKtec・リモートの3パターンから選んでセットアップ。あなたに最適なAI環境を、コスパ重視で構築します。
          </p>
          <div className="flex gap-4 justify-center flex-wrap mb-16">
            <Link href="#pricing" className="px-8 py-3.5 bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] rounded-full font-semibold shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 hover:-translate-y-0.5 transition-all">プランを見る</Link>
            <Link href="#features" className="px-8 py-3.5 bg-white/5 border border-white/10 rounded-full font-semibold hover:bg-white/10 transition-all">サービス詳細</Link>
          </div>
          <div className="flex justify-center gap-12">
            {[{ num: "9", label: "選べるプラン" }, { num: "¥49,800〜", label: "リモート最安" }, { num: "7日間", label: "ハイパーケア" }].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-xl font-bold">{s.num}</div>
                <div className="text-xs text-white/30 uppercase tracking-wider mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 bg-[#0a0a10]">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <span className="inline-block px-3.5 py-1 text-xs font-semibold uppercase tracking-widest text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full mb-4">Features</span>
            <h2 className="text-3xl font-bold tracking-tight mb-3">コスパ × 本格AIのベストバランス</h2>
            <p className="text-white/60 max-w-lg mx-auto">ただ安いだけではない。実務で使えるAI環境を最適な価格で。</p>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            {features.map((f) => (
              <div key={f.title} className="p-8 bg-white/[0.03] border border-white/[0.08] rounded-2xl hover:border-white/[0.15] hover:bg-white/[0.05] hover:-translate-y-0.5 transition-all">
                <div className="text-2xl mb-5">{f.icon}</div>
                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-white/60 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <span className="inline-block px-3.5 py-1 text-xs font-semibold uppercase tracking-widest text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full mb-4">Pricing</span>
            <h2 className="text-3xl font-bold tracking-tight mb-3">あなたに合ったプランを選ぶ</h2>
            <p className="text-white/60 max-w-lg mx-auto">OpenClaw・Claw-Empire・Avatar CMD、3つのラインから最適な組み合わせを。</p>
          </div>
          <PricingTabs openclawPlans={openclawPlans} clawEmpirePlans={clawEmpirePlans} avatarCmdPlans={avatarCmdPlans} />
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" className="py-24 bg-[#0a0a10]">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <span className="inline-block px-3.5 py-1 text-xs font-semibold uppercase tracking-widest text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full mb-4">Workflow</span>
            <h2 className="text-3xl font-bold tracking-tight mb-3">導入フロー</h2>
            <p className="text-white/60 max-w-lg mx-auto">お問い合わせから本稼働まで、スムーズに伴走します。</p>
          </div>
          <div className="max-w-xl mx-auto space-y-0 relative">
            <div className="absolute top-0 left-7 w-0.5 h-full bg-gradient-to-b from-blue-500/20 to-purple-500/20" />
            {workflowSteps.map((step) => (
              <div key={step.num} className="flex gap-7 py-7 relative">
                <div className="shrink-0 w-14 h-14 flex items-center justify-center bg-[#0c0c14] border-2 border-blue-500 rounded-full text-sm font-extrabold text-blue-400 relative z-10 shadow-[0_0_20px_rgba(79,124,255,0.15)]">{step.num}</div>
                <div>
                  <h3 className="text-lg font-semibold mb-2 mt-1">{step.title}</h3>
                  <p className="text-sm text-white/60 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <span className="inline-block px-3.5 py-1 text-xs font-semibold uppercase tracking-widest text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full mb-4">FAQ</span>
            <h2 className="text-3xl font-bold tracking-tight">よくある質問</h2>
          </div>
          <div className="max-w-2xl mx-auto space-y-2">
            {faqItems.map((item) => (
              <details key={item.q} className="group border border-white/[0.08] rounded-xl overflow-hidden">
                <summary className="cursor-pointer px-6 py-5 bg-white/[0.03] hover:bg-white/[0.05] transition-colors text-[0.95rem] font-medium flex justify-between items-center">
                  <span>{item.q}</span>
                  <span className="text-blue-400 text-xl ml-4 group-open:rotate-45 transition-transform">+</span>
                </summary>
                <div className="px-6 py-4 text-sm text-white/60 leading-relaxed border-t border-white/5">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="contact" className="py-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="p-12 md:p-16 bg-white/[0.03] border border-white/[0.08] rounded-3xl text-center">
            <h2 className="text-3xl font-bold mb-4">まずは無料でご相談ください</h2>
            <p className="text-white/60 mb-8">用途・予算・環境に合わせて最適なプランをご提案します。</p>
            <a href="https://x.com/and_and_and_and" className="inline-flex px-10 py-4 bg-gradient-to-r from-[#4f7cff] to-[#8b5cf6] rounded-full text-base font-semibold shadow-lg shadow-purple-500/25 hover:shadow-purple-500/45 hover:-translate-y-0.5 transition-all" target="_blank" rel="noopener noreferrer">
              X (Twitter) で相談
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
