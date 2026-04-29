import type { SlackFixture, SlackFixtureRaw } from "./fixture-types.ts";

const TOKEN_PATTERN = /(xox[bpars]|xapp)-[A-Za-z0-9-]+/g;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const USER_ID_TEST = /^U[A-Z0-9]{6,}$/;

const ID_PREFIXES = ["U", "T", "C", "D", "G", "E", "F"] as const;
type IdPrefix = (typeof ID_PREFIXES)[number];

const ID_PATTERNS: ReadonlyArray<readonly [IdPrefix, RegExp]> = ID_PREFIXES.map(
  (p) => [p, new RegExp(`\\b${p}[A-Z0-9]{6,}\\b`, "g")] as const,
);

const NAME_KEYS = new Set(["real_name", "display_name", "name"]);
const TEXT_KEYS = new Set(["text"]);

interface RedactState {
  idCounters: Map<IdPrefix, Map<string, number>>;
  emailCounter: Map<string, number>;
  textCounter: { value: number };
}

function newState(): RedactState {
  return {
    idCounters: new Map(ID_PREFIXES.map((p) => [p, new Map<string, number>()])),
    emailCounter: new Map(),
    textCounter: { value: 0 },
  };
}

function getIdN(state: RedactState, prefix: IdPrefix, original: string): number {
  const map = state.idCounters.get(prefix) as Map<string, number>;
  const cached = map.get(original);
  if (cached !== undefined) return cached;
  const n = map.size + 1;
  map.set(original, n);
  return n;
}

function idReplacement(state: RedactState, prefix: IdPrefix, original: string): string {
  return `${prefix}_TEST_${String(getIdN(state, prefix, original)).padStart(3, "0")}`;
}

function getEmailN(state: RedactState, email: string): number {
  const cached = state.emailCounter.get(email);
  if (cached !== undefined) return cached;
  const n = state.emailCounter.size + 1;
  state.emailCounter.set(email, n);
  return n;
}

function emailReplacement(state: RedactState, email: string): string {
  return `user-${getEmailN(state, email)}@example.test`;
}

function redactString(state: RedactState, value: string): string {
  let out = value.replace(TOKEN_PATTERN, "xoxb-test-token");
  out = out.replace(EMAIL_PATTERN, (match) => emailReplacement(state, match));
  for (const [prefix, regex] of ID_PATTERNS) {
    out = out.replace(regex, (match) => idReplacement(state, prefix, match));
  }
  return out;
}

function nextTextReplacement(state: RedactState): string {
  state.textCounter.value += 1;
  return `redacted-message-${state.textCounter.value}`;
}

function derivePersonIndex(state: RedactState, obj: Record<string, unknown>): number | null {
  const email = obj.email;
  if (typeof email === "string") {
    return getEmailN(state, email);
  }
  const id = obj.id;
  if (typeof id === "string" && USER_ID_TEST.test(id)) {
    return getIdN(state, "U", id);
  }
  return null;
}

function redactValue(state: RedactState, value: unknown, parentIndex: number | null): unknown {
  if (typeof value === "string") {
    return redactString(state, value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(state, v, parentIndex));
  }
  if (typeof value === "object" && value !== null) {
    return redactObject(state, value as Record<string, unknown>, parentIndex);
  }
  return value;
}

function redactObject(
  state: RedactState,
  obj: Record<string, unknown>,
  parentIndex: number | null = null,
): Record<string, unknown> {
  const entityIndex = derivePersonIndex(state, obj) ?? parentIndex;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (TEXT_KEYS.has(k) && typeof v === "string") {
      out[k] = nextTextReplacement(state);
      continue;
    }
    if (NAME_KEYS.has(k) && typeof v === "string") {
      if (entityIndex !== null) {
        out[k] = `User ${entityIndex}`;
        continue;
      }
      out[k] = redactString(state, v);
      continue;
    }
    out[k] = redactValue(state, v, entityIndex);
  }
  return out;
}

function redactParams(
  state: RedactState,
  params: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (params === null) return null;
  return redactObject(state, params, null);
}

export function redactFixture(raw: SlackFixtureRaw): SlackFixture {
  const state = newState();
  return {
    method: raw.method,
    params: redactParams(state, raw.params),
    status: raw.status,
    data: redactObject(state, raw.data, null),
    recorded_at: raw.recorded_at,
    redacted: true,
  };
}
