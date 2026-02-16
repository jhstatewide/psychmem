/**
 * Selective Memory - Stage 2 of the selective memory pipeline
 * 
 * Scores memory candidates using psych + math features:
 * - Recency, Frequency, Importance, Utility, Novelty, Confidence, Interference
 * 
 * Handles:
 * - Rule-based scoring (v1)
 * - STM/LTM allocation
 * - Consolidation (STM → LTM promotion)
 * - Reconsolidation (updating LTM with new evidence)
 */

import type {
  MemoryUnit,
  MemoryCandidate,
  MemoryStore,
  MemoryClassification,
  MemoryFeatureVector,
  ScoringWeights,
  PsychMemConfig,
} from '../types/index.js';
import { DEFAULT_CONFIG, isUserLevelClassification } from '../types/index.js';
import { MemoryDatabase } from '../storage/database.js';

export class SelectiveMemory {
  private db: MemoryDatabase;
  private config: PsychMemConfig;

  constructor(db: MemoryDatabase, config: Partial<PsychMemConfig> = {}) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // Memory Allocation (STM vs LTM)
  // ===========================================================================

  /**
   * Process memory candidates and allocate to STM or LTM
   * @param candidates Memory candidates to process
   * @param options Optional processing options (e.g., sessionId for deduplication tracking, projectScope for v1.6)
   */
  processCandidates(
    candidates: MemoryCandidate[],
    options?: { sessionId?: string; projectScope?: string }
  ): MemoryUnit[] {
    const createdMemories: MemoryUnit[] = [];

    for (const candidate of candidates) {
      // Check if this should auto-promote to LTM
      const shouldAutoPromote = this.config.autoPromoteToLtm.includes(candidate.classification);
      
      // Calculate initial store
      const store: MemoryStore = shouldAutoPromote ? 'ltm' : 'stm';
      
      // Calculate feature scores
      const features = this.calculateFeatures(candidate);
      
      // Calculate initial strength
      const strength = this.calculateStrength(features);
      
      // Check for interference with existing memories
      const interference = this.detectInterference(candidate);
      
      // Determine project scope based on classification (v1.6)
      // User-level memories (constraint, preference, learning, procedural) don't have a project scope
      // Project-level memories (decision, bugfix, episodic, semantic) get the current project scope
      const memoryProjectScope = isUserLevelClassification(candidate.classification) 
        ? undefined 
        : options?.projectScope;
      
      // Create the memory unit
      const memory = this.db.createMemory(
        store,
        candidate.classification,
        candidate.summary,
        candidate.sourceEventIds,
        {
          ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
          ...(memoryProjectScope ? { projectScope: memoryProjectScope } : {}),
          importance: candidate.preliminaryImportance,
          utility: 0.5, // Will be updated based on usage
          novelty: features.novelty,
          confidence: candidate.confidence,
          tags: this.extractTags(candidate),
        }
      );

      // Update with interference if detected
      if (interference > 0) {
        this.db.updateMemoryStrength(memory.id, strength * (1 - interference * 0.2));
      }

      createdMemories.push(memory);
    }

    return createdMemories;
  }

  /**
   * Calculate feature vector for a candidate
   */
  private calculateFeatures(candidate: MemoryCandidate): MemoryFeatureVector {
    return {
      recency: 0, // Just created
      frequency: 1, // First occurrence
      importance: candidate.preliminaryImportance,
      utility: 0.5, // Unknown until used
      novelty: this.calculateNovelty(candidate),
      confidence: candidate.confidence,
      interference: 0, // Calculated separately
    };
  }

  /**
   * Calculate novelty score based on similarity to existing memories
   */
  private calculateNovelty(candidate: MemoryCandidate): number {
    const existingMemories = this.db.getTopMemories(50);
    
    if (existingMemories.length === 0) {
      return 1.0; // Everything is novel when memory is empty
    }

    // Calculate similarity to existing memories
    let maxSimilarity = 0;
    for (const mem of existingMemories) {
      const similarity = this.calculateTextSimilarity(candidate.summary, mem.summary);
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }

    // Novelty is inverse of similarity
    return 1 - maxSimilarity;
  }

  /**
   * Detect interference with existing memories
   */
  private detectInterference(candidate: MemoryCandidate): number {
    const existingMemories = this.db.getTopMemories(50);
    
    // Look for conflicting information
    let interference = 0;
    
    for (const mem of existingMemories) {
      // Check for potential conflicts (same topic, different content)
      const topicSimilarity = this.calculateTextSimilarity(candidate.summary, mem.summary);
      
      if (topicSimilarity > 0.3 && topicSimilarity < 0.8) {
        // Similar topic but different content = potential conflict
        interference = Math.max(interference, topicSimilarity * 0.5);
      }
    }

    return interference;
  }

  /**
   * Calculate strength from feature vector (rule-based v1)
   */
  calculateStrength(features: MemoryFeatureVector): number {
    const w = this.config.scoringWeights;
    
    // Normalize frequency (log scale)
    const normalizedFrequency = Math.min(1, Math.log(features.frequency + 1) / Math.log(10));
    
    // Recency factor (0 = now, 1 = old)
    const recencyFactor = 1 - Math.min(1, features.recency / 168); // 168 hours = 1 week
    
    const strength =
      w.recency * recencyFactor +
      w.frequency * normalizedFrequency +
      w.importance * features.importance +
      w.utility * features.utility +
      w.novelty * features.novelty +
      w.confidence * features.confidence +
      w.interference * features.interference; // Negative weight

    return Math.max(0, Math.min(1, strength));
  }

  // ===========================================================================
  // Consolidation (STM → LTM)
  // ===========================================================================

