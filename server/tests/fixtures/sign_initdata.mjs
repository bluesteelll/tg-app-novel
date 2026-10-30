// Independent initData signer: produces the server's initData test vectors with Node's own `crypto`, so the Rust
// validator is checked against a second implementation of the Telegram algorithm, not against itself.
//
// Algorithm (core.telegram.org/bots/webapps, "Validating data received via the Mini App"):
//   secret = HMAC-SHA256(key = "WebAppData", msg = bot_token)
//   dcs    = every received field except `hash` (decoded values), sorted by key, "key=value" joined by "\n"
//   hash   = hex(HMAC-SHA256(key = secret, msg = dcs))
// `signature` stays in the dcs; no field is whitelisted.
//
// Usage (from the repository root):
//   node server/tests/fixtures/sign_initdata.mjs --write          writes initdata_vectors.json next to this script
//   node server/tests/fixtures/sign_initdata.mjs --check [path]   exit 1 unless `path` (default: the committed file)
//                                                                 is byte-identical to a fresh generation
//   node server/tests/fixtures/sign_initdata.mjs --fresh <uid> [lang]
//                                                                 prints one valid raw initData signed now (manual
//                                                                 runs against a live server; never committed)
//
// Deterministic: a fixed `now`, fixed fields and synthetic users only. No import from the repository and no npm
// package. The script writes the file itself (a PowerShell `>` would write UTF-16 with a BOM).

