import { z } from "zod"

export const ACTION_TYPES = ["generate_post", "publish_due", "fetch_knowledge", "system_maintenance"] as const

export const triggerConfigSchema = z
  .object({
    intervalMinutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
    intervalSeconds: z.number().int().min(10).max(3600).optional(),
    cron: z.string().max(100).optional(),
  })
  .refine((c) => c.intervalMinutes || c.intervalSeconds || c.cron, "intervalMinutes / intervalSeconds / cron のいずれかが必要です")

export const actionConfigSchema = z
  .object({
    topic: z.string().max(200).optional(),
    platform: z.string().max(30).optional(),
    autoPublish: z.boolean().optional(),
    url: z.string().max(2000).optional(),
  })
  .strict()

/** Converts v2 free-text trigger strings ("schedule:every_30min") into triggerConfig. */
export function legacyTrigger(trigger?: string): Record<string, unknown> | null {
  if (!trigger) return null
  const sec = trigger.match(/demo_(\d+)sec/)
  if (sec) return { intervalSeconds: Math.max(10, Number(sec[1])) }
  const min = trigger.match(/every_(\d+)min/)
  if (min) return { intervalMinutes: Number(min[1]) }
  const daily = trigger.match(/daily_(\d{2}):(\d{2})/)
  if (daily) return { cron: `${Number(daily[2])} ${Number(daily[1])} * * *` }
  return null
}

