/**
 * PsychMem Adapter Types
 * Common interfaces for agent-specific adapters
 */

import type { MemoryUnit } from '../types/index.js';

// =============================================================================
// Agent Types
// =============================================================================

/**
 * Supported AI agent types
 */
export type AgentType = 'claude-code' | 'opencode';

// =============================================================================
// OpenCode Types (from @opencode-ai/plugin)
// =============================================================================

/**
 * OpenCode plugin context provided to plugin functions
 */
export interface OpenCodePluginContext {
  /** Current project information */
  project: unknown;
  /** Current working directory */
  directory: string;
  /** Git worktree root path */
  worktree: string;
  /** OpenCode SDK client */
  client: OpenCodeClient;
  /** Bun shell API */
  $: BunShell;
}

/**
 * Bun shell API (subset we use)
 */
export interface BunShell {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<{ text(): string }>;
}

/**
 * OpenCode SDK client interface (subset we use)
 */
export interface OpenCodeClient {
  session: {
    /** Get all messages in a session */
    messages(params: { path: { id: string } }): Promise<{ data: OpenCodeMessageContainer[] }>;
    
    /** Send a prompt to a session */
    prompt(params: {
      path: { id: string };
      body: {
        noReply?: boolean;
        parts: Array<{ type: 'text'; text: string }>;
      };
    }): Promise<unknown>;
    
    /** Get session details */
    get(params: { path: { id: string } }): Promise<{ data: OpenCodeSession }>;
  };
  
  app: {
    /** Write a log entry */
    log(params: {
      body: {
        service: string;
        level: 'debug' | 'info' | 'warn' | 'error';
        message: string;
        extra?: unknown;
      };
    }): Promise<void>;
  };
}

/**
 * OpenCode session details
 */
export interface OpenCodeSession {
  id: string;
  title?: string;
  created: string;
  updated: string;
}

/**
 * OpenCode message container (info + parts)
 */
export interface OpenCodeMessageContainer {
  info: OpenCodeMessageInfo;
  parts: OpenCodeMessagePart[];
}

/**
 * OpenCode message info
 */
export interface OpenCodeMessageInfo {
  id: string;
  role: 'user' | 'assistant';
  created: string;
}

/**
 * OpenCode message part
 */
export interface OpenCodeMessagePart {
  type: 'text' | 'tool-invocation' | 'tool-result' | string;
  text?: string;
  /** Tool name for tool-invocation */
  tool?: string;
  /** Tool arguments */
  args?: unknown;
  /** Tool result */
  result?: unknown;
  /** Error if tool failed */
  error?: string;
}

/**
 * OpenCode event from event subscription
 * 
 * SDK event shapes:
 * - session.created → { type, properties: { info: Session } }
 * - session.idle    → { type, properties: { sessionID: string } }
 * - session.deleted → { type, properties: { info: Session } }
 * - session.error   → { type, properties: { sessionID?: string, error?: ... } }
 */
export interface OpenCodeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

/**
 * OpenCode tool.execute.after input shape (from SDK)
 */
export interface OpenCodeToolInput {
  tool: string;
  sessionID: string;
  callID: string;
  args: unknown;
}

/**
 * OpenCode tool.execute.after output shape (from SDK)
 */
export interface OpenCodeToolOutput {
  title: string;
  output: string;
  metadata: unknown;
}

/**
 * OpenCode compaction hook input shape
 * Note: The input may not contain session messages directly,
 * so we fetch them via client.session.messages()
 */
export interface OpenCodeCompactionInput {
  /** Session ID being compacted */
  sessionID?: string;
  /** Any additional properties */
  [key: string]: unknown;
}

/**
 * OpenCode message.updated event properties (v1.9)
 */
export interface OpenCodeMessageUpdatedEvent {
  /** The message that was updated */
  message?: OpenCodeMessageContainer;
  /** Session ID the message belongs to */
  sessionID?: string;
  /** Message ID */
  messageID?: string;
  /** Role of the message sender */
  role?: 'user' | 'assistant';
}

/**
 * OpenCode plugin hook return type
 */
export interface OpenCodePluginHooks {
  /** Event handler for session lifecycle events */
  event?: (params: { event: OpenCodeEvent }) => Promise<void>;
  
  /** Hook before tool execution */
  'tool.execute.before'?: (
    input: { tool: string; args: unknown },
    output: { args: unknown }
  ) => Promise<void>;
  
  /** Hook after tool execution */
  'tool.execute.after'?: (
    input: OpenCodeToolInput,
    output: OpenCodeToolOutput
  ) => Promise<void>;
  
  /** Hook for shell environment */
  'shell.env'?: (
    input: { cwd: string },
    output: { env: Record<string, string> }
  ) => Promise<void>;
  
  /** Experimental: Hook for session compaction */
  'experimental.session.compacting'?: (
    input: OpenCodeCompactionInput,
    output: { context: string[]; prompt?: string }
  ) => Promise<void>;
  
  /** Custom tools */
  tool?: Record<string, unknown>;
}

/**
 * OpenCode plugin function type
 */
export type OpenCodePlugin = (ctx: OpenCodePluginContext) => Promise<OpenCodePluginHooks>;

// =============================================================================
// Common Adapter Interface
// =============================================================================

/**
 * Common adapter interface for all AI agents
 */
export interface PsychMemAdapter {
  /** Agent type identifier */
  readonly agentType: AgentType;
  
  /** Initialize adapter and connect to agent */
  initialize(): Promise<void>;
  
  /** Inject memories into agent context */
  injectMemories(sessionId: string, memories: MemoryUnit[]): Promise<void>;
  
  /** Get current session ID */
  getCurrentSessionId(): string | null;
  
  /** Cleanup on shutdown */
  cleanup(): Promise<void>;
}

/**
 * Options for creating an adapter
 */
export interface AdapterOptions {
  /** Override default config */
  config?: Record<string, unknown>;
}
