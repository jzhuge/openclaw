import type { MemoryCategory } from "../config.js";

/**
 * A record stored in lance-context.
 * Corresponds to the normalized dict from Python's _normalize_record().
 */
export type ContextRecord = {
  id: string | null;
  run_id: string | null;
  bot_id: string | null;
  session_id: string | null;
  role: string | null;
  content_type: string | null;
  text: string | null;
  binary: Uint8Array | null;
  embedding: number[] | null;
  created_at: Date | null;
  state_metadata: Record<string, unknown> | null;
};

/**
 * A search result with distance score.
 * Corresponds to the normalized dict from Python's _normalize_search_hit().
 */
export type SearchHit = ContextRecord & {
  distance: number | null;
};

/**
 * Parameters for adding a record to the context.
 */
export type AddParams = {
  role: string;
  content: string;
  embedding?: number[];
  bot_id?: string;
  session_id?: string;
};

/**
 * Parameters for searching the context.
 */
export type SearchParams = {
  query: number[];
  limit?: number;
};

/**
 * Parameters for listing records.
 */
export type ListParams = {
  limit?: number;
  offset?: number;
};

/**
 * Parameters for compaction.
 */
export type CompactParams = {
  target_rows_per_fragment?: number;
  materialize_deletions?: boolean;
};

/**
 * Metrics returned from compaction.
 */
export type CompactionMetrics = {
  fragments_removed: number;
  fragments_added: number;
  files_removed: number;
  files_added: number;
};

/**
 * Stats returned from compaction_stats().
 */
export type CompactionStats = {
  total_fragments: number;
  is_compacting: boolean;
  last_compaction: string | null;
  last_error: string | null;
  total_compactions: number;
};

/**
 * Memory entry stored in the database.
 * Similar to memory-lancedb but includes versioning metadata.
 */
export type MemoryEntry = {
  id: string;
  text: string;
  vector: number[];
  importance: number;
  category: MemoryCategory;
  createdAt: number;
  sessionId?: string;
};

/**
 * Memory search result with score.
 */
export type MemorySearchResult = {
  entry: MemoryEntry;
  score: number;
  distance: number;
};
