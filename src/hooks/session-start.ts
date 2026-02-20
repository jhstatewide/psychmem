/**
 * SessionStart Hook - Context injection at session start
 * 
 * Retrieves relevant memories and formats them for context injection.
 * Uses progressive disclosure: shows index first, then details on demand.
 */

import type {
  MemoryUnit,
  RetrievalIndexItem,
  PsychMemConfig,
} from '../types/index.js';
import { DEFAULT_CONFIG } from '../types/index.js';
import { MemoryDatabase } from '../storage/database.js';

export class SessionStartHook {
  private db: MemoryDatabase;
  private config: PsychMemConfig;

  constructor(db: MemoryDatabase, config: Partial<PsychMemConfig> = {}) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate context to inject at session start
   * Uses progressive disclosure: index with summaries + strength
   */
  generateContext(project: string, workingDirectory?: string): string {
    // Normalise empty-string project to undefined (avoids matching orphan records)
    const projectScope = project?.trim() || undefined;

    // Get memories scoped to this project (user-level + project-specific)
    let memories = this.db.getMemoriesByScope(projectScope, this.config.defaultRetrievalLimit);

    // Fallback to global top memories when no scoped memories exist
    if (memories.length === 0) {
      memories = this.db.getTopMemories(this.config.defaultRetrievalLimit);
    }
    
    if (memories.length === 0) {
      return this.formatEmptyContext();
    }

    // Build progressive disclosure index
    const index = this.buildIndex(memories);
    
    // Format context
    return this.formatContext(index, project);
  }

  /**
   * Build retrieval index from memories
   */
  private buildIndex(memories: MemoryUnit[]): RetrievalIndexItem[] {
    return memories.map(mem => ({
      id: mem.id,
      summary: this.truncateSummary(mem.summary, 100),
      classification: mem.classification,
      store: mem.store,
      strength: mem.strength,
      estimatedTokens: this.estimateTokens(mem.summary),
      relevanceScore: mem.strength, // For now, use strength as relevance
    }));
  }

  /**
   * Truncate summary to max length
   */
  private truncateSummary(summary: string, maxLength: number): string {
    if (summary.length <= maxLength) return summary;
    return summary.slice(0, maxLength - 3) + '...';
  }

  /**
   * Estimate tokens (rough approximation: ~4 chars per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Format context for injection
   */
  private formatContext(index: RetrievalIndexItem[], project: string): string {
    const sections: string[] = [];
    
    // Header
    sections.push('# Memory Context');
    sections.push(`Project: ${project}`);
    sections.push(`Retrieved ${index.length} relevant memories.\n`);
    
    // Group by classification
    const grouped = this.groupByClassification(index);
    
    // Format each group
    for (const [classification, items] of Object.entries(grouped)) {
      if (items.length === 0) continue;
      
      const emoji = this.getClassificationEmoji(classification);
      sections.push(`## ${emoji} ${this.formatClassificationName(classification)}`);
      
      for (const item of items) {
        const strengthBar = this.formatStrengthBar(item.strength);
        const storeTag = item.store === 'ltm' ? '[LTM]' : '[STM]';
        sections.push(`- ${strengthBar} ${storeTag} ${item.summary}`);
        sections.push(`  ID: ${item.id.slice(0, 8)}... | ~${item.estimatedTokens} tokens`);
      }
      sections.push('');
    }
    
    // Footer with instructions
    sections.push('---');
    sections.push('*Use memory IDs to request full details if needed.*');
    
    return sections.join('\n');
  }

  /**
   * Format empty context
   */
  private formatEmptyContext(): string {
    return [
      '# Memory Context',
      'No relevant memories found for this session.',
      '',
      '*Memories will be captured as you work and available in future sessions.*',
    ].join('\n');
  }

  /**
   * Group index items by classification
   */
  private groupByClassification(index: RetrievalIndexItem[]): Record<string, RetrievalIndexItem[]> {
    const groups: Record<string, RetrievalIndexItem[]> = {
      bugfix: [],
      learning: [],
      decision: [],
      preference: [],
      constraint: [],
      procedural: [],
      semantic: [],
      episodic: [],
    };
    
    for (const item of index) {
      const classGroup = groups[item.classification];
      const episodicGroup = groups['episodic'];
      if (classGroup) {
        classGroup.push(item);
      } else if (episodicGroup) {
        episodicGroup.push(item);
      }
    }
    
    return groups;
  }

  /**
   * Format strength as visual bar
   */
  private formatStrengthBar(strength: number): string {
    const filled = Math.round(strength * 5);
    const empty = 5 - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  }

  /**
   * Get emoji for classification
   */
  private getClassificationEmoji(classification: string): string {
    const emojis: Record<string, string> = {
      bugfix: '🔴',
      learning: '🎓',
      decision: '🤔',
      preference: '⭐',
      constraint: '🚫',
      procedural: '📋',
      semantic: '💡',
      episodic: '📅',
    };
    return emojis[classification] ?? '📝';
  }

  /**
   * Format classification name for display
   */
  private formatClassificationName(classification: string): string {
    const names: Record<string, string> = {
      bugfix: 'Bugs & Fixes',
      learning: 'Learnings',
      decision: 'Decisions',
      preference: 'Preferences',
      constraint: 'Constraints',
      procedural: 'Procedures',
      semantic: 'Knowledge',
      episodic: 'Events',
    };
    return names[classification] ?? classification;
  }
}