  /**
   * Check and promote eligible STM memories to LTM
   * Based on:
   * - Strength threshold
   * - Frequency threshold
   * - Auto-promote classifications
   */
  runConsolidation(): ConsolidationResult {
    const stmMemories = this.db.getMemoriesByStore('stm');
    const result: ConsolidationResult = {
      promoted: [],
      decayed: [],
      unchanged: [],
    };

    for (const mem of stmMemories) {
      // Check promotion criteria
      const shouldPromote = this.shouldPromoteToLtm(mem);
      
      if (shouldPromote) {
        this.db.promoteToLtm(mem.id);
        result.promoted.push(mem.id);
      } else if (mem.strength < 0.1) {
        // Too weak, mark as decayed
        this.db.updateMemoryStatus(mem.id, 'decayed');
        result.decayed.push(mem.id);
      } else {
        result.unchanged.push(mem.id);
      }
    }

    return result;
  }

  /**
   * Determine if a memory should be promoted to LTM
   */
  private shouldPromoteToLtm(memory: MemoryUnit): boolean {
    // Auto-promote certain classifications
    if (this.config.autoPromoteToLtm.includes(memory.classification)) {
      return true;
    }

    // Promote based on strength
    if (memory.strength >= this.config.stmToLtmStrengthThreshold) {
      return true;
    }

    // Promote based on frequency (spaced repetition)
    if (memory.frequency >= this.config.stmToLtmFrequencyThreshold) {
      return true;
    }

    return false;
  }

  // ===========================================================================
  // Reconsolidation (Updating LTM)
  // ===========================================================================

  /**
   * Update existing LTM memory with new evidence
   * This implements reconsolidation - updating memories when new info conflicts
   */
  reconsolidate(memoryId: string, newEvidence: {
    content: string;
    confidence: number;
    sourceEventId: string;
  }): ReconsolidationResult {
    const memory = this.db.getMemory(memoryId);
    if (!memory) {
      return { success: false, reason: 'Memory not found' };
    }

    if (memory.status === 'pinned') {
      return { success: false, reason: 'Memory is pinned and cannot be reconsolidated' };
    }

    // Check if new evidence conflicts with existing memory
    const similarity = this.calculateTextSimilarity(newEvidence.content, memory.summary);
    
    if (similarity < 0.3) {
      // Conflicting information - update the memory
      // In v1, we'll just add the new evidence and adjust confidence
      // In v2, we might create a new version or merge
      
      // Adjust confidence based on conflict
      const newConfidence = (memory.confidence + newEvidence.confidence) / 2 * 0.8;
      
      // Update memory with note about conflict
      const updatedSummary = `${memory.summary} [Updated: ${newEvidence.content}]`;
      
      return {
        success: true,
        updated: true,
        oldConfidence: memory.confidence,
        newConfidence,
        conflict: true,
      };
    } else if (similarity > 0.7) {
      // Reinforcing information - boost confidence
      const newConfidence = Math.min(1, memory.confidence + newEvidence.confidence * 0.1);
      
      // Increment frequency (spaced repetition)
      this.db.incrementFrequency(memoryId);
      
      return {
        success: true,
        updated: true,
        oldConfidence: memory.confidence,
        newConfidence,
        conflict: false,
        reinforced: true,
      };
    }

    return {
      success: true,
      updated: false,
      reason: 'No significant update needed',
    };
  }

  // ===========================================================================
  // Decay Management
  // ===========================================================================

  /**
   * Apply exponential decay to all memories
   * strength_t = strength_0 * exp(-lambda * dt)
   */
  applyDecay(): DecayResult {
    const decayedCount = this.db.applyDecay();
    return {
      memoriesDecayed: decayedCount,
      timestamp: new Date(),
    };
  }

  // ===========================================================================
  // Utility Functions
  // ===========================================================================

  /**
   * Update utility score based on retrieval usage
   */
  updateUtility(memoryId: string, wasUsed: boolean): void {
    const memory = this.db.getMemory(memoryId);
    if (!memory) return;

    // Simple utility update: increase if used, decrease if not
    const delta = wasUsed ? 0.1 : -0.05;
    const newUtility = Math.max(0, Math.min(1, memory.utility + delta));

    // Recalculate strength with new utility
    const features: MemoryFeatureVector = {
      recency: this.calculateRecency(memory.createdAt),
      frequency: memory.frequency,
      importance: memory.importance,
      utility: newUtility,
      novelty: memory.novelty,
      confidence: memory.confidence,
      interference: memory.interference,
    };

    const newStrength = this.calculateStrength(features);
    this.db.updateMemoryStrength(memoryId, newStrength);
  }

  /**
   * Calculate recency in hours
   */
  private calculateRecency(createdAt: Date): number {
    const now = new Date();
    return (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  }

  /**
   * Simple text similarity (Jaccard index)
   */
  private calculateTextSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    
    return intersection.size / union.size;
  }

  /**
   * Extract tags from candidate
   */
  private extractTags(candidate: MemoryCandidate): string[] {
    const tags: string[] = [candidate.classification];
    
    // Add signal-based tags
    for (const signal of candidate.importanceSignals) {
      if (!tags.includes(signal.type)) {
        tags.push(signal.type);
      }
    }
    
    return tags;
  }
}

// ===========================================================================
// Result Types
// ===========================================================================

export interface ConsolidationResult {
  promoted: string[];
  decayed: string[];
  unchanged: string[];
}

export interface ReconsolidationResult {
  success: boolean;
  updated?: boolean;
  oldConfidence?: number;
  newConfidence?: number;
  conflict?: boolean;
  reinforced?: boolean;
  reason?: string;
}

export interface DecayResult {
  memoriesDecayed: number;
  timestamp: Date;
}
