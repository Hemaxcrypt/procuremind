// Shared "ask Claude for structured output" helper. Claude answers by calling a
// tool; the tool input is validated with zod; on a bad answer Claude is shown
// the exact problems and asked again. Nothing unvalidated leaves this function.

import dns from 'node:dns';
import Anthropic from '@anthropic-ai/sdk';

// Some networks (including the one this was built on) can't reach the API over
// IPv6, and a hanging IPv6 attempt shows up as "Connection error". Prefer IPv4.
dns.setDefaultResultOrder('ipv4first');

export const DEFAULT_MODEL = process.env.PROCUREMIND_MODEL || 'claude-sonnet-5-5';

export class ClaudeOutputError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ClaudeOutputError';
    this.details = details;
  }
}

function formatIssues(error) {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export function getClient(client) {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ClaudeOutputError('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
  // Retry brief network blips and overloaded responses before giving up.
  return new Anthropic({ maxRetries: 4, timeout: 60_000 });
}

/**
 * @param {object} args
 * @param {object} args.client Anthropic client (or a fake in tests)
 * @param {string} args.system system prompt
 * @param {string} args.prompt the user message
 * @param {{name, description, input_schema}} args.tool the tool Claude must call
 * @param {import('zod').ZodType} args.schema validates the tool input
 * @param {(data) => string|null} [args.check] extra check; return an error message or null
 */
export async function callTool({ client, model = DEFAULT_MODEL, system, prompt, tool, schema, check, maxAttempts = 3, maxTokens = 2000 }) {
  const messages = [{ role: 'user', content: prompt }];
  let lastIssues = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: [tool],
      // Some models don't allow forcing a specific tool, so Claude chooses it;
      // the system prompt and the nudge below keep it on track.
      tool_choice: { type: 'auto' },
      messages
    });

    const call = response.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
    if (!call) {
      lastIssues = `No ${tool.name} tool call was returned`;
      if (response.content.length) {
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: `Please respond by calling the ${tool.name} tool.` });
      }
      continue;
    }

    const parsed = schema.safeParse(call.input);
    const extra = parsed.success && check ? check(parsed.data) : null;
    if (parsed.success && !extra) return parsed.data;

    lastIssues = parsed.success ? extra : formatIssues(parsed.error);
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: `Validation failed: ${lastIssues}. Call ${tool.name} again with corrected values.` }]
    });
  }
  throw new ClaudeOutputError(`Claude did not return a valid ${tool.name} after ${maxAttempts} attempts`, lastIssues);
}
