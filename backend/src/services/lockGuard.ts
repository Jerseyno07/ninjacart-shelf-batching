import type { Pool } from "pg";
import { ForbiddenError } from "../lib/errors.js";

/**
 * The FSN lock governs who may open the darkstore list / submit for an FSN
 * (docs/02-adr-001-fsn-level-locking.md). This is a server-side UI-access
 * gate, separate from (and in addition to) the atomic check-then-insert in
 * ledgerService, which is the actual correctness guarantee.
 */
export async function assertHoldsLock(pool: Pool, fsn: string, labourId: string): Promise<void> {
  const result = await pool.query(
    `SELECT 1 FROM fsn_locks
     WHERE fsn = $1 AND labour_id = $2 AND released_at IS NULL AND expires_at >= now()`,
    [fsn, labourId]
  );
  if (result.rowCount === 0) {
    throw new ForbiddenError(`You must hold the lock on FSN ${fsn} to do this`);
  }
}
