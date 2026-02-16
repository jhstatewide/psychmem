/**
 * Transcript Parser for Claude Code
 * 
 * Parses Claude Code's JSONL transcript files incrementally using watermark tracking.
 * The watermark is a byte offset to avoid re-processing already-seen content.
 * 
 * Claude Code transcript format (JSONL):
 * Each line is a JSON object with various message types. Schema is not fully documented,
 * so we use flexible parsing with fallback handling.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a single entry in the transcript
 */
export interface TranscriptEntry {
  type: TranscriptEntryType;
  timestamp?: string;
  content: string;
  role?: 'user' | 'assistant' | 'system' | 'tool';
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  rawJson: Record<string, unknown>;
}

export type TranscriptEntryType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_use'
  | 'tool_result'
  | 'system'
  | 'unknown';

/**
 * Result of incremental parsing
 */
export interface ParseResult {
  entries: TranscriptEntry[];
  newWatermark: number;  // New byte offset after parsing
  linesProcessed: number;
}

// =============================================================================
// Parser Implementation
// =============================================================================

export class TranscriptParser {
  /**
   * Parse transcript file from a given byte offset
   * Returns entries from that point forward and the new watermark
   */
  async parseFromWatermark(
    transcriptPath: string,
    watermark: number = 0
  ): Promise<ParseResult> {
    // Resolve path if needed
    const resolvedPath = this.resolvePath(transcriptPath);
    
    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return {
        entries: [],
        newWatermark: watermark,
        linesProcessed: 0,
      };
    }

    const entries: TranscriptEntry[] = [];
    let newWatermark = watermark;
    let linesProcessed = 0;

    // Open file and seek to watermark position
    const fileHandle = await fs.promises.open(resolvedPath, 'r');
    
