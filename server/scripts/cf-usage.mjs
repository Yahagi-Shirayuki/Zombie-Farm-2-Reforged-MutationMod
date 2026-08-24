#!/usr/bin/env node
// Pull Worker + D1 usage for the production stack out of Cloudflare's GraphQL
// analytics API and print a daily table plus the per-request efficiency ratios.
//
//   node scripts/cf-usage.mjs                      last 30 days, ending yesterday
//   node scripts/cf-usage.mjs 2026-07-24 2026-08-22
//   node scripts/cf-usage.mjs --hourly 2026-08-17
//
// Auth: CLOUDFLARE_API_TOKEN if set, otherwise wrangler's stored OAuth token.
// That token is short-lived — if this prints an auth error, run `npx wrangler
// whoami` once to refresh it and try again.
//
// The ratios at the bottom are the point of this script. Raw request counts move
// with how many people are playing; readQ/req and rowsRead/req move only when we
// change the server, so they are what an optimisation pass is actually steering.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ACCOUNT = 'a389a14338b237a5313e5e198220b938';
const PROD_DB = 'bf1b288f-7419-41d5-8ee6-0f022c17fd20';
const STAGING_DB = '2ee97121-08c8-4f03-ad96-84295c33484b';
const PROD_SCRIPT = 'zombiefarm-server';

function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const candidates = [
    path.join(process.env.APPDATA ?? '', 'xdg.config', '.wrangler', 'config', 'default.toml'),
    path.join(os.homedir(), '.config', '.wrangler', 'config', 'default.toml'),
    path.join(os.homedir(), '.wrangler', 'config', 'default.toml'),
  ];
  for (const file of candidates) {
    if (!file || !fs.existsSync(file)) continue;
    const found = /^oauth_token\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(file, 'utf8'));
    if (found) return found[1];
  }
  throw new Error('no Cloudflare token: set CLOUDFLARE_API_TOKEN or run `npx wrangler login`');
}

async function graphql(query) {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data.viewer.accounts[0];
}

const day = (d) => d.toISOString().slice(0, 10);
const num = (n) => Math.round(n).toLocaleString('en-US');
const pad = (s, w) => String(s).padStart(w);

async function daily(from, to) {
  const account = await graphql(`query { viewer { accounts(filter: {accountTag: "${ACCOUNT}"}) {
    workersInvocationsAdaptive(limit: 10000, orderBy: [date_ASC], filter: {
      datetime_geq: "${from}T00:00:00Z", datetime_lt: "${to}T23:59:59Z", scriptName: "${PROD_SCRIPT}" }) {
      dimensions { date status }
      sum { requests errors subrequests responseBodySize }
      quantiles { cpuTimeP50 cpuTimeP99 wallTimeP50 wallTimeP99 } }
    d1AnalyticsAdaptiveGroups(limit: 1000, orderBy: [date_ASC], filter: {
      date_geq: "${from}", date_leq: "${to}" }) {
      dimensions { date databaseId }
      sum { readQueries writeQueries rowsRead rowsWritten queryBatchResponseBytes } }
  } } }`);

  const days = new Map();
  const at = (d) => {
    if (!days.has(d)) {
      days.set(d, { d, req: 0, err: 0, bytes: 0, wall: [], cpu: [], rq: 0, wq: 0, rr: 0, rw: 0, stg: 0 });
    }
    return days.get(d);
  };
  for (const row of account.workersInvocationsAdaptive) {
    const x = at(row.dimensions.date);
    x.req += row.sum.requests;
    x.err += row.sum.errors;
    x.bytes += row.sum.responseBodySize;
    x.wall.push(row.quantiles.wallTimeP50);
    x.cpu.push(row.quantiles.cpuTimeP50);
  }
  for (const row of account.d1AnalyticsAdaptiveGroups) {
    const x = at(row.dimensions.date);
    if (row.dimensions.databaseId === PROD_DB) {
      x.rq += row.sum.readQueries;
      x.wq += row.sum.writeQueries;
      x.rr += row.sum.rowsRead;
      x.rw += row.sum.rowsWritten;
    } else if (row.dimensions.databaseId === STAGING_DB) {
      x.stg += row.sum.readQueries + row.sum.writeQueries;
    }
  }

  const rows = [...days.values()].sort((a, b) => a.d.localeCompare(b.d));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  console.log('date        dow      req  errs    readQ   writeQ   rowsRead  rowsWrit     MB  wallP50');
  for (const x of rows) {
    console.log([
      x.d,
      dow[new Date(`${x.d}T00:00:00Z`).getUTCDay()],
      pad(num(x.req), 8),
      pad(x.err, 5),
      pad(num(x.rq), 8),
      pad(num(x.wq), 8),
      pad(num(x.rr), 10),
      pad(num(x.rw), 9),
      pad((x.bytes / 1e6).toFixed(1), 6),
      pad(`${(mean(x.wall) / 1000).toFixed(0)}ms`, 8),
    ].join(' '));
  }

  const t = rows.reduce((a, x) => ({
    req: a.req + x.req, err: a.err + x.err, bytes: a.bytes + x.bytes,
    rq: a.rq + x.rq, wq: a.wq + x.wq, rr: a.rr + x.rr, rw: a.rw + x.rw, stg: a.stg + x.stg,
  }), { req: 0, err: 0, bytes: 0, rq: 0, wq: 0, rr: 0, rw: 0, stg: 0 });
  console.log(`\ntotals over ${rows.length} days: ${num(t.req)} requests, ${t.err} errors, `
    + `${num(t.rq)}/${num(t.wq)} read/write queries, ${num(t.rr)}/${num(t.rw)} rows read/written, `
    + `${(t.bytes / 1e6).toFixed(0)} MB out, ${num(t.stg)} staging queries`);
  if (t.req > 0) {
    console.log('\nper request (the numbers an optimisation pass moves):');
    console.log(`  ${(t.rq / t.req).toFixed(1)} read queries   ${(t.wq / t.req).toFixed(1)} write queries`);
    console.log(`  ${(t.rr / t.req).toFixed(1)} rows read      ${(t.rw / t.req).toFixed(1)} rows written`);
    console.log(`  ${(t.bytes / t.req / 1024).toFixed(1)} KB of response body`);
  }
  const peak = (k) => Math.max(...rows.map((x) => x[k]));
  console.log('\nworst day vs the free-tier daily caps:');
  console.log(`  requests     ${pad(num(peak('req')), 10)}  ${(peak('req') / 1e5 * 100).toFixed(1)}% of 100k`);
  console.log(`  rows read    ${pad(num(peak('rr')), 10)}  ${(peak('rr') / 5e6 * 100).toFixed(1)}% of 5M`);
  console.log(`  rows written ${pad(num(peak('rw')), 10)}  ${(peak('rw') / 1e5 * 100).toFixed(1)}% of 100k`);
}

