import { PrismaClient } from "@prisma/client";
// 実際の利用時には依存注入等でPrismaインスタンスを渡すか、グローバルから取得
const prisma = new PrismaClient();

// シンプルなインメモリキューのダミー実装
// ※ 本番環境では BullMQ + Redis, Temporal あるいは Prisma ベースのキューを推奨

export type JobType = "generate_post" | "publish_post" | "fetch_knowledge" | "system_maintenance";

export interface JobPayload {
  avatarId?: string;
  automationId?: string;
  data?: any;
}

export interface Job {
  id: string;
  type: JobType;
  payload: JobPayload;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: Date;
}

class Orchestrator {
  private queue: Job[] = [];
  private isProcessing = false;

  async addJob(type: JobType, payload: JobPayload): Promise<string> {
    const job: Job = {
      id: crypto.randomUUID(),
      type,
      payload,
      status: "pending",
      createdAt: new Date(),
    };
    
    this.queue.push(job);
    console.log(`[Orchestrator] Enqueued job ${job.id} (${type})`);
    
    // 非同期で処理開始をトリガー
    this.processQueue().catch(console.error);
    
    return job.id;
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        // 先頭ジョブを取得
        const jobIndex = this.queue.findIndex((j) => j.status === "pending");
        if (jobIndex === -1) break; // pendingなジョブがない
        
        const job = this.queue[jobIndex];
        job.status = "processing";
        
        console.log(`[Orchestrator] Processing job ${job.id} (${job.type})...`);
        
        try {
          // ワーカーに処理を移譲
          const { processJob } = await import("./workers");
          await processJob(job);
          
          job.status = "completed";
          console.log(`[Orchestrator] Job ${job.id} completed.`);
          
          // ジョブをキューから削除（完了済み）
          this.queue.splice(jobIndex, 1);
          
        } catch (error) {
          console.error(`[Orchestrator] Job ${job.id} failed:`, error);
          job.status = "failed";
          // failedなジョブはとりあえずメモリに残すが処理対象から外れる
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  // デバッグ用: 現在のキューの状態を取得
  getQueueStatus() {
    return {
      pending: this.queue.filter((j) => j.status === "pending").length,
      processing: this.queue.filter((j) => j.status === "processing").length,
      failed: this.queue.filter((j) => j.status === "failed").length,
      jobs: this.queue,
    };
  }
}

// シングルトンインスタンス
export const orchestrator = new Orchestrator();