    try {
      const stats = await fileHandle.stat();
      
      // If watermark is beyond file size, no new content
      if (watermark >= stats.size) {
        return {
          entries: [],
          newWatermark: watermark,
          linesProcessed: 0,
        };
      }

      // Create read stream from watermark position
      const stream = fs.createReadStream(resolvedPath, {
        start: watermark,
        encoding: 'utf-8',
      });

      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity,
      });

      let bytesRead = watermark;

      for await (const line of rl) {
        // Track byte position (line + newline)
        bytesRead += Buffer.byteLength(line, 'utf-8') + 1;
        
        if (line.trim().length === 0) continue;
        
        try {
          const entry = this.parseLine(line);
          if (entry) {
            entries.push(entry);
          }
          linesProcessed++;
        } catch (e) {
          // Skip malformed lines but continue processing
          console.error(`[TranscriptParser] Skipping malformed line: ${e}`);
        }
      }

      newWatermark = bytesRead;
    } finally {
      await fileHandle.close();
    }

    return {
      entries,
      newWatermark,
      linesProcessed,
    };
  }

  /**
   * Parse a single JSONL line into a transcript entry
   * Handles various Claude Code message formats flexibly
   */
  private parseLine(line: string): TranscriptEntry | null {
    const json = JSON.parse(line) as Record<string, unknown>;
    
    // Detect message type and extract content
    const type = this.detectEntryType(json);
    const content = this.extractContent(json);
    
    if (!content || content.trim().length === 0) {
      return null;
    }

    // Build entry with only defined optional properties
    const timestamp = this.extractTimestamp(json);
    const role = this.extractRole(json);
    const toolName = this.extractToolName(json);
    const toolInput = this.extractToolInput(json);
    const toolOutput = this.extractToolOutput(json);

    const entry: TranscriptEntry = {
      type,
      content,
      rawJson: json,
    };

    // Only add optional properties if defined
    if (timestamp !== undefined) entry.timestamp = timestamp;
    if (role !== undefined) entry.role = role;
    if (toolName !== undefined) entry.toolName = toolName;
    if (toolInput !== undefined) entry.toolInput = toolInput;
    if (toolOutput !== undefined) entry.toolOutput = toolOutput;

    return entry;
  }

  /**
   * Detect the type of transcript entry
   */
  private detectEntryType(json: Record<string, unknown>): TranscriptEntryType {
    // Check for explicit type field
    const type = json.type as string | undefined;
    
    if (type === 'user' || json.role === 'user') {
      return 'user_message';
    }
    
    if (type === 'assistant' || json.role === 'assistant') {
      // Check if it's a tool use
      if (json.tool_use || json.toolName || this.hasToolUseContent(json)) {
        return 'tool_use';
      }
      return 'assistant_message';
    }
    
    if (type === 'tool_result' || json.tool_result || json.toolOutput !== undefined) {
      return 'tool_result';
    }
    
    if (type === 'system' || json.role === 'system') {
      return 'system';
    }

    // Check content structure for tool patterns
    if (json.tool_use || json.name || json.input) {
      return 'tool_use';
    }

    // Default based on role
    const role = json.role as string | undefined;
    if (role === 'user') return 'user_message';
    if (role === 'assistant') return 'assistant_message';

    return 'unknown';
  }

  /**
   * Check if json contains tool use content
   */
  private hasToolUseContent(json: Record<string, unknown>): boolean {
    // Check various possible locations for tool use
    if (json.content && Array.isArray(json.content)) {
      return (json.content as unknown[]).some(
        (c: unknown) => typeof c === 'object' && c !== null && 'type' in c && (c as Record<string, unknown>).type === 'tool_use'
      );
    }
    return false;
  }

  /**
   * Extract text content from various formats
   */
  private extractContent(json: Record<string, unknown>): string {
    // Direct content string
    if (typeof json.content === 'string') {
      return json.content;
    }

    // Content array (Claude API format)
    if (Array.isArray(json.content)) {
      const textParts: string[] = [];
      
      for (const part of json.content as unknown[]) {
        if (typeof part === 'string') {
          textParts.push(part);
        } else if (typeof part === 'object' && part !== null) {
          const obj = part as Record<string, unknown>;
          
          // Text block
          if (obj.type === 'text' && typeof obj.text === 'string') {
            textParts.push(obj.text);
          }
          
          // Tool use block
          if (obj.type === 'tool_use') {
            const toolName = obj.name || 'unknown';
            const input = obj.input ? JSON.stringify(obj.input) : '';
            textParts.push(`[Tool: ${toolName}] ${input}`);
          }
          
          // Tool result block
          if (obj.type === 'tool_result') {
            const content = typeof obj.content === 'string' 
              ? obj.content 
              : JSON.stringify(obj.content);
            textParts.push(`[Tool Result] ${content}`);
          }
        }
      }
      
      return textParts.join('\n');
    }

    // Message field
    if (typeof json.message === 'string') {
      return json.message;
    }

    // Text field
    if (typeof json.text === 'string') {
      return json.text;
    }

    // Tool output
    if (json.toolOutput !== undefined) {
      return typeof json.toolOutput === 'string' 
        ? json.toolOutput 
        : JSON.stringify(json.toolOutput);
    }

    // Fallback: stringify the whole object
    return '';
  }

  /**
   * Extract timestamp from entry
   */
  private extractTimestamp(json: Record<string, unknown>): string | undefined {
    if (typeof json.timestamp === 'string') return json.timestamp;
    if (typeof json.created_at === 'string') return json.created_at;
    if (typeof json.time === 'string') return json.time;
    return undefined;
  }

  /**
   * Extract role from entry
   */
  private extractRole(json: Record<string, unknown>): TranscriptEntry['role'] {
    const role = json.role as string | undefined;
    if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') {
      return role;
    }
    return undefined;
  }

  /**
   * Extract tool name
   */
  private extractToolName(json: Record<string, unknown>): string | undefined {
    if (typeof json.name === 'string') return json.name;
    if (typeof json.toolName === 'string') return json.toolName;
    if (typeof json.tool_name === 'string') return json.tool_name;
    
    // Check in content array
    if (Array.isArray(json.content)) {
      for (const part of json.content as unknown[]) {
        if (typeof part === 'object' && part !== null) {
          const obj = part as Record<string, unknown>;
          if (obj.type === 'tool_use' && typeof obj.name === 'string') {
            return obj.name;
          }
        }
      }
    }
    
    return undefined;
  }

  /**
   * Extract tool input
   */
  private extractToolInput(json: Record<string, unknown>): unknown {
    if (json.input !== undefined) return json.input;
    if (json.toolInput !== undefined) return json.toolInput;
    if (json.tool_input !== undefined) return json.tool_input;
    
    // Check in content array
    if (Array.isArray(json.content)) {
      for (const part of json.content as unknown[]) {
        if (typeof part === 'object' && part !== null) {
          const obj = part as Record<string, unknown>;
          if (obj.type === 'tool_use' && obj.input !== undefined) {
            return obj.input;
          }
        }
      }
    }
    
    return undefined;
  }

  /**
   * Extract tool output
   */
  private extractToolOutput(json: Record<string, unknown>): unknown {
    if (json.output !== undefined) return json.output;
    if (json.toolOutput !== undefined) return json.toolOutput;
    if (json.tool_output !== undefined) return json.tool_output;
    
    // Check in content array for tool_result
    if (Array.isArray(json.content)) {
      for (const part of json.content as unknown[]) {
        if (typeof part === 'object' && part !== null) {
          const obj = part as Record<string, unknown>;
          if (obj.type === 'tool_result') {
            return obj.content;
          }
        }
      }
    }
    
    return undefined;
  }

  /**
   * Resolve path, expanding ~ to home directory
   */
  private resolvePath(filePath: string): string {
    if (filePath.startsWith('~')) {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(home, filePath.slice(1));
    }
    return path.resolve(filePath);
  }

  /**
   * Get conversation text from entries (for context sweep)
   */
  static entriesToConversationText(entries: TranscriptEntry[]): string {
    return entries
      .map(entry => {
        const rolePrefix = entry.role ? `[${entry.role}] ` : '';
        return `${rolePrefix}${entry.content}`;
      })
      .join('\n\n');
  }

  /**
   * Filter entries to only user and assistant messages (no tool details)
   */
  static filterConversation(entries: TranscriptEntry[]): TranscriptEntry[] {
    return entries.filter(
      e => e.type === 'user_message' || e.type === 'assistant_message'
    );
  }

  /**
   * Get only new entries since last check (stateless helper)
   */
  static async getNewEntries(
    transcriptPath: string,
    lastWatermark: number
  ): Promise<ParseResult> {
    const parser = new TranscriptParser();
    return parser.parseFromWatermark(transcriptPath, lastWatermark);
  }
}
