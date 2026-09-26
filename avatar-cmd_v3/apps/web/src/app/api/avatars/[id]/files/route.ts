import { z } from "zod"
import { prisma } from "@avatar-cmd/db"
import { listAvatarFiles, readAvatarFile, writeAvatarFile, EDITABLE_FILES } from "@avatar-cmd/core"
import { route, parseBody, notFound } from "@/lib/api"

export const dynamic = "force-dynamic"

async function assertAvatar(id: string) {
  const avatar = await prisma.avatar.findUnique({ where: { id }, select: { id: true } })
  if (!avatar) notFound("アバター")
}

// GET /api/avatars/[id]/files[?filename=soul.md]
export const GET = route(async (req, { params }) => {
  await assertAvatar(params.id)
  const filename = req.nextUrl.searchParams.get("filename")
  if (filename) {
    const content = await readAvatarFile(params.id, filename)
    if (content === null) notFound("ファイル")
    return { filename, content }
  }
  return listAvatarFiles(params.id)
})

const putSchema = z.object({
  filename: z.enum(EDITABLE_FILES),
  content: z.string().max(256 * 1024),
})

// PUT /api/avatars/[id]/files  { filename, content }
export const PUT = route(async (req, { params, userId }) => {
  await assertAvatar(params.id)
  const { filename, content } = await parseBody(req, putSchema)
  await writeAvatarFile(params.id, filename, content)
  await prisma.avatar.update({ where: { id: params.id }, data: { lastSyncAt: new Date() } })
  await prisma.activityLog.create({
    data: { avatarId: params.id, action: "soul_updated", category: "system", description: `人格ファイル ${filename} を更新しました` },
  })
  await prisma.auditLog.create({ data: { userId, action: "soul_file_updated", resource: "avatar", resourceId: params.id, details: { filename } } })
  return { success: true, filename }
})
