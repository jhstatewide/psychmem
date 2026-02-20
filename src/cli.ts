#!/usr/bin/env node
/**
 * PsychMem CLI
 * 
 * Command-line interface for the selective memory system
 * 
 * Usage:
 *   psychmem hook <json>          Process a hook event (stdin or arg)
 *   psychmem search <query>       Search memories
 *   psychmem get <id>             Get memory details
 *   psychmem stats                Show memory statistics
 *   psychmem decay                Apply decay to all memories
 *   psychmem consolidate          Run STM→LTM consolidation
 *   psychmem pin <id>             Pin a memory (prevent decay)
 *   psychmem forget <id>          Forget a memory
 *   psychmem remember <id>        Boost memory to LTM
 */

import * as fs from 'fs';
import { PsychMem, createPsychMem } from './index.js';
import type { HookInput } from './types/index.js';
import { TranscriptParser } from './transcript/parser.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  const psychmem = await createPsychMem();
  
  try {
    switch (command) {
      case 'hook':
        await handleHook(psychmem, args.slice(1));
        break;
      
      case 'search':
        handleSearch(psychmem, args.slice(1));
        break;
      
      case 'get': {
        const getId = args[1];
        if (!getId) {
          console.error('No memory ID provided.');
          process.exit(1);
        }
        handleGet(psychmem, getId);
        break;
      }
      
      case 'stats':
        handleStats(psychmem);
        break;
      
      case 'decay':
        handleDecay(psychmem);
        break;
      
      case 'consolidate':
        handleConsolidate(psychmem);
        break;
      
      case 'pin': {
        const pinId = args[1];
        if (!pinId) {
          console.error('No memory ID provided.');
          process.exit(1);
        }
        handlePin(psychmem, pinId);
        break;
      }
      
      case 'forget': {
        const forgetId = args[1];
        if (!forgetId) {
          console.error('No memory ID provided.');
          process.exit(1);
        }
        handleForget(psychmem, forgetId);
        break;
      }
      
      case 'remember': {
        const rememberId = args[1];
        if (!rememberId) {
          console.error('No memory ID provided.');
          process.exit(1);
        }
        handleRemember(psychmem, rememberId);
        break;
      }
      
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;
      
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    psychmem.close();
  }
}

async function handleHook(psychmem: PsychMem, args: string[]) {
  let inputJson: string;
  
  if (args.length > 0) {
    inputJson = args.join(' ');
  } else {
    // Read from stdin
    inputJson = await readStdin();
  }
  
  if (!inputJson.trim()) {
    console.error('No input provided. Pass JSON as argument or via stdin.');
    process.exit(1);
  }
  
  let rawInput: Record<string, unknown>;
  try {
    rawInput = JSON.parse(inputJson);
  } catch (e) {
    process.stderr.write(JSON.stringify({
      error: 'invalid_json',
      message: e instanceof Error ? e.message : String(e),
    }) + '\n');
    process.exit(1);
  }
  
  // Transform Claude Code hook input to our internal format
  const input = await transformClaudeCodeInput(rawInput);
  const result = await psychmem.handleHook(input);
  
  // Transform output for Claude Code format
  if (result.success) {
    if (result.context) {
      // For SessionStart, output context as additionalContext for Claude
      // For other hooks, just output the context
      if (input.hookType === 'SessionStart') {
        console.log(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: result.context
          }
        }));
      } else {
        // For Stop/SessionEnd, just output status (not blocking)
        console.log(JSON.stringify({ success: true }));
      }
    } else {
      console.log(JSON.stringify({ success: true }));
    }
  } else {
    // Don't block on errors, just log
    console.error(result.error);
    process.exit(0); // Still exit 0 so we don't block the agent
  }
}

/**
 * Transform Claude Code hook input to PsychMem internal format
 * Claude Code sends: hook_event_name, session_id, cwd, transcript_path, etc.
 * We expect: hookType, sessionId, timestamp, data
 */
