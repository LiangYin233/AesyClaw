import { randomUUID } from 'crypto';
import { logger } from '../../../platform/observability/index.js';
import { formatLocalTimestamp } from '../../../platform/observability/logging.js';
import { Database } from '../../../platform/db/index.js';
import type { AdapterSendResult, ChannelMessage, DeliveryReceipt } from '../domain/types.js';

interface DeliveryJobRow {
  job_id: string;
  idempotency_key: string;
  channel: string;
  conversation_id: string;
  payload_json: string;
  status: 'queued' | 'sending' | 'sent' | 'failed';
  attempts: number;
  retryable: number;
  next_retry_at?: string | null;
  platform_message_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
}

export interface DeliveryJob {
  jobId: string;
  idempotencyKey: string;
  channel: string;
  conversationId: string;
  payload: ChannelMessage;
  attempts: number;
}

function reviveMessage(message: any): ChannelMessage {
  return {
    ...message,
    timestamp: new Date(message.timestamp),
    segments: Array.isArray(message.segments) ? message.segments.map((segment: any) => {
      if (segment?.type === 'quote' && segment.message) {
        return {
          ...segment,
          message: reviveMessage(segment.message)
        };
      }
      return segment;
    }) : []
  } as ChannelMessage;
}

function serializeMessage(message: ChannelMessage): Record<string, unknown> {
  return {
    ...message,
    timestamp: formatLocalTimestamp(message.timestamp),
    segments: Array.isArray(message.segments)
      ? message.segments.map((segment: any) => {
          if (segment?.type === 'quote' && segment.message) {
            return {
              ...segment,
              message: serializeMessage(segment.message)
            };
          }
          return segment;
        })
      : []
  };
}

export class DeliveryQueue {
  private log = logger.child('DeliveryQueue');
  private pollTimer?: NodeJS.Timeout;
  private running = false;
  private inflight = new Set<string>();
  private processor?: (job: DeliveryJob) => Promise<AdapterSendResult>;
  private classifier?: (job: DeliveryJob, error: unknown) => { retryable: boolean; code: string; message?: string };

  constructor(
    private db: Database,
    private options: {
      pollIntervalMs?: number;
      maxAttempts?: number;
    } = {}
  ) {}