import { createHash, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/** The `.env.example` placeholder bot token (server/src/config.rs PLACEHOLDER_BOT_TOKEN). */
const BOT_TOKEN = '1000000001:placeholder-bot-token-not-a-real-one';
/** `INITDATA_MAX_AGE_SECS` of `.env.example` and of the integration-test config. */
const MAX_AGE_SECS = 86400;
/** The fixed "server now" of every vector, in unix seconds. */
const NOW = 1790000000;
const VECTORS_FILE = fileURLToPath(new URL('./initdata_vectors.json', import.meta.url));

const SECRET = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
/** A synthetic 86-character base64url value in the shape of Telegram's Ed25519 `signature`. */
const SIGNATURE = createHash('sha512').update('synthetic signature, not Ed25519').digest('base64url');
const QUERY_ID = 'AAHdF6IQAAAAAN0XohDhrOrc';

/** Telegram's user JSON escapes `/` as `\/` (as PHP's json_encode does); JSON.stringify does not. */
function userJson(user) {
  return JSON.stringify(user).replace(/\//g, '\\/');
}

function dataCheckString(pairs) {
  return pairs
    .filter(([key]) => key !== 'hash')
    .slice()
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function hashOf(pairs, secret = SECRET) {
  return createHmac('sha256', secret).update(dataCheckString(pairs)).digest('hex');
}

/** The query string as a client sends it: values percent-encoded (a space as `%20`). */
function rawOf(pairs) {
  return pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
}

const ANN = {
  id: 1001,
  first_name: 'Ann',
  last_name: 'Test',
  username: 'ann_test',
  language_code: 'ru',
  allows_write_to_pm: true,
  photo_url: 'https://t.me/i/userpic/320/ann_test.svg',
};
const ANN_EXPECT = { id: 1001, first_name: 'Ann', language_code: 'ru' };

function base(authDate = NOW - 100, user = ANN) {
  return [
    ['query_id', QUERY_ID],
    ['user', userJson(user)],
    ['auth_date', String(authDate)],
  ];
}

/** `pairs` signed, with `hash` appended. */
function signed(pairs) {
  return [...pairs, ['hash', hashOf(pairs)]];
}

/** Replaces the value of `key` in already-signed pairs (a tamper after signing). */
function replaced(pairs, key, value) {
  return pairs.map(([k, v]) => (k === key ? [k, value] : [k, v]));
}

function vector(name, pairs, expect, user = null, raw = rawOf(pairs)) {
  const v = { name, init_data: raw, expect };
  if (expect === 'ok') {
    v.user = user;
  }
  return v;
}

function vectors() {
  const out = [];

  out.push(vector('valid', signed(base()), 'ok', ANN_EXPECT));

  const noLang = { ...ANN };
  delete noLang.language_code;
  out.push(
    vector('valid_no_language', signed(base(NOW - 100, noLang)), 'ok', {
      id: 1001,
      first_name: 'Ann',
      language_code: null,
    }),
  );

  out.push(vector('tampered_user', replaced(signed(base()), 'user', userJson({ ...ANN, id: 1002 })), 'BadHash'));
  out.push(vector('tampered_auth_date', replaced(signed(base()), 'auth_date', String(NOW - 50)), 'BadHash'));
  out.push(
    vector(
      'expired_tampered',
      replaced(signed(base(NOW - MAX_AGE_SECS - 1)), 'user', userJson({ ...ANN, id: 1002 })),
      'BadHash',
    ),
  );
  out.push(vector('missing_hash', base(), 'MissingHash'));
  out.push(vector('expired', signed(base(NOW - MAX_AGE_SECS - 1)), 'Expired'));
  out.push(vector('age_at_limit', signed(base(NOW - MAX_AGE_SECS)), 'ok', ANN_EXPECT));
  out.push(vector('future', signed(base(NOW + 61)), 'FromFuture'));
  out.push(vector('future_within_skew', signed(base(NOW + 60)), 'ok', ANN_EXPECT));

  const fields = base();
  const hash = hashOf(fields);
  out.push(
    vector(
      'reordered',
      [['hash', hash], ['auth_date', fields[2][1]], ['query_id', fields[0][1]], ['user', fields[1][1]]],
      'ok',
      ANN_EXPECT,
    ),
  );

  const anna = {
    id: 1001,
    first_name: 'Анна-Мария & Co = 1+1 = 100%',
    last_name: "O'Neil Smith",
    username: 'anna_test',
    language_code: 'en',
    allows_write_to_pm: true,
    photo_url: 'https://t.me/i/userpic/320/anna_test.svg',
  };
  out.push(
    vector(
      'encoded',
      signed([...base(NOW - 100, anna), ['chat_instance', '-3788475317572404878'], ['chat_type', 'private']]),
      'ok',
      { id: 1001, first_name: anna.first_name, language_code: 'en' },
    ),
  );

  const lee = { ...ANN, first_name: 'Ann Lee' };
  const leePairs = signed(base(NOW - 100, lee));
  const leeRaw = leePairs
    .map(([key, value]) => {
      const encoded = encodeURIComponent(value);
      return `${key}=${key === 'user' ? encoded.replace(/%20/g, '+') : encoded}`;
    })
    .join('&');
  if (!leeRaw.includes('Ann+Lee')) {
    throw new Error('plus_as_space: the raw form has no "+" for the space');
  }
  out.push(vector('plus_as_space', leePairs, 'ok', { id: 1001, first_name: 'Ann Lee', language_code: 'ru' }, leeRaw));

  out.push(vector('duplicate_auth_date', signed([...base(), ['auth_date', String(NOW - 200)]]), 'DuplicateKey'));
  const valid = signed(base());
  out.push(vector('duplicate_hash', [...valid, valid[valid.length - 1]], 'DuplicateKey'));

  out.push(
    vector(
      'unknown_field',
      signed([...base(), ['chat_join_request_query_id', '1234567'], ['zz_future_field', 'any value']]),
      'ok',
      ANN_EXPECT,
    ),
  );
  out.push(vector('unsigned_extra_field', [...signed(base()), ['extra', '1']], 'BadHash'));
  out.push(vector('with_signature', signed([...base(), ['signature', SIGNATURE]]), 'ok', ANN_EXPECT));
  out.push(vector('signature_excluded_from_dcs', [...signed(base()), ['signature', SIGNATURE]], 'BadHash'));

  out.push(vector('no_user', signed([base()[0], base()[2]]), 'MissingUser'));
  out.push(vector('no_auth_date', signed([base()[0], base()[1]]), 'Malformed'));
  out.push(vector('auth_date_not_integer', signed(replaced(base(), 'auth_date', `${NOW - 100}.5`)), 'Malformed'));
  out.push(vector('user_not_json', signed(replaced(base(), 'user', 'Ann')), 'Malformed'));
  out.push(vector('user_without_id', signed(replaced(base(), 'user', userJson({ first_name: 'Ann' }))), 'Malformed'));

  return out;
}

/** The committed file's exact text: 2-space JSON, LF, a final newline, every non-ASCII char `\u`-escaped. */
function render() {
  const doc = {
    generator: 'server/tests/fixtures/sign_initdata.mjs',
    bot_token: BOT_TOKEN,
    max_age_secs: MAX_AGE_SECS,
    now: NOW,
    vectors: vectors(),
  };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  return text.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function fresh(uidText, lang) {
  const uid = Number(uidText);
  if (!/^[0-9]+$/.test(uidText ?? '') || !Number.isSafeInteger(uid) || uid <= 0) {
    usage(`--fresh needs a positive integer user id, got ${JSON.stringify(uidText)}`);
  }
  const user = { id: uid, first_name: 'Dev', last_name: 'Seen', username: 'dev_seen', allows_write_to_pm: true };
  if (lang !== undefined) {
    user.language_code = lang;
  }
  const now = Math.floor(Date.now() / 1000);
  return rawOf(signed(base(now, user)));
}

function usage(problem) {
  process.stderr.write(
    `${problem}\nusage: sign_initdata.mjs --write | --check [path] | --fresh <uid> [lang]\n`,
  );
  process.exit(2);
}

const [mode, ...args] = process.argv.slice(2);
switch (mode) {
  case '--write': {
    writeFileSync(VECTORS_FILE, render(), 'utf8');
    process.stdout.write(`wrote ${VECTORS_FILE}\n`);
    break;
  }
  case '--check': {
    const path = args[0] ?? VECTORS_FILE;
    const expected = Buffer.from(render(), 'utf8');
    let actual;
    try {
      actual = readFileSync(path);
    } catch (e) {
      process.stderr.write(`cannot read ${path}: ${e.message}\n`);
      process.exit(1);
    }
    if (!actual.equals(expected)) {
      let at = 0;
      while (at < actual.length && at < expected.length && actual[at] === expected[at]) {
        at += 1;
      }
      process.stderr.write(
        `MISMATCH ${path}: first differing byte at offset ${at} (file ${actual.length} B, generated ${expected.length} B)\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`OK ${path} matches the generator (${expected.length} B)\n`);
    break;
  }
  case '--fresh': {
    process.stdout.write(`${fresh(args[0], args[1])}\n`);
    break;
  }
  default:
    usage(`unknown mode ${JSON.stringify(mode)}`);
}
