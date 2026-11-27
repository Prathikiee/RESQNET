# RESQNET Dashboard API Contract Proposal

**Status:** Proposal for review only. No endpoint, schema, authentication mechanism, or
acknowledgement behavior in this document is approved or implemented.
**Owners for approval:** Manvitha (dashboard / gateway API) and Medha (security / trust).
**Source drafts:** [wire-protocol-v1.md](./wire-protocol-v1.md) and
[ui-gateway-design.md](./ui-gateway-design.md).

## Scope and repository limitation

This proposal separates gateway ingestion from the three dashboard read interfaces:
incident retrieval, gateway status, and security-event retrieval. It does not implement
API calls, add a backend, select a backend URL, or replace demo data.

The supplied specifications are present and were reviewed. The checked-out repository
does not contain the claimed React 19 + TypeScript + Vite dashboard source: `dashboard/`
contains only a placeholder `test.txt`; there is no package manifest, dashboard types,
data source, or demo data to inspect. The field proposals below are therefore based on
the draft specifications and requirements, not on existing dashboard contracts. Revisit
the shapes against the actual dashboard before implementation.

## Proposal conventions and shared rules

- **PROPOSED** means a candidate endpoint, field, or behavior for review; it is not an
  approved contract. **OPEN** means an owner decision is required. All paths and
  interface-specific fields below are explicitly marked with one or both labels.
- **OPEN:** Choose a consistent timestamp representation and precision. Examples use
  UTC RFC 3339 strings for API timestamps. Wire-envelope epoch-millisecond values remain
  as received; conversion policy is OPEN.
- **PROPOSED:** Use JSON over HTTPS, bounded request/response sizes, strict content-type
  and schema validation, and server-side authorization for every read and write.
  Versioning and content negotiation are OPEN.
- **OPEN:** Define the dashboard identity provider, session/token mechanism, role model,
  CORS policy, and whether dashboard reads use a same-origin backend-for-frontend.
  Gateway credentials are separate from dispatcher authentication.
- Do not put gateway secrets, API tokens, private keys, or credentials in browser-exposed
  React environment variables. Do not log credentials, exact location, or full incident
  payloads.
- Delivery, security verification, sender authorization, and gateway authentication are
  separate concepts. A valid sender signature proves integrity/key possession only; it
  does not establish that the sender is authorized. Gateway authentication identifies
  the submitting gateway; it does not prove that the sender signature, authorization,
  or gateway's verification claims are correct.
- Never treat a client-provided `verified` flag or `verified_payload` as authoritative.
  The backend must apply the finally agreed verification procedure before treating
  incident data as verified. Gateway attestation is evidence to validate, not proof by
  itself.

### Shared delivery and security fields

| Field | Status | Meaning |
|---|---|---|
| `delivery_state` | **PROPOSED** | One of `READY`, `PREPARING_SOS`, `QUEUED_OFFLINE`, `TRANSMITTING`, `FORWARDED_TO_PEER`, `RECEIVED_BY_GATEWAY`, `DELIVERED_TO_DASHBOARD`, `EXPIRED`, `REJECTED_OR_FAILED`. |
| `security.signature_state` | **PROPOSED** | `UNVERIFIED`, `SIGNATURE_VERIFIED`, or `SIGNATURE_INVALID`, reported only as established by the backend's agreed process. |
| `security.sender_authorization_state` | **PROPOSED** | `UNKNOWN`, `SENDER_AUTHORIZED`, or `UNAUTHORIZED_SENDER`; distinct from signature validity. |
| `security.payload_state` | **PROPOSED** | `NOT_DECRYPTED`, `DECRYPTED_SUCCESS`, or `DECRYPTION_FAILED`; distinct from verification and authorization. |
| `security.replay_state` | **PROPOSED** | `NOT_CHECKED`, `CLEAR`, or `REPLAY_DETECTED`. |
| `security.verified_at` | **OPEN** | Server time at which the relevant verification step completed. |

