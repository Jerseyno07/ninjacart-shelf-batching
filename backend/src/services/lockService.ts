import type { Pool } from "pg";
import { config } from "../config.js";
import { LockConflictError, ForbiddenError } from "../lib/errors.js";

export interface LockRow {
  fsn: string;
  labour_id: string;
  acquired_at: string;
  expires_at: string;
  released_at: string | null;
}

/**
 * Acquire (or extend) the FSN-level lock described in
 * docs/02-adr-001-fsn-level-locking.md. This is the ONE statement the ADR's
 * correctness depends on — do not replace it with a read-then-write.
 */
export async function acquireLock(
  pool: Pool,
  fsn: string,
  labourId: string
): Promise<LockRow> {
  const result = await pool.query<LockRow>(
    `INSERT INTO fsn_locks (fsn, labour_id, acquired_at, expires_at, released_at)
     VALUES ($1, $2, now(), now() + ($3 * interval '1 minute'), NULL)
     ON CONFLICT (fsn) DO UPDATE
       SET labour_id = EXCLUDED.labour_id,
           acquired_at = now(),
           expires_at = EXCLUDED.expires_at,
           released_at = NULL
       WHERE fsn_locks.expires_at < now()
     RETURNING *`,
    [fsn, labourId, config.LOCK_LEASE_MINUTES]
  );

  if (result.rowCount === 0) {
    const holder = await pool.query<{ labour_id: string; labour_name: string; expires_at: string }>(
      `SELECT fl.labour_id, u.name AS labour_name, fl.expires_at
       FROM fsn_locks fl
       JOIN users u ON u.id = fl.labour_id
       WHERE fl.fsn = $1`,
      [fsn]
    );
    const row = holder.rows[0];
    throw new LockConflictError(
      `FSN ${fsn} is currently locked by another user`,
      row
        ? { labourId: row.labour_id, labourName: row.labour_name, expiresAt: row.expires_at }
        : { labourId: "unknown", labourName: "unknown", expiresAt: new Date().toISOString() }
    );
  }

  await logLockEvent(pool, fsn, labourId, "acquired");
  return result.rows[0]!;
}

/** Heartbeat extends the lease. Only the current holder can extend it. */
export async function heartbeat(pool: Pool, fsn: string, labourId: string): Promise<LockRow> {
  const result = await pool.query<LockRow>(
    `UPDATE fsn_locks
     SET expires_at = now() + ($3 * interval '1 minute')
     WHERE fsn = $1 AND labour_id = $2 AND released_at IS NULL AND expires_at >= now()
     RETURNING *`,
    [fsn, labourId, config.LOCK_LEASE_MINUTES]
  );

  if (result.rowCount === 0) {
    throw new ForbiddenError(`No active lock held by this user on FSN ${fsn} to extend`);
  }

  await logLockEvent(pool, fsn, labourId, "heartbeat");
  return result.rows[0]!;
}

/** Explicit release — the labourer closed out of the FSN. */
export async function releaseLock(pool: Pool, fsn: string, labourId: string): Promise<void> {
  const result = await pool.query(
    `UPDATE fsn_locks
     SET released_at = now(), expires_at = now()
     WHERE fsn = $1 AND labour_id = $2 AND released_at IS NULL`,
    [fsn, labourId]
  );

  if (result.rowCount && result.rowCount > 0) {
    await logLockEvent(pool, fsn, labourId, "released");
  }
}

/** Supervisor backstop — fully audited, never a silent unlock. */
export async function forceUnlock(
  pool: Pool,
  fsn: string,
  actorId: string,
  reason: string
): Promise<void> {
  const current = await pool.query<{ labour_id: string }>(
    `SELECT labour_id FROM fsn_locks WHERE fsn = $1 AND released_at IS NULL`,
    [fsn]
  );

  await pool.query(
    `UPDATE fsn_locks SET released_at = now(), expires_at = now() WHERE fsn = $1`,
    [fsn]
  );

  const labourId = current.rows[0]?.labour_id ?? actorId;
  await pool.query(
    `INSERT INTO fsn_lock_events (fsn, labour_id, event_type, actor_id, reason)
     VALUES ($1, $2, 'force_unlocked', $3, $4)`,
    [fsn, labourId, actorId, reason]
  );
}

async function logLockEvent(
  pool: Pool,
  fsn: string,
  labourId: string,
  eventType: "acquired" | "heartbeat" | "released" | "expired"
): Promise<void> {
  await pool.query(
    `INSERT INTO fsn_lock_events (fsn, labour_id, event_type) VALUES ($1, $2, $3)`,
    [fsn, labourId, eventType]
  );
}

/** Supervisor visibility: currently held (unreleased, unexpired) locks. */
export async function listActiveLocks(pool: Pool) {
  const result = await pool.query(
    `SELECT fl.fsn, fl.labour_id, u.name AS labour_name, fl.acquired_at, fl.expires_at
     FROM fsn_locks fl
     JOIN users u ON u.id = fl.labour_id
     WHERE fl.released_at IS NULL AND fl.expires_at >= now()
     ORDER BY fl.acquired_at ASC`
  );
  return result.rows;
}