async function transformClaudeCodeInput(raw: Record<string, unknown>): Promise<HookInput> {
  // Detect if this is already in our internal format
  if (raw.hookType && raw.data) {
    return raw as unknown as HookInput;
  }
  
  // Transform from Claude Code format
  const hookEventName = raw.hook_event_name as string;
  const sessionId = raw.session_id as string;
  const cwd = raw.cwd as string;
  const transcriptPath = raw.transcript_path as string;
  
  // Map Claude Code event names to our internal hook types
  const hookTypeMap: Record<string, string> = {
    'SessionStart': 'SessionStart',
    'UserPromptSubmit': 'UserPromptSubmit',
    'PostToolUse': 'PostToolUse',
    'Stop': 'Stop',
    'SessionEnd': 'SessionEnd',
  };
  
  const hookType = hookTypeMap[hookEventName] ?? hookEventName;
  
  // Build the data object based on hook type
  let data: Record<string, unknown> = {};
  
  switch (hookType) {
    case 'SessionStart': {
      // Extract project name from cwd, stripping any trailing slash first
      const normalizedCwd = cwd ? cwd.replace(/[/\\]+$/, '') : '';
      const project = normalizedCwd ? normalizedCwd.split(/[/\\]/).pop() ?? 'unknown' : 'unknown';
      const source = raw.source as string | undefined;
      data = {
        project,
        workingDirectory: cwd,
        source,
        metadata: { transcriptPath }
      };
      break;
    }
    
    case 'UserPromptSubmit': {
      const prompt = raw.prompt as string | undefined;
      data = {
        prompt: prompt ?? '',
        metadata: { cwd }
      };
      break;
    }
    
    case 'PostToolUse': {
      const toolName = raw.tool_name as string | undefined;
      const toolInput = raw.tool_input as Record<string, unknown> | undefined;
      const toolResponse = raw.tool_response as Record<string, unknown> | undefined;
      data = {
        toolName: toolName ?? 'unknown',
        toolInput: toolInput ? JSON.stringify(toolInput) : '',
        toolOutput: toolResponse ? JSON.stringify(toolResponse) : '',
        success: true,
        metadata: { cwd }
      };
      break;
    }
    
    case 'Stop': {
      const stopReason = raw.stop_reason as string | undefined;
      // Read the full transcript to provide conversationText for memory extraction
      let conversationText: string | undefined;
      if (transcriptPath) {
        try {
          const parser = new TranscriptParser();
          const parseResult = await parser.parseFromWatermark(transcriptPath, 0);
          if (parseResult.entries.length > 0) {
            conversationText = TranscriptParser.entriesToConversationText(parseResult.entries);
          }
        } catch (e) {
          process.stderr.write(`[psychmem] Warning: could not read transcript at ${transcriptPath}: ${e instanceof Error ? e.message : String(e)}\n`);
        }
      }
      data = {
        reason: 'user' as const,
        stopReason,
        ...(conversationText !== undefined ? { conversationText } : {}),
        metadata: { transcriptPath, cwd }
      };
      break;
    }
    
    case 'SessionEnd': {
      data = {
        reason: 'normal' as const,
        metadata: { transcriptPath, cwd }
      };
      break;
    }
    
    default:
      data = raw as Record<string, unknown>;
  }
  
  return {
    hookType: hookType as HookInput['hookType'],
    sessionId,
    timestamp: new Date().toISOString(),
    data: data as unknown as HookInput['data'],
  };
}

function handleSearch(psychmem: PsychMem, args: string[]) {
  const query = args.join(' ');
  
  if (!query) {
    console.error('No search query provided.');
    process.exit(1);
  }
  
  const results = psychmem.search(query);
  
  if (results.length === 0) {
    console.log('No memories found.');
    return;
  }
  
  console.log(`Found ${results.length} memories:\n`);
  
  for (const item of results) {
    const bar = formatStrengthBar(item.strength);
    const store = item.store === 'ltm' ? 'LTM' : 'STM';
    console.log(`${bar} [${store}] ${item.summary}`);
    console.log(`    ID: ${item.id.slice(0, 8)} | ${item.classification} | ~${item.estimatedTokens} tokens\n`);
  }
}

