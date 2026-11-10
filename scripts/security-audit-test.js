import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { constantTimeCompare, requireCronAuth } from '../lib/cron-auth.js';
import { generateSecureTemporaryPassword } from '../lib/supabase-admin.js';
import challengesHandler from '../api/challenges.js';
import publishChallengeHandler from '../api/admin/publish-challenge.js';
import userTradesHandler from '../api/user-trades.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

console.log('════════════════════════════════════════════════════════════════');
console.log('🛡️  OptionQuest Security & Defensive Hardening Test Suite');
console.log('════════════════════════════════════════════════════════════════\n');

// 1. Timing-Safe Auth Tests
console.log('--- 1. Portable Constant-Time Cron Auth ---');
runTest('constantTimeCompare accepts identical strings', () => {
  assert.strictEqual(constantTimeCompare('secret_cron_token_123', 'secret_cron_token_123'), true);
});

runTest('constantTimeCompare rejects different strings of same length', () => {
  assert.strictEqual(constantTimeCompare('secret_cron_token_123', 'secret_cron_token_456'), false);
});

runTest('constantTimeCompare rejects different string lengths safely', () => {
  assert.strictEqual(constantTimeCompare('secret', 'secret_long'), false);
});

runTest('constantTimeCompare safely handles non-string inputs', () => {
  assert.strictEqual(constantTimeCompare(null, 'secret'), false);
  assert.strictEqual(constantTimeCompare(undefined, undefined), false);
});

runTest('requireCronAuth rejects missing CRON_SECRET with status 500', () => {
  const original = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const result = requireCronAuth({ headers: { authorization: 'Bearer token' } });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.status, 500);
  process.env.CRON_SECRET = original;
});

runTest('requireCronAuth rejects missing or malformed Bearer authorization', () => {
  process.env.CRON_SECRET = 'valid_secret_xyz';
  const noHeader = requireCronAuth({ headers: {} });
  assert.strictEqual(noHeader.success, false);
  assert.strictEqual(noHeader.status, 401);

  const basicScheme = requireCronAuth({ headers: { authorization: 'Basic xyz' } });
  assert.strictEqual(basicScheme.success, false);
  assert.strictEqual(basicScheme.status, 401);
});

runTest('requireCronAuth rejects incorrect token and accepts matching token', () => {
  process.env.CRON_SECRET = 'valid_secret_xyz';
  const wrongToken = requireCronAuth({ headers: { authorization: 'Bearer wrong_token' } });
  assert.strictEqual(wrongToken.success, false);
  assert.strictEqual(wrongToken.status, 401);

  const validToken = requireCronAuth({ headers: { authorization: 'Bearer valid_secret_xyz' } });
  assert.strictEqual(validToken.success, true);
});

// 2. NIST SP 800-63B Password Generator Tests
console.log('\n--- 2. NIST SP 800-63B Temporary Password Generator ---');
runTest('generateSecureTemporaryPassword generates 24-char default with high entropy', () => {
  const pass = generateSecureTemporaryPassword(24);
  assert.strictEqual(pass.length, 24);
  assert.match(pass, /[A-Z]/, 'Must contain uppercase');
  assert.match(pass, /[a-z]/, 'Must contain lowercase');
  assert.match(pass, /[0-9]/, 'Must contain number');
  assert.match(pass, /[!@#$%^&*()_\-=+\[\]{}]/, 'Must contain symbol');
});

runTest('generateSecureTemporaryPassword strictly excludes ambiguous characters (I, O, l, 0, 1)', () => {
  for (let i = 0; i < 20; i++) {
    const pass = generateSecureTemporaryPassword(32);
    assert.strictEqual(/I|O|l|0|1/.test(pass), false, `Found ambiguous character in: ${pass}`);
  }
});

// 3. Security Headers & vercel.json Verification
console.log('\n--- 3. Production HTTP Security Headers in vercel.json ---');
runTest('vercel.json specifies valid cron schedule and conservative HSTS', () => {
  const vercelJsonPath = path.join(rootDir, 'vercel.json');
  assert.strictEqual(fs.existsSync(vercelJsonPath), true, 'vercel.json must exist');

  const content = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));
  assert.ok(Array.isArray(content.crons), 'crons array must be defined');
  assert.strictEqual(content.crons[0].path, '/api/cron/cleanup');

  const globalHeaders = content.headers.find((h) => h.source === '/(.*)');
  assert.ok(globalHeaders, 'Global header match rule must exist');

  const headerMap = Object.fromEntries(globalHeaders.headers.map((h) => [h.key, h.value]));
  assert.ok(headerMap['Content-Security-Policy'], 'CSP header must be set');
  assert.ok(headerMap['Content-Security-Policy'].includes("frame-ancestors 'none'"), 'CSP frame-ancestors must be none');
  assert.strictEqual(headerMap['X-Frame-Options'], 'DENY');
  assert.strictEqual(headerMap['X-Content-Type-Options'], 'nosniff');
  assert.strictEqual(headerMap['Referrer-Policy'], 'strict-origin-when-cross-origin');

  // Verify conservative HSTS staging (NO premature preload)
  assert.ok(headerMap['Strict-Transport-Security'].includes('max-age=86400'), 'Initial HSTS must be conservative (86400s / 1 day)');
  assert.strictEqual(headerMap['Strict-Transport-Security'].includes('preload'), false, 'HSTS must NOT contain preload during initial rollout');
});

