import { z } from "zod"
import { prisma, type Prisma } from "@avatar-cmd/db"
import { orchestrator, assertSafeUrl, SsrfError } from "@avatar-cmd/core"
import { route, parseBody, ApiError } from "@/lib/api"
import { serializeKnowledge } from "@/lib/serializers"

export const dynamic = "force-dynamic"

export const GET = route(async (req) => {
  const sp = req.nextUrl.searchParams
  const where: Prisma.KnowledgeItemWhereInput = { isActive: true }
  if (sp.get("avatarId")) where.avatarId = sp.get("avatarId")!
  if (sp.get("category")) where.category = sp.get("category")!
  const [items, totalCount, categories] = await Promise.all([
    prisma.knowledgeItem.findMany({ where, orderBy: { createdAt: "desc" }, include: { avatar: { select: { id: true, name: true, role: true } } }, take: 200 }),
    prisma.knowledgeItem.count({ where }),
    prisma.knowledgeItem.groupBy({ by: ["category"], where, _count: true }),
  ])
  return {
    items: items.map(serializeKnowledge),
    totalCount,
    categories: categories.map((c) => ({ category: c.category, _count: c._count })),
  }
})

const createSchema = z
  .object({
    avatarId: z.string().min(1),
    title: z.string().trim().max(200).optional().default(""),
    content: z.string().max(100_000).optional().default(""),
    category: z.string().trim().max(50).optional(),
    sourceUrl: z.string().trim().max(2000).optional().default(""),
    tags: z.array(z.string().trim().max(40)).max(20).optional().default([]),
  })
  .refine((b) => b.content || b.sourceUrl, "content または sourceUrl のいずれかが必要です")
  .refine((b) => b.title || b.sourceUrl, "title が必要です")

// POST /api/knowledge — manual item, or URL → background fetch (SSRF-guarded)
export const POST = route(async (req) => {
  const body = await parseBody(req, createSchema)
  const avatar = await prisma.avatar.findUnique({ where: { id: body.avatarId }, select: { id: true } })
  if (!avatar) throw new ApiError(400, "アバターが存在しません")
  if (body.sourceUrl) {
    try {
      assertSafeUrl(body.sourceUrl)
    } catch (e) {
      if (e instanceof SsrfError) throw new ApiError(400, `このURLは取得できません: ${e.message}`)
      throw e
    }
  }
  const item = await prisma.knowledgeItem.create({
    data: {
      avatarId: body.avatarId,
      title: body.title || body.sourceUrl,
      category: body.category || "未分類",
      tags: body.tags,
      source: body.sourceUrl ? "url" : "manual",
      sourceUrl: body.sourceUrl || null,
      content: body.content || null,
      summary: body.content ? body.content.slice(0, 200) : null,
    },
    include: { avatar: { select: { id: true, name: true, role: true } } },
  })
  await prisma.activityLog.create({
    data: { avatarId: body.avatarId, action: "knowledge_added", category: "system", description: `知識「${item.title}」を追加しました` },
  })
  if (body.sourceUrl && !body.content) {
    await orchestrator.addJob("fetch_knowledge", { avatarId: body.avatarId, data: { knowledgeId: item.id, url: body.sourceUrl } })
  }
  return Response.json(serializeKnowledge(item), { status: 201 })
})
