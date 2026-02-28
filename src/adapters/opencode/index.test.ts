import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { OpenCodePluginContext } from '../types.js';
import { createOpenCodePlugin } from './index.js';
import { DEFAULT_CONFIG } from '../../types/index.js';

function createMockContext(promptCalls: Array<{ path: { id: string }; body: { noReply?: boolean; model?: { providerID: string; modelID: string }; parts: Array<{ type: 'text'; text: string }> } }>): OpenCodePluginContext {
  return {
    project: {},
    directory: '/tmp/project',
    worktree: '/tmp/project',
    client: {
      session: {
        async messages() {
          return { data: [] };
        },
        async prompt(params) {
          promptCalls.push(params);
          return {};
        },
        async get(params) {
          return {
            data: {
              id: params.path.id,
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
            },
          };
        },
      },
      app: {
        async log() {
          return;
        },
      },
    },
    async $(strings: TemplateStringsArray, ...values: unknown[]) {
      void strings;
      void values;
      return {
        text() {
          return '';
        },
      };
    },
  };
}

test('chat.message injects ruminate hint once per session when enabled', async () => {
  const promptCalls: Array<{ path: { id: string }; body: { noReply?: boolean; model?: { providerID: string; modelID: string }; parts: Array<{ type: 'text'; text: string }> } }> = [];
  const ctx = createMockContext(promptCalls);

  const dbDir = mkdtempSync(join(tmpdir(), 'psychmem-ruminate-hint-'));
  const hooks = await createOpenCodePlugin(ctx, {
    dbPath: join(dbDir, 'memory.db'),
    opencode: {
      ...DEFAULT_CONFIG.opencode,
      injectOnSessionStart: false,
      extractOnUserMessage: false,
      ruminateHint: true,
    },
  });

  const chatMessage = hooks['chat.message'];
  assert.ok(chatMessage, 'chat.message hook should be defined');

  await chatMessage(
    {
      sessionID: 's-1',
      model: { providerID: 'openai', modelID: 'gpt-5.3-codex' },
      messageID: 'm-1',
    },
    {
      message: {
        id: 'm-1',
        sessionID: 's-1',
        role: 'user',
        time: { created: Date.now() },
      },
      parts: [{ type: 'text', text: 'hello' }],
    }
  );

  await chatMessage(
    {
      sessionID: 's-1',
      model: { providerID: 'openai', modelID: 'gpt-5.3-codex' },
      messageID: 'm-2',
    },
    {
      message: {
        id: 'm-2',
        sessionID: 's-1',
        role: 'user',
        time: { created: Date.now() },
      },
      parts: [{ type: 'text', text: 'follow-up' }],
    }
  );

  assert.equal(promptCalls.length, 1, 'ruminate hint should be injected exactly once per session');
  assert.match(promptCalls[0]!.body.parts[0]!.text, /<psychmem_context/);
  assert.match(promptCalls[0]!.body.parts[0]!.text, /user_authored="false"/);
  assert.match(promptCalls[0]!.body.parts[0]!.text, /ruminate/);
});

test('chat.message does not inject ruminate hint when disabled', async () => {
  const promptCalls: Array<{ path: { id: string }; body: { noReply?: boolean; model?: { providerID: string; modelID: string }; parts: Array<{ type: 'text'; text: string }> } }> = [];
  const ctx = createMockContext(promptCalls);

  const dbDir = mkdtempSync(join(tmpdir(), 'psychmem-ruminate-off-'));
  const hooks = await createOpenCodePlugin(ctx, {
    dbPath: join(dbDir, 'memory.db'),
    opencode: {
      ...DEFAULT_CONFIG.opencode,
      injectOnSessionStart: false,
      extractOnUserMessage: false,
      ruminateHint: false,
    },
  });

  const chatMessage = hooks['chat.message'];
  assert.ok(chatMessage, 'chat.message hook should be defined');

  await chatMessage(
    {
      sessionID: 's-2',
      model: { providerID: 'openai', modelID: 'gpt-5.3-codex' },
      messageID: 'm-3',
    },
    {
      message: {
        id: 'm-3',
        sessionID: 's-2',
        role: 'user',
        time: { created: Date.now() },
      },
      parts: [{ type: 'text', text: 'hello' }],
    }
  );

  assert.equal(promptCalls.length, 0, 'no hint prompt should be injected when disabled');
});