  async start(
    processor: (job: DeliveryJob) => Promise<AdapterSendResult>,
    classifier: (job: DeliveryJob, error: unknown) => { retryable: boolean; code: string; message?: string }
  ): Promise<void> {
    this.processor = processor;
    this.classifier = classifier;

    if (this.running) {
      return;
    }

    this.running = true;
    await this.db.run(
      `UPDATE channel_delivery_jobs SET status = 'queued', updated_at = ? WHERE status = 'sending'`,
      [formatLocalTimestamp(new Date())]
    );
    this.pollTimer = setInterval(() => {
      void this.processDueJobs();
    }, this.options.pollIntervalMs ?? 2000);
    await this.processDueJobs();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async dispatch(args: {
    channel: string;
    conversationId: string;
    payload: ChannelMessage;
    idempotencyKey?: string;
  }): Promise<DeliveryReceipt> {
    this.log.info(`dispatch called: channel=${args.channel} conversationId=${args.conversationId}`);
    const idempotencyKey = args.idempotencyKey || randomUUID();
    const existing = await this.db.get<DeliveryJobRow>(
      `SELECT * FROM channel_delivery_jobs WHERE idempotency_key = ?`,
      [idempotencyKey]
    );

    let jobId = existing?.job_id;
    if (!jobId) {
      jobId = randomUUID();
      const now = formatLocalTimestamp(new Date());
      await this.db.run(
        `INSERT INTO channel_delivery_jobs (
           job_id, idempotency_key, channel, conversation_id, payload_json,
           status, attempts, retryable, next_retry_at, platform_message_id,
           error_code, error_message, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'queued', 0, 0, NULL, NULL, NULL, NULL, ?, ?)`,
        [jobId, idempotencyKey, args.channel, args.conversationId, JSON.stringify(serializeMessage(args.payload)), now, now]
      );
      this.log.info(`dispatch: created new job=${jobId}`);
    } else {
      this.log.info(`dispatch: found existing job=${jobId} status=${existing?.status}`);
    }

    await this.processJob(jobId);
    return this.getReceipt(jobId);
  }

  private async processDueJobs(): Promise<void> {
    if (!this.running) {
      return;
    }

    const rows = await this.db.all<DeliveryJobRow>(
      `SELECT * FROM channel_delivery_jobs
       WHERE status = 'queued'
          OR (status = 'failed' AND retryable = 1 AND next_retry_at IS NOT NULL AND datetime(next_retry_at) <= datetime(?))
       ORDER BY datetime(created_at) ASC
       LIMIT 20`,
      [formatLocalTimestamp(new Date())]
    );

    for (const row of rows) {
      await this.processJob(row.job_id);
    }
  }

  private async processJob(jobId: string): Promise<void> {
    this.log.info(`processJob: jobId=${jobId} running=${this.running}`);
    if (!this.running || this.inflight.has(jobId)) {
      this.log.info(`processJob: skipped - running=${this.running} inflight=${this.inflight.has(jobId)}`);
      return;
    }

    const row = await this.db.get<DeliveryJobRow>(`SELECT * FROM channel_delivery_jobs WHERE job_id = ?`, [jobId]);
    this.log.info(`processJob: row status=${row?.status}`);
    if (!row || row.status === 'sent') {
      return;
    }

    if (!this.processor || !this.classifier) {
      throw new Error('DeliveryQueue is not started');
    }

    const job = this.toJob(row);
    const attempts = row.attempts + 1;
    this.inflight.add(jobId);

    await this.db.run(
      `UPDATE channel_delivery_jobs SET status = 'sending', attempts = ?, updated_at = ? WHERE job_id = ?`,
      [attempts, formatLocalTimestamp(new Date()), jobId]
    );

    try {
      const result = await this.processor({ ...job, attempts });
      await this.db.run(
        `UPDATE channel_delivery_jobs
         SET status = 'sent', retryable = 0, next_retry_at = NULL,
             platform_message_id = ?, error_code = NULL, error_message = NULL,
             updated_at = ?
         WHERE job_id = ?`,
        [result.platformMessageId || null, formatLocalTimestamp(new Date()), jobId]
      );
    } catch (error) {
      const classification = this.classifier(job, error);
      this.log.error(`Delivery failed for job=${jobId} channel=${job.channel} conversationId=${job.conversationId} attempts=${attempts}: ${classification.message || this.errorMessage(error)}`);
      const retryable = classification.retryable && attempts < (this.options.maxAttempts ?? 3);
      const nextRetryAt = retryable
        ? formatLocalTimestamp(new Date(Date.now() + Math.min(30_000, 1000 * Math.pow(2, attempts - 1))))
        : null;

      await this.db.run(
        `UPDATE channel_delivery_jobs
         SET status = 'failed', retryable = ?, next_retry_at = ?,
             error_code = ?, error_message = ?, updated_at = ?
         WHERE job_id = ?`,
        [
          retryable ? 1 : 0,
          nextRetryAt,
          classification.code,
          classification.message || this.errorMessage(error),
          formatLocalTimestamp(new Date()),
          jobId
        ]
      );
    } finally {
      this.inflight.delete(jobId);
    }
  }

  private toJob(row: DeliveryJobRow): DeliveryJob {
    return {
      jobId: row.job_id,
      idempotencyKey: row.idempotency_key,
      channel: row.channel,
      conversationId: row.conversation_id,
      payload: reviveMessage(JSON.parse(row.payload_json)),
      attempts: row.attempts
    };
  }

  private async getReceipt(jobId: string): Promise<DeliveryReceipt> {
    const row = await this.db.get<DeliveryJobRow>(`SELECT * FROM channel_delivery_jobs WHERE job_id = ?`, [jobId]);
    if (!row) {
      throw new Error(`Delivery job not found: ${jobId}`);
    }

    return {
      jobId: row.job_id,
      status: row.status,
      attempts: row.attempts,
      retryable: row.retryable === 1,
      platformMessageId: row.platform_message_id || undefined,
      errorCode: row.error_code || undefined,
      errorMessage: row.error_message || undefined
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
