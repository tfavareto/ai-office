#!/usr/bin/env node
// What an agent in a real terminal runs to reach the agents the person connected to it:
//   node peers.mjs list
//   node peers.mjs send "<name>" "<message>"
// It uses the same token and the same check of the server's identity as the plugin's hooks, and can only reach the
// terminals connected to its own.

import process from 'node:process';
import { createContext, requestJson } from '../../plugins/ai-office/hooks/lib.mjs';

const USAGE = 'Usage: peers.mjs list | peers.mjs send "<name>" "<message>"';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function refusal(code) {
  if (code === 'unknown-peer') return 'That agent is not connected to you. See who is with: list';
  if (code === 'rate-limited') return 'Too many messages in a minute. Wait before sending more.';
  return code ?? 'AI Office is not answering.';
}

const id = process.env.AI_OFFICE_TERMINAL_ID;
if (id === undefined || id === '') fail('This is not a terminal opened by AI Office.');

const ctx = createContext(process.env, 'peers');
const [command, name, ...rest] = process.argv.slice(2);
const base = `/api/terminals/${encodeURIComponent(id)}`;

if (command === 'list') {
  const reply = await requestJson(ctx, 'GET', `${base}/peers`);
  if (reply === null) fail('AI Office is not answering.');
  const peers = Array.isArray(reply.json?.peers) ? reply.json.peers : [];
  if (peers.length === 0) process.stdout.write('No agents are connected to you.\n');
  for (const peer of peers) process.stdout.write(`${peer.name}${peer.role ? ` (${peer.role})` : ''}: ${peer.status}\n`);
} else if (command === 'send' && name !== undefined && rest.length > 0) {
  const reply = await requestJson(ctx, 'POST', `${base}/send`, { body: { to: name, text: rest.join(' ') } });
  if (reply?.json?.ok !== true) fail(refusal(reply?.json?.error));
  process.stdout.write(`Sent to ${name}. Their answer will arrive here as a new message.\n`);
} else {
  fail(USAGE);
}
