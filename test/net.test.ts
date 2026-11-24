import assert from 'node:assert/strict';
import { test } from 'node:test';
import './env.ts';
import { getJson, Unreachable } from '../src/net.ts';
import { fakeNet } from './helpers.ts';

const U = 'https://api.example.com/x';
const DAY = 86400000;

test('getJson caches a 200', async (t) => {
  const calls = fakeNet(t, new Map([[U, { status: 200, body: { a: 1 } }]]));
  assert.deepEqual(await getJson(U, { ttlMs: DAY }), { status: 200, data: { a: 1 } });
  await getJson(U, { ttlMs: DAY });
  assert.equal(calls.length, 1);
});

test('getJson returns a 404 with its body', async (t) => {
  fakeNet(t, new Map([[U, { status: 404, body: { error: 'closed' } }]]));
  assert.deepEqual(await getJson(U, { ttlMs: DAY }), { status: 404, data: { error: 'closed' } });
});

test('getJson throws without a cache and serves a stale one', async (t) => {
  const routes = new Map<string, { status: number; body?: unknown }>([[U, { status: 200, body: { a: 1 } }]]);
  fakeNet(t, routes);
  routes.set(U, { status: 500 });
  await assert.rejects(getJson(U, { ttlMs: DAY }), (e: Error) => e instanceof Unreachable && e.message === 'Cannot reach api.example.com.');
  routes.set(U, { status: 200, body: { a: 1 } });
  await getJson(U, { ttlMs: DAY });
  routes.set(U, { status: 500 });
  assert.deepEqual(await getJson(U, { ttlMs: -1 }), { status: 200, data: { a: 1 } });
});

test('getJson reports 401 and 429', async (t) => {
  const routes = new Map<string, { status: number; body?: unknown }>([[U, { status: 401 }]]);
  fakeNet(t, routes);
  await assert.rejects(getJson(U, { ttlMs: DAY }), { message: 'api.example.com rejected the request (401).' });
  routes.set(U, { status: 429 });
  await assert.rejects(getJson(U, { ttlMs: DAY }), { message: 'api.example.com asked to slow down (429).' });
});
