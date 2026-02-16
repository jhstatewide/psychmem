/**
 * Retrieval Layer - Progressive disclosure memory retrieval
 * 
 * Implements a two-level retrieval system:
 * 1. Index level: Lightweight list of memories (id, summary, strength, cost)
 * 2. Detail level: Full memory content on demand
 * 
 * This saves tokens by only loading full content when needed.
 */

import type {
  MemoryUnit,
  RetrievalQuery,
  RetrievalIndexItem,
  RetrievalDetail,
  RetrievalFilters,
  PsychMemConfig,
} from '../types/index.js';
import { DEFAULT_CONFIG } from '../types/index.js';
import { MemoryDatabase } from '../storage/database.js';

/**
 * Options for scope-aware retrieval
 */
export interface ScopedRetrievalOptions {
  /** Current project path (used to filter project-level memories) */
  currentProject?: string;
  /** Maximum memories to return */
  limit?: number;
}

export class MemoryRetrieval {
  private db: MemoryDatabase;
  private config: PsychMemConfig;

  constructor(db: MemoryDatabase, config: Partial<PsychMemConfig> = {}) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Retrieve memory index (lightweight)
   * Returns summaries + metadata without full content
   */
  retrieveIndex(query: RetrievalQuery): RetrievalIndexItem[] {
    const limit = query.limit ?? this.config.defaultRetrievalLimit;
    
    // Get memories based on filters
    let memories = this.getFilteredMemories(query.filters, limit * 2); // Get extra for ranking
    
    // If we have a query embedding, use vector search
    if (query.embedding) {
      memories = this.rankByEmbedding(memories, query.embedding);
    }
    
    // If we have a text query, use text similarity
    if (query.query) {
      memories = this.rankByTextSimilarity(memories, query.query);
    }
    
    // Take top results and convert to index items
    return memories.slice(0, limit).map(mem => this.toIndexItem(mem, query.query));
  }

  /**
   * Retrieve full memory details for specific IDs
   */
  retrieveDetails(memoryIds: string[], sessionId?: string): RetrievalDetail[] {
    const details: RetrievalDetail[] = [];
    
    for (const id of memoryIds) {
      const memory = this.db.getMemory(id);
      if (!memory) continue;
      
      // Log retrieval if we have a session
      if (sessionId) {
        this.db.logRetrieval(sessionId, id, 'detail_request', memory.strength);
      }
      
      // Increment access frequency
      this.db.incrementFrequency(id);
      
      details.push({
        ...memory,
        relevanceScore: memory.strength,
        retrievalReason: 'Requested by ID',
      });
    }
    
    return details;
  }

  /**
   * Search memories by text query
   */
  search(query: string, filters?: RetrievalFilters, limit?: number): RetrievalIndexItem[] {
    return this.retrieveIndex({
      query,
      filters,
      limit: limit ?? this.config.defaultRetrievalLimit,
    });
  }

  /**
   * Get memory details by ID
   */
  getMemory(id: string): MemoryUnit | null {
    return this.db.getMemory(id);
  }

  /**
   * Get filtered memories based on query filters
   */
  private getFilteredMemories(filters?: RetrievalFilters, limit?: number): MemoryUnit[] {
    if (!filters) {
      return this.db.getTopMemories(limit ?? 50);
    }
    
    // Start with all active memories
    let memories = this.db.getTopMemories(limit ?? 100);
    
    // Apply filters
    if (filters.store) {
      memories = memories.filter(m => m.store === filters.store);
    }
    
    if (filters.classifications && filters.classifications.length > 0) {
      memories = memories.filter(m => filters.classifications!.includes(m.classification));
    }
    
    if (filters.minStrength !== undefined) {
      memories = memories.filter(m => m.strength >= filters.minStrength!);
    }
    
    if (filters.tags && filters.tags.length > 0) {
      memories = memories.filter(m => 
        filters.tags!.some(tag => m.tags.includes(tag))
      );
    }
    
    if (filters.since) {
      memories = memories.filter(m => m.createdAt >= filters.since!);
    }
    
    return memories;
  }

  /**
   * Rank memories by embedding similarity
   */
  private rankByEmbedding(memories: MemoryUnit[], queryEmbedding: number[]): MemoryUnit[] {
    // Use vector search
    const results = this.db.searchByEmbedding(queryEmbedding, memories.length);
    
    // Create a map of memory ID to distance
    const distanceMap = new Map(results.map(r => [r.memoryId, r.distance]));
    
    // Sort by distance (lower is better)
    return memories.sort((a, b) => {
      const distA = distanceMap.get(a.id) ?? 999;
      const distB = distanceMap.get(b.id) ?? 999;
      return distA - distB;
    });
  }

  /**
   * Rank memories by text similarity to query
   */
  private rankByTextSimilarity(memories: MemoryUnit[], query: string): MemoryUnit[] {
    // Calculate similarity scores
    const scored = memories.map(mem => ({
      memory: mem,
      score: this.calculateRelevance(mem, query),
    }));
    
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    
    return scored.map(s => s.memory);
  }