async function hourly(date) {
  const account = await graphql(`query { viewer { accounts(filter: {accountTag: "${ACCOUNT}"}) {
    workersInvocationsAdaptive(limit: 10000, orderBy: [datetimeHour_ASC], filter: {
      datetime_geq: "${date}T00:00:00Z", datetime_lt: "${date}T23:59:59Z", scriptName: "${PROD_SCRIPT}" }) {
      dimensions { datetimeHour } sum { requests } }
    d1AnalyticsAdaptiveGroups(limit: 500, orderBy: [datetimeHour_ASC], filter: {
      datetimeHour_geq: "${date}T00:00:00Z", datetimeHour_lt: "${date}T23:59:59Z", databaseId: "${PROD_DB}" }) {
      dimensions { datetimeHour } sum { readQueries writeQueries rowsRead rowsWritten } }
  } } }`);

  const hours = new Map();
  const at = (h) => {
    if (!hours.has(h)) hours.set(h, { h, req: 0, rq: 0, wq: 0, rr: 0, rw: 0 });
    return hours.get(h);
  };
  for (const row of account.workersInvocationsAdaptive) at(row.dimensions.datetimeHour).req += row.sum.requests;
  for (const row of account.d1AnalyticsAdaptiveGroups) {
    const x = at(row.dimensions.datetimeHour);
    x.rq += row.sum.readQueries;
    x.wq += row.sum.writeQueries;
    x.rr += row.sum.rowsRead;
    x.rw += row.sum.rowsWritten;
  }
  const rows = [...hours.values()].sort((a, b) => a.h.localeCompare(b.h));
  const top = Math.max(1, ...rows.map((x) => x.req));
  console.log('hour (UTC)     req    readQ   writeQ   rowsRead  rowsWrit');
  for (const x of rows) {
    console.log(`${x.h.slice(11, 16)}  ${pad(num(x.req), 8)} ${pad(num(x.rq), 8)} ${pad(num(x.wq), 8)} `
      + `${pad(num(x.rr), 10)} ${pad(num(x.rw), 9)}  ${'#'.repeat(Math.round((x.req / top) * 30))}`);
  }
}

const argv = process.argv.slice(2);
try {
  if (argv[0] === '--hourly') {
    await hourly(argv[1] ?? day(new Date(Date.now() - 86_400_000)));
  } else {
    const to = argv[1] ?? day(new Date(Date.now() - 86_400_000));
    const from = argv[0] ?? day(new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000));
    await daily(from, to);
  }
} catch (err) {
  console.error(`cf-usage: ${err.message}`);
  process.exit(1);
}
