/**
 * PsychMem - Main Entry Point
 * 
 * Psych-grounded selective memory system for AI agents
 * 
 * Usage:
 *   psychmem hook <json-input>    Process a hook event
 *   psychmem search <query>       Search memories
 *   psychmem get <id>             Get memory details
 *   psychmem stats                Show memory stats
 *   psychmem decay                Apply decay to all memories
 *   psychmem consolidate          Run STM→LTM consolidation
 */

import { PsychMemHooks, createPsychMemHooks } from './hooks/index.js';
import { MemoryRetrieval } from './retrieval/index.js';
import { MemoryDatabase, createMemoryDatabase } from './storage/database.js';
import type { HookInput, PsychMemConfig, MemoryUnit } from './types/index.js';
import { DEFAULT_CONFIG } from './types/index.js';

export class PsychMem {
  private hooks!: PsychMemHooks;
  private retrieval!: MemoryRetrieval;
  private db!: MemoryDatabase;
  private config: PsychMemConfig;
  private initialized: boolean = false;
  private _externalDb?: MemoryDatabase;

  constructor(config: Partial<PsychMemConfig> = {}, db?: MemoryDatabase) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (db) {
      this._externalDb = db;
    }
  }

  /**
   * Initialize the PsychMem instance (must be called before use)
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    
    this.db = this._externalDb ?? await createMemoryDatabase(this.config);
    this.hooks = await createPsychMemHooks(this.config, this.db);
    this.retrieval = new MemoryRetrieval(this.db, this.config);
    this.initialized = true;
  }

  /**
   * Ensure instance is initialized
   */
  private ensureInit(): void {
    if (!this.initialized) {
      throw new Error('PsychMem not initialized. Call await psychmem.init() first.');
    }
  }

  /**
   * Process a hook event
   */
  async handleHook(input: HookInput) {
    this.ensureInit();
    return this.hooks.handle(input);
  }

  /**
   * Search memories
   */
  search(query: string, limit?: number) {
    this.ensureInit();
    return this.retrieval.search(query, undefined, limit);
  }

  /**
   * Get memory by ID
   */
  getMemory(id: string) {
    this.ensureInit();
    return this.retrieval.getMemory(id);
  }

  /**
   * Get memory details for multiple IDs
   */
  getMemories(ids: string[], sessionId?: string) {
    this.ensureInit();
    return this.retrieval.retrieveDetails(ids, sessionId);
  }

  /**
   * Get memory stats
   */
  getStats() {
    this.ensureInit();
    const stmMemories = this.db.getMemoriesByStore('stm');
    const ltmMemories = this.db.getMemoriesByStore('ltm');
    
    return {
      stm: {
        count: stmMemories.length,
        avgStrength: this.avgStrength(stmMemories),
      },
      ltm: {
        count: ltmMemories.length,
        avgStrength: this.avgStrength(ltmMemories),
      },
      total: stmMemories.length + ltmMemories.length,
    };
  }

  /**
   * Apply decay to all memories
   */
  applyDecay() {
    this.ensureInit();
    return this.db.applyDecay();
  }

  /**
   * Run consolidation
   */
  runConsolidation() {
    this.ensureInit();
    return this.db.runConsolidation();
  }

  /**
   * Pin a memory (prevent decay)
   */
  pinMemory(id: string) {
    this.ensureInit();
    this.db.addFeedback('pin', id);
  }

  /**
   * Forget a memory
   */
  forgetMemory(id: string) {
    this.ensureInit();
    this.db.addFeedback('forget', id);
  }

  /**
   * Remember a memory (boost importance + promote to LTM)
   */
  rememberMemory(id: string) {
    this.ensureInit();
    this.db.addFeedback('remember', id);
  }

  /**
   * Close database connection
   */
  close() {
    if (this.initialized) {
      this.db.close();
      this.hooks.close();
    }
  }

  private avgStrength(memories: MemoryUnit[]): number {
    if (memories.length === 0) return 0;
    return memories.reduce((sum, m) => sum + m.strength, 0) / memories.length;
  }
}

/**
 * Create and initialize a PsychMem instance
 */
export async function createPsychMem(config: Partial<PsychMemConfig> = {}, db?: MemoryDatabase): Promise<PsychMem> {
  const psychmem = new PsychMem(config, db);
  await psychmem.init();
  return psychmem;
}

// Re-export types and utilities
export * from './types/index.js';
export { PsychMemHooks, createPsychMemHooks } from './hooks/index.js';
export { MemoryRetrieval } from './retrieval/index.js';
export { MemoryDatabase, createMemoryDatabase } from './storage/database.js';
export { ContextSweep } from './memory/context-sweep.js';
export { SelectiveMemory } from './memory/selective-memory.js';

// Re-export adapter types (excluding AgentType which is in types/index.js)
export type {
  OpenCodePluginContext,
  OpenCodeClient,
  OpenCodeSession,
  OpenCodeMessageContainer,
  OpenCodeMessageInfo,
  OpenCodeMessagePart,
  OpenCodeEvent,
  OpenCodePluginHooks,
  OpenCodePlugin,
  BunShell,
  PsychMemAdapter,
  AdapterOptions,
} from './adapters/types.js';

// Re-export adapters
export { createOpenCodePlugin, OpenCodeAdapter } from './adapters/opencode/index.js';
export { ClaudeCodeAdapter, createClaudeCodeAdapter } from './adapters/claude-code/index.js';
