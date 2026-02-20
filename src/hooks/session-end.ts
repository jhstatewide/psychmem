/**
 * SessionEnd Hook - Consolidation and cleanup
 * 
 * Runs at the end of a session to:
 * 1. Apply decay to all memories
 * 2. Run STM → LTM consolidation
 * 3. Update session status
 * 4. Clean up old decayed memories
 */

import type {
  SessionEndData,
  PsychMemConfig,
} from '../types/index.js';
import { DEFAULT_CONFIG } from '../types/index.js';
import { MemoryDatabase } from '../storage/database.js';
import { SelectiveMemory } from '../memory/selective-memory.js';

export interface SessionEndResult {
  promoted: number;
  decayed: number;
  cleaned: number;
}

export class SessionEndHook {
  private db: MemoryDatabase;
  private config: PsychMemConfig;
  private selectiveMemory: SelectiveMemory;

  constructor(db: MemoryDatabase, config: Partial<PsychMemConfig> = {}) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.selectiveMemory = new SelectiveMemory(db, this.config);
  }

  /**
   * Process session end
   */
  process(sessionId: string, data: SessionEndData): SessionEndResult {
    // Determine session end status
    const sessionStatus = data.reason === 'abandoned' ? 'abandoned' : 'completed';

    // Wrap decay + consolidation in a single atomic transaction
    this.db.beginTransaction();
    let decayResult: { memoriesDecayed: number };
    let consolidationResult: { promoted: string[] };
    try {
      // End the session
      this.db.endSession(sessionId, sessionStatus);

      // Apply decay to all memories
      decayResult = this.selectiveMemory.applyDecay();

      // Run consolidation (STM → LTM)
      consolidationResult = this.selectiveMemory.runConsolidation();

      this.db.commitTransaction();
    } catch (err) {
      this.db.rollbackTransaction();
      throw err;
    }

    // Clean up old decayed memories (optional, based on config)
    const cleaned = this.cleanupDecayedMemories();

    return {
      promoted: consolidationResult.promoted.length,
      decayed: decayResult.memoriesDecayed,
      cleaned,
    };
  }

  /**
   * Clean up memories that have been decayed for too long
   * We don't delete them permanently, but we could archive them
   */
  private cleanupDecayedMemories(): number {
    // For v1, we don't delete decayed memories - just count them
    // In future versions, we might:
    // - Archive to a cold storage
    // - Compress/summarize old episodic memories
    // - Merge similar semantic memories
    
    return 0;
  }
}
