// ================================================
// API クレジット不足による自動化の一時停止（アカウントごと）
// ================================================
// ・投稿がクレジット不足（X の 402）で失敗した回数を、アカウントごとに連続で数える。成功したら 0 に戻す
// ・CREDIT_PAUSE_THRESHOLD 回続いたら、そのアカウントの自動化を一時停止する
//   - 自動化ルール（そのアカウントへの投稿・引用探索）を実行しない
//   - 自動の引用探索（アカウント設定・ルール）を行わない
//   - 予約中の投稿は送信せず、送信時刻に下書き（承認待ち）へ戻す
//   （手動の操作・自分の投稿の分析は止めない。クレジットが無ければ失敗するだけで課金はされない）
// ・再開は画面のボタン（resumeAccountAutomation）だけ。自動では再開しない

import { prisma } from "@avatar-cmd/db";
import { ApiError, ConfigError, CreditError } from "../http";
import { getPlatform } from "../platforms";

/** 何回続けてクレジット不足で投稿できなかったら止めるか */
export const CREDIT_PAUSE_THRESHOLD = 2;

/** クレジット・プラン不足の失敗か */
export function isCreditError(e: unknown): boolean {
  return e instanceof CreditError || (e instanceof ApiError && e.status === 402);
}

/**
 * クレジット不足で投稿できなかったことを記録する。連続回数が閾値に達したら自動化を一時停止する。
 * 今回の記録で一時停止したら true
 */
export async function recordCreditFailure(accountId: string, message: string): Promise<boolean> {
  const acc = await prisma.snsAccount.update({ where: { id: accountId }, data: { creditFailures: { increment: 1 } } });
  if (acc.creditFailures < CREDIT_PAUSE_THRESHOLD || acc.automationPausedAt) return false;
  // 同時に 2 件失敗しても一時停止の記録は 1 回だけ
  const reason = `API クレジット不足で ${acc.creditFailures} 回続けて投稿できませんでした: ${message.slice(0, 200)}`;
  const paused = await prisma.snsAccount.updateMany({ where: { id: accountId, automationPausedAt: null }, data: { automationPausedAt: new Date(), automationPausedReason: reason } });
  if (!paused.count) return false;
  const name = getPlatform(acc.platform)?.name ?? acc.platform;
  await prisma.activityLog.create({
    data: {
      avatarId: acc.avatarId,
      action: "automation_paused",
      category: "sns",
      level: "error",
      description: `${name} (${acc.accountName}) の自動化を一時停止しました（${reason}）。クレジットをチャージしてから、設定 > アカウント の「自動化を再開」を押してください`,
      metadata: { snsAccountId: acc.id, creditFailures: acc.creditFailures },
    },
  });
  return true;
}

/** 投稿に成功したら連続回数を 0 に戻す（一時停止は解除しない。再開はボタンで行う） */
export async function clearCreditFailures(accountId: string): Promise<void> {
  await prisma.snsAccount.updateMany({ where: { id: accountId, creditFailures: { gt: 0 } }, data: { creditFailures: 0 } });
}

/** 一時停止を解除する（画面の「自動化を再開」） */
export async function resumeAccountAutomation(accountId: string) {
  const acc = await prisma.snsAccount.findUnique({ where: { id: accountId } });
  if (!acc) throw new ConfigError("アカウントが見つかりません");
  if (!acc.automationPausedAt) return { resumed: false };
  await prisma.snsAccount.update({ where: { id: accountId }, data: { automationPausedAt: null, automationPausedReason: null, creditFailures: 0 } });
  await prisma.activityLog.create({
    data: {
      avatarId: acc.avatarId,
      action: "automation_resumed",
      category: "sns",
      level: "info",
      description: `${getPlatform(acc.platform)?.name ?? acc.platform} (${acc.accountName}) の自動化を再開しました`,
      metadata: { snsAccountId: acc.id },
    },
  });
  return { resumed: true };
}

/** 自動化を一時停止しているアカウントの ID（指定したものの中から） */
export async function pausedAccountIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await prisma.snsAccount.findMany({ where: { id: { in: ids }, automationPausedAt: { not: null } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}