  /**
   * Calculate relevance score for a memory given a query
   */
  private calculateRelevance(memory: MemoryUnit, query: string): number {
    // Base score is memory strength
    let score = memory.strength;
    
    // Text similarity bonus
    const textSimilarity = this.jaccardSimilarity(
      memory.summary.toLowerCase(),
      query.toLowerCase()
    );
    score += textSimilarity * 0.3;
    
    // Tag match bonus
    const queryTerms = query.toLowerCase().split(/\s+/);
    const tagMatches = memory.tags.filter(tag => 
      queryTerms.some(term => tag.toLowerCase().includes(term))
    ).length;
    score += tagMatches * 0.1;
    
    // Recency bonus (slight preference for recent memories)
    const ageHours = (Date.now() - memory.createdAt.getTime()) / (1000 * 60 * 60);
    const recencyBonus = Math.max(0, 0.1 - ageHours / 1000);
    score += recencyBonus;
    
    return Math.min(1, score);
  }

  /**
   * Jaccard similarity between two strings
   */
  private jaccardSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2));
    
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    
    return intersection.size / union.size;
  }

  /**
   * Convert memory to index item
   */
  private toIndexItem(memory: MemoryUnit, query?: string): RetrievalIndexItem {
    return {
      id: memory.id,
      summary: memory.summary,
      classification: memory.classification,
      store: memory.store,
      strength: memory.strength,
      estimatedTokens: this.estimateTokens(memory.summary),
      relevanceScore: query ? this.calculateRelevance(memory, query) : memory.strength,
    };
  }

  /**
   * Estimate tokens for a text (rough: ~4 chars per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Format index for context injection
   */
  formatIndexForContext(index: RetrievalIndexItem[]): string {
    if (index.length === 0) {
      return 'No relevant memories found.';
    }

    const lines: string[] = ['Available memories:'];
    
    for (const item of index) {
      const bar = this.formatStrengthBar(item.strength);
      const store = item.store === 'ltm' ? 'LTM' : 'STM';
      lines.push(`${bar} [${store}] ${item.summary}`);
      lines.push(`    ID: ${item.id.slice(0, 8)} | ${item.classification} | ~${item.estimatedTokens} tokens`);
    }

    lines.push('');
    lines.push('Use memory ID to request full details.');
    
    return lines.join('\n');
  }

  /**
   * Format strength as visual bar
   */
  private formatStrengthBar(strength: number): string {
    const filled = Math.round(strength * 5);
    const empty = 5 - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  }

  // ===========================================================================
  // Scope-Aware Retrieval (v1.6)
  // ===========================================================================

  /**
   * Get memories filtered by scope for context injection.
   * Returns:
   * - All user-level memories (constraint, preference, learning, procedural)
   * - Project-level memories only if they match the current project
   * 
   * @param options - Scoped retrieval options
   */
  retrieveByScope(options: ScopedRetrievalOptions = {}): MemoryUnit[] {
    const limit = options.limit ?? this.config.defaultRetrievalLimit;
    return this.db.getMemoriesByScope(options.currentProject, limit);
  }

  /**
   * Get only user-level memories (always applicable)
   */
  retrieveUserLevel(limit?: number): MemoryUnit[] {
    return this.db.getUserLevelMemories(limit ?? this.config.defaultRetrievalLimit);
  }

  /**
   * Get project-specific memories
   */
  retrieveProjectLevel(project: string, limit?: number): MemoryUnit[] {
    return this.db.getProjectMemories(project, limit ?? this.config.defaultRetrievalLimit);
  }

  /**
   * Search memories with scope filtering
   * Combines text relevance ranking with scope-based filtering
   */
  searchByScope(
    query: string,
    options: ScopedRetrievalOptions = {}
  ): RetrievalIndexItem[] {
    const limit = options.limit ?? this.config.defaultRetrievalLimit;
    
    // Get scope-filtered memories
    let memories = this.db.getMemoriesByScope(options.currentProject, limit * 2);
    
    // If we have a text query, rank by similarity
    if (query) {
      memories = this.rankByTextSimilarity(memories, query);
    }
    
    // Take top results and convert to index items
    return memories.slice(0, limit).map(mem => this.toIndexItem(mem, query));
  }

  /**
   * Format memories for context injection with scope grouping
   */
  formatMemoriesWithScope(memories: MemoryUnit[], currentProject?: string): string {
    if (memories.length === 0) {
      return 'No relevant memories found.';
    }

    const lines: string[] = [];
    
    // Separate user-level and project-level memories
    const userLevel = memories.filter(m => 
      ['constraint', 'preference', 'learning', 'procedural'].includes(m.classification)
    );
    const projectLevel = memories.filter(m => 
      !['constraint', 'preference', 'learning', 'procedural'].includes(m.classification)
    );
    
    if (userLevel.length > 0) {
      lines.push('## User Preferences & Constraints');
      lines.push('');
      for (const mem of userLevel) {
        const bar = this.formatStrengthBar(mem.strength);
        const store = mem.store === 'ltm' ? 'LTM' : 'STM';
        lines.push(`${bar} [${store}] [${mem.classification}] ${mem.summary}`);
      }
      lines.push('');
    }
    
    if (projectLevel.length > 0) {
      const projectName = currentProject ? currentProject.split(/[/\\]/).pop() : 'Current Project';
      lines.push(`## ${projectName} Context`);
      lines.push('');
      for (const mem of projectLevel) {
        const bar = this.formatStrengthBar(mem.strength);
        const store = mem.store === 'ltm' ? 'LTM' : 'STM';
        lines.push(`${bar} [${store}] [${mem.classification}] ${mem.summary}`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
}
