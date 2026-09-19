// ================================================
// Orchestrator — ジョブ投入の入口
// ================================================
// 実体は Redis (BullMQ)。従来はプロセス内の配列で、
//   - web を再起動すると未処理ジョブが消える
//   - web を複数レプリカにするとジョブが片方にしか見えない
//   - 投入した web プロセス自身がジョブを処理していた
// という問題があった。投入と処理を分離し、処理は worker サービスが行う。

import {
  APP_QUEUE_NAME,
  enqueueAppJob,
  getAppQueue,
  getBrowserQueue,
  getQueueStats,
  type AppJobPayload,
  type AppJobType,
  type QueueStats,
} from "@avatar-cmd/queue";

// 既存の呼び出し側との互換のため名前を維持する
export type JobType = AppJobType;
export type JobPayload = AppJobPayload;

/** worker が受け取るジョブの形（BullMQ の Job から必要な分だけ） */
export interface Job {
  id: string;
  type: JobType;
  payload: JobPayload;
}

class Orchestrator {
  /** ジョブを Redis に投入する。処理は worker サービスが行う */
  async addJob(type: JobType, payload: JobPayload): Promise<string> {
    const jobId = await enqueueAppJob(type, payload);
    console.log(`[Orchestrator] Enqueued job ${jobId} (${type}) on ${APP_QUEUE_NAME}`);
    return jobId;
  }

  /** キューの状態。BullMQ への問い合わせが入るため非同期 */
  async getQueueStatus(): Promise<{ app: QueueStats; browser: QueueStats }> {
    const [app, browser] = await Promise.all([
      getQueueStats(getAppQueue()),
      getQueueStats(getBrowserQueue()),
    ]);
    return { app, browser };
  }
}

export const orchestrator = new Orchestrator();