`READY` and `PREPARING_SOS` are sender-side UI states, and `QUEUED_OFFLINE`,
`TRANSMITTING`, and `FORWARDED_TO_PEER` are device/mesh states. The dashboard should
not invent these states if it has no trusted update for them. The backend may expose
them only if a future authenticated state-reporting contract is agreed. `RECEIVED_BY_GATEWAY`
means the gateway has the envelope and is awaiting backend processing;
`DELIVERED_TO_DASHBOARD` means the backend has persistently registered it for dashboard
retrieval, not that a dispatcher acted on it. `EXPIRED` and `REJECTED_OR_FAILED` should
be exposed with a safe reason code where policy permits.

## A. Gateway-to-backend ingestion

### Purpose and endpoint

**PROPOSED** `POST /api/v1/incidents/ingest` — submit one gateway-received envelope for
backend validation, deduplication, and registration. The path is not final; DEC-11 in
the wire protocol also lists `POST /api/v1/sos/envelope` as an alternative.

### Request

**PROPOSED** `Content-Type: application/json`. **OPEN** gateway authentication and
authorization mechanism (for example mTLS, provisioned gateway credentials, or a
combination); the draft lists options but selects none. Credentials must be supplied
through a server/device-managed channel, never a browser-exposed React variable.
**OPEN** whether an `Idempotency-Key` header is required and how long it is retained.

| Field | Status | Proposed use and validation |
|---|---|---|
| `protocol_version` | **PROPOSED** | Required supported protocol version; reject unsupported values explicitly. |
| `message_id` | **PROPOSED** | Required stable unique envelope identifier; validate format and match the envelope identity. |
| `gateway_metadata.gateway_id` | **PROPOSED / OPEN** | Required gateway identifier; bind it to the authenticated principal rather than trusting a conflicting body value. Whether duplicated in the body is OPEN. |
| `gateway_metadata.ingest_timestamp` | **PROPOSED** | Gateway-observed receive time; validate type and plausible range, but use backend receipt time for authoritative server timing. |
| `gateway_metadata.hop_count` | **PROPOSED / OPEN** | Optional non-negative bounded integer if the protocol confirms its meaning and provenance. |
| `gateway_metadata.rssi_dbm` | **PROPOSED / OPEN** | Optional bounded radio measurement; its meaning and retention are OPEN. |
| `envelope` | **PROPOSED** | Required wire envelope with `sender_identity`, `creation_time`, `ttl_expiry`, `priority`, `location_flag`, `recipient_key_id`, `nonce_iv`, `auth_tag`, `signature`, and `encrypted_payload` as specified by the wire draft. Validate required fields, types, encodings, size limits, timestamp order, priority range, and envelope/message ID consistency. Exact encoding and signed canonicalization remain OPEN in the wire draft. |
| `verified_payload` | **OPEN; never trusted as supplied** | Permitted only if Option B is selected. Backend must not accept it as verified based on presence or a client flag; independently validate according to the agreed gateway attestation/trust procedure. Under Option A it is absent. |
| `gateway_attestation` | **OPEN** | Option B only. Exact schema, canonical signing input, key roster, freshness, and trust policy require Medha and Manvitha approval. Validate signature, evidence bindings, hashes, message identity, freshness, and replay status; gateway signature or hardware attestation alone does not establish truthful origin verification. |

The trust architecture is **OPEN** (DEC-12):

1. **Option A — backend decryption and independent verification:** request contains
   `envelope` and gateway metadata only. The backend independently verifies the
   originating signature, sender authorization, replay status, and payload decryption
   according to the final key/trust design.
2. **Option B — gateway decryption/verification with signed evidence:** request may
   contain a parsed incident and gateway-signed evidence, but the backend validates
   that evidence under an agreed trust policy and must not accept assertions as facts
   merely because they are signed by an authenticated gateway.

### Response and acknowledgement

**PROPOSED** success body fields: `message_id`, `acknowledgement_id`, `received_at`,
`delivery_state`, and optionally `incident_id`. **OPEN** status code and exact response
shape. The wire draft suggests `201 Created` for first receipt and `200 OK` for a
duplicate, while also mentioning `409 Conflict`; it also proposes an `action` value
that implies dashboard dispatch. Do not use `DISPATCHED_TO_DASHBOARD` unless that
separate effect is actually guaranteed and its meaning is approved.

