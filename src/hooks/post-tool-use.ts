/**
 * PostToolUse Hook - Capture tool execution events
 * 
 * Records tool usage for later memory extraction.
 * Lightweight hook - main processing happens at Stop.
 */

import type {
  PostToolUseData,
  PsychMemConfig,
} from '../types/index.js';
import { DEFAULT_CONFIG } from '../types/index.js';
import { MemoryDatabase } from '../storage/database.js';

export class PostToolUseHook {
  private db: MemoryDatabase;
  private config: PsychMemConfig;

  constructor(db: MemoryDatabase, config: Partial<PsychMemConfig> = {}) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Capture a tool use event
   */
  capture(sessionId: string, data: PostToolUseData): void {
    // Build content summary
    const content = this.buildContentSummary(data);
    
    // Store the event
    this.db.createEvent(
      sessionId,
      'PostToolUse',
      content,
      {
        toolName: data.toolName,
        toolInput: this.truncate(data.toolInput, 5000),
        toolOutput: this.truncate(data.toolOutput, 5000),
        metadata: {
          success: data.success,
          duration: data.duration,
          ...data.metadata,
        },
      }
    );
  }

  /**
   * Build a content summary for the event
   */
  private buildContentSummary(data: PostToolUseData): string {
    const parts: string[] = [];
    
    // Tool name and status
    const status = data.success ? 'succeeded' : 'failed';
    parts.push(`Tool: ${data.toolName} (${status})`);
    
    // Add input preview
    if (data.toolInput) {
      const inputPreview = this.truncate(data.toolInput, 200);
      parts.push(`Input: ${inputPreview}`);
    }
    
    // Add output preview (especially important for errors)
    if (data.toolOutput) {
      const outputPreview = this.truncate(data.toolOutput, 500);
      parts.push(`Output: ${outputPreview}`);
    }
    
    // Add duration if available
    if (data.duration) {
      parts.push(`Duration: ${data.duration}ms`);
    }
    
    return parts.join('\n');
  }

  /**
   * Truncate string to max length
   */
  private truncate(str: string, maxLength: number): string {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
  }
}
