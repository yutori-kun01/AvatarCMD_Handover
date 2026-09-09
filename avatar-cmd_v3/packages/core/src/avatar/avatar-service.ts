// ==============================================
// Avatar Service — Core CRUD + Business Logic
// ==============================================

import { prisma, type Avatar, type AvatarStatus, type Prisma } from "@avatar-cmd/db";
import { MoodEngine, type MoodState } from "../persona/mood-engine";

export interface CreateAvatarInput {
  userId: string;
  name: string;
  role?: string;
  description?: string;
  personality?: Record<string, number>;
  communication?: Record<string, number>;
  writingRules?: Record<string, unknown>;
}

export interface UpdateAvatarInput {
  name?: string;
  role?: string;
  description?: string;
  status?: AvatarStatus;
  personality?: Record<string, number>;
  communication?: Record<string, number>;
  writingRules?: Record<string, unknown>;
}

export class AvatarService {
  private moodEngine: MoodEngine;

  constructor() {
    this.moodEngine = new MoodEngine();
  }

  /**
   * Get all avatars for a user with optional status filter.
   */
  async list(userId: string, status?: AvatarStatus): Promise<Avatar[]> {
    return prisma.avatar.findMany({
      where: {
        userId,
        ...(status ? { status } : {}),
      },
      include: {
        snsAccounts: true,
        identity: true,
        _count: {
          select: {
            contents: true,
            revenues: true,
            campaigns: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Get a single avatar by ID with full relations.
   */
  async get(id: string): Promise<Avatar | null> {
    return prisma.avatar.findUnique({
      where: { id },
      include: {
        snsAccounts: true,
        identity: true,
        automationRules: true,
        _count: {
          select: {
            contents: true,
            revenues: true,
            campaigns: true,
            activityLogs: true,
          },
        },
      },
    });
  }

  /**
   * Create a new avatar.
   */
  async create(input: CreateAvatarInput): Promise<Avatar> {
    const avatar = await prisma.avatar.create({
      data: {
        userId: input.userId,
        name: input.name,
        role: input.role ?? "sns_marketer",
        description: input.description,
        personality: input.personality ?? {},
        communication: input.communication ?? {},
        writingRules: input.writingRules ?? {},
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        avatarId: avatar.id,
        action: "avatar_created",
        category: "system",
        description: `アバター「${avatar.name}」が作成されました`,
        level: "success",
      },
    });

    return avatar;
  }

  /**
   * Update an avatar.
   */
  async update(id: string, input: UpdateAvatarInput): Promise<Avatar> {
    const data: Prisma.AvatarUpdateInput = {};

    if (input.name !== undefined) data.name = input.name;
    if (input.role !== undefined) data.role = input.role;
    if (input.description !== undefined) data.description = input.description;
    if (input.status !== undefined) data.status = input.status;
    if (input.personality !== undefined) data.personality = input.personality;
    if (input.communication !== undefined) data.communication = input.communication;
    if (input.writingRules !== undefined) data.writingRules = input.writingRules;

    return prisma.avatar.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete an avatar (cascade deletes all related data).
   */
  async delete(id: string): Promise<void> {
    const avatar = await prisma.avatar.findUnique({ where: { id } });
    if (!avatar) throw new Error(`Avatar not found: ${id}`);

    await prisma.avatar.delete({ where: { id } });

    await prisma.activityLog.create({
      data: {
        action: "avatar_deleted",
        category: "system",
        description: `アバター「${avatar.name}」が削除されました`,
        level: "warning",
      },
    });
  }

  /**
   * Update avatar mood and return the new mood state.
   */
  async updateMood(id: string): Promise<MoodState> {
    const avatar = await prisma.avatar.findUnique({ where: { id } });
    if (!avatar) throw new Error(`Avatar not found: ${id}`);

    const mood = this.moodEngine.calculate(
      avatar.moodScore,
      avatar.moodUpdatedAt
    );

    await prisma.avatar.update({
      where: { id },
      data: {
        moodScore: mood.score,
        moodUpdatedAt: mood.lastUpdated,
      },
    });

    return mood;
  }

  /**
   * Toggle avatar status between ACTIVE and PAUSED.
   */
  async toggleStatus(id: string): Promise<Avatar> {
    const avatar = await prisma.avatar.findUnique({ where: { id } });
    if (!avatar) throw new Error(`Avatar not found: ${id}`);

    const newStatus: AvatarStatus =
      avatar.status === "ACTIVE" ? "PAUSED" : "ACTIVE";

    const updated = await prisma.avatar.update({
      where: { id },
      data: { status: newStatus },
    });

    await prisma.activityLog.create({
      data: {
        avatarId: id,
        action: newStatus === "ACTIVE" ? "avatar_resumed" : "avatar_paused",
        category: "system",
        description: `アバター「${avatar.name}」が${newStatus === "ACTIVE" ? "再開" : "一時停止"}されました`,
        level: "info",
      },
    });

    return updated;
  }

  /**
   * Get dashboard summary stats for a user.
   */
  async getDashboardStats(userId: string) {
    const [avatars, totalContents, totalRevenue, recentActivity] =
      await Promise.all([
        prisma.avatar.count({ where: { userId } }),
        prisma.content.count({
          where: { avatar: { userId } },
        }),
        prisma.revenue.aggregate({
          where: { avatar: { userId } },
          _sum: { amount: true },
        }),
        prisma.activityLog.findMany({
          where: { avatar: { userId } },
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { avatar: true },
        }),
      ]);

    return {
      avatarCount: avatars,
      totalContents,
      totalRevenue: totalRevenue._sum.amount ?? 0,
      recentActivity,
    };
  }
}