function handleGet(psychmem: PsychMem, id: string) {
  const memory = psychmem.getMemory(id);
  
  if (!memory) {
    console.error(`Memory not found: ${id}`);
    process.exit(1);
  }
  
  console.log('Memory Details:\n');
  console.log(`ID: ${memory.id}`);
  console.log(`Store: ${memory.store.toUpperCase()}`);
  console.log(`Classification: ${memory.classification}`);
  console.log(`Status: ${memory.status}`);
  console.log(`Strength: ${formatStrengthBar(memory.strength)} (${(memory.strength * 100).toFixed(1)}%)`);
  console.log(`\nSummary:\n${memory.summary}`);
  console.log(`\nScores:`);
  console.log(`  Importance: ${memory.importance.toFixed(2)}`);
  console.log(`  Utility: ${memory.utility.toFixed(2)}`);
  console.log(`  Novelty: ${memory.novelty.toFixed(2)}`);
  console.log(`  Confidence: ${memory.confidence.toFixed(2)}`);
  console.log(`  Interference: ${memory.interference.toFixed(2)}`);
  console.log(`\nMetadata:`);
  console.log(`  Created: ${memory.createdAt.toISOString()}`);
  console.log(`  Updated: ${memory.updatedAt.toISOString()}`);
  console.log(`  Frequency: ${memory.frequency}`);
  console.log(`  Tags: ${memory.tags.join(', ') || 'none'}`);
}

function handleStats(psychmem: PsychMem) {
  const stats = psychmem.getStats();
  
  console.log('PsychMem Statistics:\n');
  console.log(`Total Memories: ${stats.total}`);
  console.log(`\nShort-Term Memory (STM):`);
  console.log(`  Count: ${stats.stm.count}`);
  console.log(`  Avg Strength: ${(stats.stm.avgStrength * 100).toFixed(1)}%`);
  console.log(`\nLong-Term Memory (LTM):`);
  console.log(`  Count: ${stats.ltm.count}`);
  console.log(`  Avg Strength: ${(stats.ltm.avgStrength * 100).toFixed(1)}%`);
}

function handleDecay(psychmem: PsychMem) {
  const decayed = psychmem.applyDecay();
  console.log(`Decay applied. ${decayed} memories fell below threshold.`);
}

function handleConsolidate(psychmem: PsychMem) {
  const promoted = psychmem.runConsolidation();
  console.log(`Consolidation complete. ${promoted} memories promoted to LTM.`);
}

function handlePin(psychmem: PsychMem, id: string) {
  psychmem.pinMemory(id);
  console.log(`Memory ${id.slice(0, 8)} pinned. It will not decay.`);
}

function handleForget(psychmem: PsychMem, id: string) {
  psychmem.forgetMemory(id);
  console.log(`Memory ${id.slice(0, 8)} forgotten.`);
}

function handleRemember(psychmem: PsychMem, id: string) {
  psychmem.rememberMemory(id);
  console.log(`Memory ${id.slice(0, 8)} marked as important and promoted to LTM.`);
}

function formatStrengthBar(strength: number): string {
  const filled = Math.round(strength * 5);
  const empty = 5 - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
  });
}

function printHelp() {
  console.log(`
PsychMem - Psych-grounded selective memory system for AI agents

USAGE:
  psychmem <command> [arguments]

COMMANDS:
  hook <json>        Process a hook event (JSON as argument or stdin)
  search <query>     Search memories by text query
  get <id>           Get full memory details by ID
  stats              Show memory statistics
  decay              Apply decay to all memories
  consolidate        Run STM to LTM consolidation
  pin <id>           Pin a memory (prevent decay)
  forget <id>        Forget a memory
  remember <id>      Mark memory as important (promote to LTM)
  help               Show this help message

EXAMPLES:
  # Process a hook event
  echo '{"hookType":"SessionStart","sessionId":"123","timestamp":"2024-01-01","data":{"project":"myapp","workingDirectory":"."}}' | psychmem hook

  # Search for memories about errors
  psychmem search "error handling"

  # Get memory details
  psychmem get a1b2c3d4-e5f6-7890-abcd-ef1234567890

  # View stats
  psychmem stats

For more information, see: https://github.com/example/psychmem
`);
}

main().catch(console.error);