**OPEN acknowledgement semantics:** define exactly whether the acknowledgement confirms
HTTP receipt, backend validation, durable persistence, incident registration, or
dashboard availability. Only the agreed durable-registration confirmation may advance
delivery to `DELIVERED_TO_DASHBOARD`. How that acknowledgement travels back over the
offline mesh is also OPEN (DEC-13: reverse-path, gossip, or direct-range confirmation).

### Validation, duplicates, errors, and freshness

- **PROPOSED:** validate content type, body size, schema, field bounds, supported
  protocol version, message/envelope consistency, expiry, authorization of the gateway,
  and replay state. Perform sender signature verification, sender authorization, and
  payload decryption independently as required by the selected architecture.
- **PROPOSED:** deduplicate atomically by `message_id` (and reject conflicting content
  for an already-used ID). An identical retry returns the original acknowledgement and
  incident reference without creating a second incident. **OPEN:** retention window,
  ID scope, and response code/body for duplicates.
- **PROPOSED:** return structured errors with stable `code`, safe `message`, optional
  `correlation_id`, and field-level details that do not leak secrets or payloads.
  Draft examples include `400` malformed input, `401`/`403` gateway auth/authorization,
  and `422` invalid cryptographic content or expired TTL. **OPEN:** final status codes,
  retryability indicator, and error taxonomy; use a retryable server failure for
  temporary backend unavailability only after that policy is agreed.
- **PROPOSED:** preserve source creation/expiry timestamps and separately record
  gateway-observed and backend-received times. Reject expired messages per final
  TTL policy. **OPEN:** clock-skew tolerance and whether late-arriving expired envelopes
  are rejected or retained as security/audit events.

## B. Backend-to-dashboard incident retrieval

### Purpose and endpoint

**PROPOSED** `GET /api/v1/incidents` — retrieve paginated, backend-registered incidents
for authorized dashboard users. **OPEN:** final path, access policy, filters, and
whether this is served directly or through a backend-for-frontend.

### Request

| Query field | Status | Proposed validation |
|---|---|---|
| `cursor` | **PROPOSED / OPEN** | Opaque server-issued pagination cursor; validate and bind it to the caller's access scope. Cursor versus offset pagination is OPEN. |
| `limit` | **PROPOSED / OPEN** | Positive bounded integer with a server maximum; exact default and maximum are OPEN. |
| `updated_since` | **PROPOSED / OPEN** | Optional timestamp for incremental refresh; validate format and supported retention window. |
| `delivery_state` | **PROPOSED / OPEN** | Optional filter restricted to the shared enum; unsupported states/filters return validation errors. |
| `priority`, `category`, `from`, `to` | **PROPOSED / OPEN** | Optional filters; valid categories, priority range, time zone, inclusive/exclusive boundaries, and location/category privacy are OPEN. |

### Response

**PROPOSED** `200` response fields:

| Field | Status | Meaning |
|---|---|---|
| `items[]` | **PROPOSED** | Page of incident records. Each record includes `incident_id`, `message_id`, `created_at`, `received_at`, `updated_at`, `category`, `priority`, `description`, `location`, `delivery_state`, and `security` as defined below. Exact names are OPEN against the actual dashboard types, which were unavailable in this checkout. |
| `location.status` | **PROPOSED** | `LOCATION_AVAILABLE` or `LOCATION_UNAVAILABLE`; do not infer coordinates from missing values. |
| `location.latitude`, `location.longitude`, `location.accuracy_meters`, `location.timestamp` | **PROPOSED / OPEN** | Present only when authorized and valid; enforce coordinate and accuracy bounds and location access policy. Exact precision/retention is OPEN. |
| `security` | **PROPOSED** | Separate `signature_state`, `sender_authorization_state`, `payload_state`, `replay_state`, and optional `verified_at`; never a single conflated `verified` property. |
| `next_cursor`, `server_time` | **PROPOSED / OPEN** | Continuation cursor and backend timestamp; naming and timestamp representation are OPEN. |

Do not return encrypted payload, cryptographic keys, gateway credentials, or unnecessary
raw envelope data to the browser. **OPEN:** whether incident descriptions and exact
coordinates are returned to all dispatchers or are role/need-to-know restricted.

### Validation, duplicates, errors, and freshness