// 4. Supabase Migration & Oct 30 Grants (Issue #38)
console.log('\n--- 4. Supabase RBAC Migration & Oct 30 Data API Grants ---');
runTest('Supabase migration enforces RLS and explicit role grants (Issue #38)', () => {
  const migrationPath = path.join(rootDir, 'supabase/migrations/20260925000000_create_operators_table.sql');
  assert.strictEqual(fs.existsSync(migrationPath), true, 'Migration SQL file must exist');

  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'), 'RLS must be enabled');
  assert.ok(sql.includes('GRANT SELECT ON public.operators TO anon;'), 'Explicit grant to anon required post-Oct 30');
  assert.ok(sql.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON public.operators TO authenticated;'), 'Explicit grant to authenticated required');
  assert.ok(sql.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON public.operators TO service_role;'), 'Explicit grant to service_role required');
});

// 5. Dependency Pinning (.npmrc)
console.log('\n--- 5. Deterministic Dependency Pinning & Supply Chain ---');
runTest('.npmrc enforces save-exact=true and package.json strips carets', () => {
  const npmrcPath = path.join(rootDir, '.npmrc');
  assert.strictEqual(fs.existsSync(npmrcPath), true, '.npmrc must exist');
  assert.ok(fs.readFileSync(npmrcPath, 'utf8').includes('save-exact=true'));

  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  for (const [dep, version] of Object.entries(pkg.dependencies || {})) {
    assert.strictEqual(/^\d/.test(version), true, `Dependency "${dep}" must be pinned without carets/tildes (got: ${version})`);
  }
});

// 6. Bundle 5 Redis LiveOps Challenges & Cross-Device Public Trades Tests
console.log('\n--- 6. Bundle 5 Redis LiveOps Challenges & Cross-Device Public Trades ---');

function createMockRedis() {
  const kv = new Map();
  const hashes = new Map();
  return {
    pipeline() {
      const ops = [];
      return {
        incr(key) {
          ops.push(() => {
            const val = (kv.get(key) || 0) + 1;
            kv.set(key, val);
            return [null, val];
          });
        },
        ttl() {
          ops.push(() => [null, 60]);
        },
        async exec() {
          return ops.map((fn) => fn());
        },
      };
    },
    async incr(key) {
      const val = (kv.get(key) || 0) + 1;
      kv.set(key, val);
      return val;
    },
    async expire() {
      return 1;
    },
    async ttl() {
      return 60;
    },
    async get(key) {
      return kv.get(key) ?? null;
    },
    async set(key, val) {
      kv.set(key, val);
      return 'OK';
    },
    async hget(hash, field) {
      const h = hashes.get(hash);
      return h ? (h.get(field) ?? null) : null;
    },
    async hset(hash, field, val) {
      if (!hashes.has(hash)) hashes.set(hash, new Map());
      hashes.get(hash).set(field, val);
      return 1;
    },
    async hgetall(hash) {
      const h = hashes.get(hash);
      if (!h) return {};
      return Object.fromEntries(h.entries());
    },
  };
}

function createMockRes() {
  const headers = {};
  let statusCode = 200;
  let jsonBody = null;
  return {
    headers,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return jsonBody;
    },
    setHeader(k, v) {
      headers[k] = v;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      jsonBody = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

await runAsyncTest('publish-challenge rejects unauthorized requests (401) and accepts valid CRON_SECRET', async () => {
  process.env.CRON_SECRET = 'bundle5_cron_secret_test';
  const mockRedis = createMockRedis();

  // 1. Unauthorized attempt
  const unauthRes = createMockRes();
  await publishChallengeHandler(
    { method: 'POST', headers: { authorization: 'Bearer invalid_token' }, body: {}, _mockRedis: mockRedis },
    unauthRes
  );
  assert.strictEqual(unauthRes.statusCode, 401);

  // 2. Authorized publish of Week 2 Silicon Volatility Defense
  const validRes = createMockRes();
  await publishChallengeHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer bundle5_cron_secret_test' },
      body: {
        id: 'challenge_silicon_volatility_w2',
        title: 'Silicon Volatility Defense',
        description: 'Execute 2 disciplined trades risking <=5% during high IV',
        category: 'risk',
        progress_metric: 'disciplined_sizing',
        target: 2,
        xp_reward: 250,
        coin_reward: 300,
        priority: 1,
      },
      _mockRedis: mockRedis,
    },
    validRes
  );
  assert.strictEqual(validRes.statusCode, 200);
  assert.strictEqual(validRes.body.success, true);
  assert.strictEqual(validRes.body.publishedCount, 1);

  // 3. Verify GET /api/challenges returns the published challenge and sets Edge Cache headers
  const getRes = createMockRes();
  await challengesHandler(
    { method: 'GET', headers: {}, _mockRedis: mockRedis },
    getRes
  );
  assert.strictEqual(getRes.statusCode, 200);
  assert.ok(getRes.headers['Cache-Control'].includes('s-maxage=3600'), 'Must include s-maxage=3600 Edge cache header');
  assert.strictEqual(getRes.body.challenges[0].id, 'challenge_silicon_volatility_w2');
});

await runAsyncTest('user-trades enforces deviceToken ownership (403 on mismatch), sanitizes fields, and caps at 5 trades', async () => {
  const mockRedis = createMockRedis();
  await mockRedis.hset('registered_usernames', 'alpha_trader', 'device_token_abc');

  // 1. Reject mismatched device token
  const mismatchRes = createMockRes();
  await userTradesHandler(
    {
      method: 'POST',
      headers: {},
      body: {
        username: 'Alpha_Trader',
        deviceToken: 'wrong_token_999',
        trade: { symbol: 'NVDA', type: 'call', strike: 140, entryPrice: 4.5, exitPrice: 6.2, pnl: 170, pnlPercent: 37.8 },
      },
      _mockRedis: mockRedis,
    },
    mismatchRes
  );
  assert.strictEqual(mismatchRes.statusCode, 403);

  // 2. Accept 6 trades from valid owner and verify cap at 5 + sanitization
  for (let i = 1; i <= 6; i++) {
    const postRes = createMockRes();
    await userTradesHandler(
      {
        method: 'POST',
        headers: {},
        body: {
          username: 'Alpha_Trader',
          deviceToken: 'device_token_abc',
          trade: {
            symbol: `nvda<script>`,
            type: 'call',
            strike: 100 + i * 5,
            entryPrice: 2.5,
            exitPrice: 3.75,
            pnl: 125,
            pnlPercent: 50.0,
            portfolioRiskPercent: 3.2,
            maliciousField: 'should_be_stripped',
          },
        },
        _mockRedis: mockRedis,
      },
      postRes
    );
    assert.strictEqual(postRes.statusCode, 200);
  }

  // 3. GET /api/user-trades?username=Alpha_Trader returns exactly 5 sanitized trades
  const getRes = createMockRes();
  await userTradesHandler(
    {
      method: 'GET',
      headers: {},
      query: { username: 'Alpha_Trader' },
      _mockRedis: mockRedis,
    },
    getRes
  );
  assert.strictEqual(getRes.statusCode, 200);
  assert.strictEqual(getRes.body.trades.length, 5);
  assert.strictEqual(getRes.body.trades[0].symbol, 'NVDASCRIPT');
  assert.strictEqual(getRes.body.trades[0].maliciousField, undefined);
  assert.strictEqual(getRes.body.trades[0].entryPrice, 2.5);
  assert.strictEqual(getRes.body.trades[0].exitPrice, 3.75);
});

console.log('\n════════════════════════════════════════════════════════════════');
console.log(`Results: ${passedTests} / ${totalTests} tests passed.`);
console.log('════════════════════════════════════════════════════════════════\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