- **PROPOSED:** enforce authenticated dispatcher access, authorization scope, bounded
  query values, valid time ranges, and cursor integrity. Return only incidents that
  satisfy the backend's agreed admission/verification policy.
- Ingestion deduplication is authoritative; retrieval must not produce multiple
  dashboard records for retries of the same accepted `message_id`. **PROPOSED:** stable
  `incident_id` and deterministic ordering by update time plus unique ID.
- **PROPOSED:** standard errors: `400` invalid query/cursor, `401` unauthenticated,
  `403` unauthorized, `429` rate limit, and `5xx` service failure. **OPEN:** final
  status codes and shared error envelope.
- **PROPOSED:** include `updated_at` and `server_time` and support incremental refresh
  with cursor or `updated_since`. **OPEN:** freshness target, polling/streaming choice,
  cache controls, and behavior when the dashboard is stale or disconnected. No
  real-time guarantee is implied.

## C. Backend-to-dashboard gateway status

### Purpose and endpoint

**PROPOSED** `GET /api/v1/gateways/status` — retrieve operational/connection status for
gateways visible to the authenticated dispatcher. **OPEN:** endpoint path, visibility
scope, and whether status is polled or pushed.

### Request and response

**PROPOSED** request supports the shared bounded pagination fields (`cursor`, `limit`)
and optional `gateway_id` filter; exact filters and access scope are **OPEN**.

**PROPOSED** `200` response fields:

| Field | Status | Meaning and validation |
|---|---|---|
| `items[].gateway_id` | **PROPOSED** | Stable server-known gateway identifier; validate/filter by caller authorization. |
| `items[].connection_state` | **PROPOSED / OPEN** | Candidate values `ONLINE`, `DEGRADED`, `OFFLINE`, `UNKNOWN`; final enum and definition are OPEN. |
| `items[].last_seen_at` | **PROPOSED** | Backend-observed last contact timestamp, not a client assertion. |
| `items[].last_successful_ingest_at` | **PROPOSED / OPEN** | Last accepted ingestion time, if measured; definition is OPEN. |
| `items[].pending_upload_count` | **PROPOSED / OPEN** | Optional non-negative count only if reliably available; do not imply mesh queue visibility if backend cannot observe it. |
| `items[].software_version` | **OPEN** | Include only if approved, necessary, and privacy-reviewed. |
| `server_time`, `next_cursor` | **PROPOSED / OPEN** | Server time and pagination continuation. |

### Validation, duplicates, errors, and freshness

- **PROPOSED:** require authenticated and authorized dispatcher access; validate cursor,
  bounded limit, and gateway filter. Status must be derived from authenticated backend
  observations/heartbeats, not an unauthenticated client-supplied `online` flag.
- Duplicate semantics are not applicable to this read; **PROPOSED:** one latest status
  record per authorized `gateway_id`, with stable ordering. **OPEN:** whether history
  is also exposed and for how long.
- **PROPOSED:** use the shared read error envelope for `400`, `401`, `403`, `429`, and
  `5xx`; final codes are **OPEN**.
- **PROPOSED:** include `last_seen_at` and `server_time`; stale status should be
  represented as `UNKNOWN` or a separately approved stale indicator rather than
  silently presented as live. **OPEN:** heartbeat interval, stale threshold, freshness
  SLO, refresh interval, and push versus polling.

## D. Backend-to-dashboard security-event retrieval

### Purpose and endpoint

**PROPOSED** `GET /api/v1/security-events` — retrieve authorized, redacted security
events for dashboard review. **OPEN:** path, role permissions, retention, and audit
requirements.

### Request and response

**PROPOSED** request supports bounded pagination (`cursor`, `limit`) and optional
`from`, `to`, `event_type`, `message_id`, `gateway_id`, and `severity` filters. All
filters and their access scope are **OPEN**; validate timestamps, enum values, ID
formats, ranges, and maximum page size.

**PROPOSED** `200` response fields:

| Field | Status | Meaning and validation |
|---|---|---|
| `items[].event_id` | **PROPOSED** | Stable unique server event identifier. |
| `items[].occurred_at`, `items[].recorded_at` | **PROPOSED / OPEN** | Event/source time and backend ingestion time; define authoritative timestamp and skew policy. |
| `items[].event_type` | **PROPOSED / OPEN** | Candidate types include `SIGNATURE_FAILED`, `DECRYPTION_FAILED`, `REPLAY_REJECTED`, `UNTRUSTED_SENDER_REJECTED`, and `GATEWAY_AUTH_FAILURE`; final taxonomy is OPEN. |
| `items[].severity` | **PROPOSED / OPEN** | Severity enum and mapping are OPEN. |
| `items[].message_id`, `items[].gateway_id` | **PROPOSED / OPEN** | Correlation references only where available and authorized. |
| `items[].signature_state`, `items[].sender_authorization_state`, `items[].payload_state`, `items[].replay_state` | **PROPOSED / OPEN** | Separate security outcomes; do not conflate verification with sender authorization or delivery state. |
| `items[].delivery_state` | **PROPOSED / OPEN** | Optional related delivery state from the canonical enum; security events are not themselves delivery acknowledgements. |
| `items[].reason_code` | **PROPOSED / OPEN** | Safe machine-readable reason; detailed taxonomy is OPEN. |
| `items[].details` | **PROPOSED / OPEN** | Redacted, non-sensitive diagnostic context only; exact allowlist is OPEN. |
| `server_time`, `next_cursor` | **PROPOSED / OPEN** | Server time and pagination continuation. |

Never include secrets, raw tokens, private keys, ciphertext/plaintext payload, or routine
high-precision location in event details or logs. Sender identifiers should be minimized
or pseudonymized if policy requires it.

### Validation, duplicates, errors, and freshness

- **PROPOSED:** enforce authenticated, role-authorized access; validate filters and
  pagination; redact fields server-side before serialization. UI hiding is not an
  authorization boundary.
- Duplicate events should not be confused with duplicate incidents. **PROPOSED:** issue
  a stable `event_id` and deduplicate event ingestion using a server-defined event key.
  **OPEN:** event-key composition, retention, and whether repeated attempts are grouped
  or shown individually.
- **PROPOSED:** use the shared read error envelope for `400`, `401`, `403`, `429`, and
  `5xx`; final codes are **OPEN**.
- **PROPOSED:** provide `recorded_at`, server time, and cursor-based incremental reads.
  **OPEN:** maximum event delay, retention period, cache policy, and polling versus
  push delivery.

## Decisions requiring approval

Manvitha and Medha should resolve the API/security decisions before implementation:

1. **Ingestion architecture (DEC-12, OPEN; Manvitha + Medha):** select backend
   decryption and independent verification (Option A) or gateway decryption with
   independently validated attestation evidence (Option B). Approve key ownership,
   sender trust/authorization policy, exact evidence/signature format, and replay policy.
2. **Authentication (OPEN; Manvitha + Medha):** choose gateway-to-backend authentication
   and dashboard user authentication/authorization separately. Define credential
   provisioning, rotation, revocation, roles, and whether dashboard traffic goes through
   a backend-for-frontend. Confirm no gateway secret is browser-exposed.
3. **Endpoint paths and API specification (DEC-11, OPEN; Manvitha):** choose the
   ingestion path and approve paths, versioning, request/response schemas, query
   filters, and OpenAPI specification for all four interfaces.
4. **Acknowledgement semantics (DEC-11 / DEC-13, OPEN; Manvitha + Medha, with Pooja
   and Prathik for mesh return path):** decide what event an ACK confirms, when
   `DELIVERED_TO_DASHBOARD` may be set, first-versus-duplicate status/body behavior,
   acknowledgement identity/correlation, and how ACKs propagate to an offline sender.
5. **Dashboard trust and status presentation (OPEN; Manvitha + Medha):** approve which
   verification, authorization, decryption, replay, and delivery facts can be shown;
   decide location access/precision and security-event redaction/roles.
6. **Freshness and operational behavior (OPEN; Manvitha):** set incident/gateway/event
   freshness targets, status heartbeat and stale thresholds, pagination limits,
   polling/push strategy, retryability, rate limits, and error taxonomy.
7. **Field compatibility (OPEN; Manvitha):** compare these proposals with the actual
   dashboard TypeScript types, data source, and demo fixtures when those files are
   available; resolve field names and UI-compatible states before implementation.
