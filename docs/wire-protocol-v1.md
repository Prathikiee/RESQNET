# RESQNET Wire Protocol Specification (v1 Draft)

**Document Status:** DRAFT FOR TEAM REVIEW
**Revision:** v1.4-draft
**Date:** 2026-10-27
**Target Repository:** `RESQNET` (`main` branch)
**Authors / Module Owners:**
- **Prathik:** Mesh transport, radio abstraction, packet framing, and peer interfaces
- **Medha:** Cryptographic envelope, key management, trust policy, and security validation
- **Pooja:** DTN store-carry-forward engine, Room persistence, deduplication, and retry policy
- **Manvitha:** SOS data fields, Gateway REST API, acknowledgement tracking, and Android/Dashboard UI states

---

## Document Conventions and Status Notice

> [!IMPORTANT]
> **Implementation and Verification Status:**
> This specification is a **collaborative design draft for team review**. Subsystem implementations, radio drivers, cryptographic modules, and integration tests across Android and backend services are **not yet implemented or verified** (as documented in `security-design.md`, `dtn-design.md`, `ui-gateway-design.md`, and `device-inventory.md`).
> All team members commit directly to the shared `main` branch. This document establishes technical alignment before code is written, preventing architectural divergence across subsystems.

Throughout this specification, statements are tagged with one of three explicit labels:
1. `[ESTABLISHED REQUIREMENT]`: Grounded directly and explicitly in existing foundational design documentation (`security-design.md`, `dtn-design.md`, `ui-gateway-design.md`, or `device-inventory.md`). A detail is marked established **only** if explicitly stated in those documents.
2. `[PROPOSED SPECIFICATION]`: Concrete engineering proposal introduced in this draft for protocol consistency, submitted for team critique and review.
3. `[OPEN - Owner]`: Unresolved design question or architectural choice requiring explicit investigation, benchmark, or sign-off by the named owner.

---

## 1. Purpose, Scope, and Terminology

### 1.1 Purpose
`[ESTABLISHED REQUIREMENT]` RESQNET is an Android-based, security-aware offline emergency communication mesh designed to operate when cellular and internet infrastructure fail.
The purpose of this Wire Protocol Specification is to define the hop-by-hop and end-to-end data formats, cryptographic contracts, DTN handling rules, transport framing boundaries, and gateway ingestion interfaces necessary for multi-hop emergency SOS message relay.

### 1.2 Scope
This document governs:
- The byte-level and field-level structure of the SOS message envelope.
- The cryptographic boundaries separating asymmetric digital signatures from symmetric payload encryption.
- The DTN storage, priority, queueing, and deduplication rules on Android nodes.
- The peer discovery and packet framing contracts for Bluetooth Low Energy (BLE) and Wi-Fi Direct.
- The REST API contract for gateway submission to the Web Command Dashboard.
- Structured logging guidelines and privacy constraints.

### 1.3 Terminology and Cryptographic Separation
- **Originating Node (Source):** The Android device on which a human user triggers an emergency SOS.
- **Relay / Forwarding Node:** An intermediary Android mesh node that receives, stores, carries, and forwards envelopes. **Relay nodes do not possess the symmetric encryption keys and cannot decrypt confidential payload contents. Relays verify Ed25519 signatures over the envelope to filter corrupted or spam frames, but MUST NOT attempt or be expected to decrypt payloads without an explicitly authorized decryption key.**
- **Gateway Node:** An Android node with active network reachability (cellular, satellite, or emergency LAN) capable of relaying verified envelopes to the Web Command Dashboard.
- **Web Command Dashboard:** The incident-management monitoring console operated by emergency dispatchers.
- **Message Envelope:** The outer data container comprising unencrypted routing headers, security metadata, digital signatures, and encrypted payload.
- **Protected Payload:** The confidential application-level incident details (GPS coordinates, emergency category, incident description) encrypted end-to-end.
- **Time-to-Live (TTL):** The temporal expiration timestamp and hop budget beyond which a message is discarded (`[ESTABLISHED REQUIREMENT]`, `dtn-design.md`).
- **Store-Carry-Forward (DTN):** Delay-Tolerant Networking pattern where messages are persisted in non-volatile storage while disconnected and forwarded upon peer contact (`[ESTABLISHED REQUIREMENT]`, `dtn-design.md`).
- **Cryptographic Key Separation:**
  - **Ed25519 Signing Key Pair (Asymmetric):** Originating node holds a private signing key in Android Keystore. Relays, gateways, and the backend use the sender's public key (or public key fingerprint) strictly for **authenticity verification and tamper detection**. An Ed25519 key **cannot** directly encrypt the payload.
  - **AES-256-GCM Key (256-bit Symmetric):** Dedicated 256-bit secret key used exclusively for authenticated encryption and decryption of the confidential payload. Held by the originating node and authorized emergency decryptors (gateways or backend).
- **Signature Validity vs. Sender Authorization:** A mathematically valid Ed25519 signature establishes only that the message envelope was created by the entity in possession of the private key corresponding to `sender_identity` and has not been altered in transit. **A valid signature does NOT establish that the sender is authorized, legitimate, or trusted.** Verification of cryptographic integrity is distinct from authorization against a trust policy (`[OPEN - Medha]`).
- **Nonce / IV:** Cryptographic number used once with AES-256-GCM. **A nonce must never repeat with the same AES-GCM key.** Neither random nonces nor persistent counters are automatically safe without rigorous operational justification.
- **AAD (Additional Authenticated Data):** Unencrypted envelope header fields bound into the AES-256-GCM authentication tag to prevent tampering with routing metadata.
- **Acknowledgement Levels:**
  1. *Transport Link ACK:* Hop-by-hop confirmation that raw chunk/socket bytes were received by an immediate radio neighbor.
  2. *Relay Acceptance:* Confirmation that an intermediary node validated packet structure and signature, and committed the envelope to its local DTN queue.
  3. *Gateway Receipt:* Confirmation that an authorized gateway received and authenticated the envelope from the mesh.
  4. *Dashboard Incident Registration:* Confirmation that the backend API processed, validated, deduplicated, and persistently registered the incident for display.

---

## 2. Proposed End-to-End SOS Message Lifecycle

The proposed lifecycle spans four participating subsystems: Android SOS UI, DTN Engine, Mesh Transport, and Gateway / Command Dashboard.

```
+--------------------------------------------------------------------------------------------------+
|                                    ORIGINATING NODE (Sender)                                     |
|                                                                                                  |
| [User Triggers SOS in UI]                                                                        |
|        |                                                                                         |
|        v                                                                                         |
| [1. UI Captures Category, Text, & GPS Status]                                                    |
|        |                                                                                         |
|        v                                                                                         |
| [2. Crypto: Encrypt Payload with AES-256-GCM & Sign Envelope with Ed25519]                       |
|        |                                                                                         |
|        v                                                                                         |
| [3. DTN: Atomically Store in Room DB & Enqueue in Bounded Priority Queue]                        |
+-----------------------------------------------------|--------------------------------------------+
                                                      |
                                                      v (BLE / Wi-Fi Direct Framing)
+--------------------------------------------------------------------------------------------------+
|                                  FORWARDING RELAY NODE (Hop N)                                   |
|                                                                                                  |
| [4. Radio Ingest & Chunk Reassembly]                                                             |
|        |                                                                                         |
|        v                                                                                         |
| [5. Basic Structural & Wire Validation]                                                          |
|        |                                                                                         |
|        v                                                                                         |
| [6. Security: Verify Ed25519 Signature over Canonical Header & Ciphertext]                       |
|     (Relay DOES NOT decrypt AES-256-GCM payload; lacks decryption key)                           |
|        |                                                                                         |
|        v                                                                                         |
| [7. DTN: Deduplication Check & Persistent Room DB Storage]                                       |
|        |                                                                                         |
|        v                                                                                         |
| [8. DTN: Store-Carry-Forward upon Reconnection with Peer or Gateway]                             |
+-----------------------------------------------------|--------------------------------------------+
                                                      |
                                                      v (Mesh Transfer)
+--------------------------------------------------------------------------------------------------+
|                                       GATEWAY NODE                                               |
|                                                                                                  |
| [9. Gateway Ingest & Ed25519 Signature Verification]                                             |
|        |                                                                                         |
|        +-----------------------------------+-----------------------------------+                 |
|        |                                                                       |                 |
|        v (Option A: Relay Only)                                                v (Option B: Decrypt)
| [10A. Forward Encrypted Envelope to Backend]                   [10B. Sender Authorization Check] |
|                                                                                |                 |
|                                                                                v                 |
|                                                                [11B. AES-256-GCM Decryption]     |
|                                                                                |                 |
|                                                                                v                 |
|                                                                [12B. Forward Incident + Evidence]|
+-----------------------------------------------------|--------------------------|-----------------+
                                                      |                          |
                                                      v (HTTPS / TLS API Call)   v
+--------------------------------------------------------------------------------------------------+
|                                   WEB COMMAND DASHBOARD / BACKEND                                |
|                                                                                                  |
| [13. Authenticate Gateway Connection (mTLS / Token)]                                             |
|        |                                                                                         |
|        v                                                                                         |
| [14. Enforce Trust Boundary:                                                                     |
|      Option A: Backend independently verifies signature, authorizes sender, & decrypts payload.   |
|      Option B: Backend verifies gateway sig vs authorized key, evidence, & replay/dedup.]        |
|        |                                                                                         |
|        v                                                                                         |
| [15. Render Verified Incident on Dispatcher Console & Issue Persistent Registration ACK]         |
+--------------------------------------------------------------------------------------------------+
```

### Detailed Phase Progression:
1. **Origination & Input Capture (Owner: Manvitha):**
   The user selects an emergency category, enters message text, and initiates transmission (`[ESTABLISHED REQUIREMENT]`, `ui-gateway-design.md`). The Android app queries location services. If coordinates are denied or unavailable, the envelope is flagged as `LOCATION_UNAVAILABLE` without blocking transmission (`[ESTABLISHED REQUIREMENT]`, `ui-gateway-design.md`).
2. **Cryptographic Sealing (Owner: Medha):**
   `[ESTABLISHED REQUIREMENT]` Authenticated payload encryption uses AES-256-GCM, and digital signatures use Ed25519 (`security-design.md`).
   `[PROPOSED SPECIFICATION]` The confidential payload is encrypted using a 256-bit symmetric AES key (key distribution scheme is `[OPEN - Medha]`). An Ed25519 digital signature is calculated over the canonical header and ciphertext using the originating node's private key held in Android Keystore (`[ESTABLISHED REQUIREMENT]`, `security-design.md`).
3. **DTN Persistence & Local Queueing (Owner: Pooja):**
   `[ESTABLISHED REQUIREMENT]` The envelope is validated, written to the local SQLite/Room database in a safe transaction, and assigned to a bounded priority queue (`dtn-design.md`). Initial delivery state is `QUEUED_OFFLINE` (`[ESTABLISHED REQUIREMENT]`, `ui-gateway-design.md`).
4. **Mesh Discovery & Hop Transmission (Owner: Prathik):**
   Candidate peers are discovered using BLE or Wi-Fi Direct (`[ESTABLISHED REQUIREMENT]`, `device-inventory.md`). Packets are framed and transmitted across the radio link.
5. **Relay Ingestion & Verification (Owners: Prathik, Pooja, Medha):**
   `[ESTABLISHED REQUIREMENT]` The relay performs basic structural validation, asks the security layer to validate authenticity, checks message identity and duplicate state, stores eligible packets persistently in Room DB, and queues them for forwarding (`dtn-design.md`).
   *Security Boundary:* **Relay nodes verify the Ed25519 signature to prevent forwarding spam or corrupted packets, but do NOT decrypt the AES-256-GCM payload. Relays lack the decryption key and must not be assumed to have decryption capability.**
6. **Gateway Decryption & Ingestion (Owners: Medha, Manvitha):**
   When the envelope reaches an authorized gateway, whether decryption occurs on the gateway or on the command backend depends on the gateway-to-backend trust boundary architecture (`[OPEN - Manvitha / Medha]`):
   - Under *Option A (Backend Decryption)*, the gateway acts as a transparent relay, forwarding the raw encrypted envelope to the backend.
   - Under *Option B (Gateway Decryption with Attestation)*, an authorized gateway verifies the sender's Ed25519 signature, checks sender authorization, decrypts the AES-256-GCM payload using an authorized key, and submits the incident accompanied by gateway-signed evidence. While mTLS authenticates the gateway connection, a gateway signature binds the submitted incident to the gateway's signing key, and Android hardware-key attestation can provide evidence about key provenance and security properties, none of these alone proves that the gateway correctly verified the originating sender's signature or authorization. Nor does a gateway signature independently prove that the gateway's claims are true.
7. **Gateway REST Ingestion to Dashboard (Owner: Manvitha):**
   `[ESTABLISHED REQUIREMENT]` The gateway transmits the incident to the Web Command Dashboard via a defined REST API contract (`ui-gateway-design.md`).
8. **Dashboard Incident Registration & ACK Correlation (Owner: Manvitha):**
   `[ESTABLISHED REQUIREMENT]` The dashboard validates incoming data, enforces duplicate suppression, displays verified incidents, and maintains correlation (`ui-gateway-design.md`).
   *Trust Boundary Invariant:* **The backend MUST NOT trust a `verified_payload` merely because it appears in a request; transport encryption (TLS) or gateway authentication proves only that an authorized gateway sent the request, not that the origin signature or payload was genuine or properly validated.**
   *State Boundary:* **An incident transitions to `DELIVERED_TO_DASHBOARD` only after the dashboard backend explicitly confirms persistent registration.**

---

## 3. Proposed Message-Envelope Fields

`[PROPOSED SPECIFICATION]` To support hop-by-hop routing and verification by intermediary relays while maintaining end-to-end payload confidentiality, the wire structure is partitioned into an unencrypted **Envelope Header** and an encrypted **Protected Payload**.

### 3.1 Field Specification Table

| Field Name | Layer | Proposed Data Type | Proposed Representation | Description | Status |
|---|---|---|---|---|---|
| `protocol_version` | Header (Plaintext) | Integer (16-bit) | `uint16` | Wire protocol version (Proposed value: `1`). | `[PROPOSED SPECIFICATION]` |
| `message_id` | Header (Plaintext) | Proposed UUID / Binary | 16 bytes binary (or 36-char string) | Unique message identifier generated at origination (`[ESTABLISHED REQUIREMENT]`, `dtn-design.md`). Format is proposed. | `[PROPOSED SPECIFICATION]` |
| `sender_identity` | Header (Plaintext) | Binary / Hex | 32 bytes (Ed25519 public key or fingerprint) | Identifies the originating signing key for public authenticity verification (`[ESTABLISHED REQUIREMENT]`, `security-design.md`). Specific format is proposed. | `[PROPOSED SPECIFICATION]` |
| `creation_time` | Header (Plaintext) | Integer (64-bit) | Epoch milliseconds (UTC) | Originating timestamp for freshness and replay defense. Format proposed. | `[PROPOSED SPECIFICATION]` |
| `ttl_expiry` | Header (Plaintext) | Integer (64-bit) | Epoch milliseconds (UTC) | Absolute expiration time (`[ESTABLISHED REQUIREMENT]`, `dtn-design.md`). Messages past this timestamp are dropped. Format proposed. | `[PROPOSED SPECIFICATION]` |
| `priority` | Header (Plaintext) | Integer (8-bit) | `uint8` (`0`=Routine, `1`=Urgent, `2`=Critical) | Forwarding priority hint (`[ESTABLISHED REQUIREMENT]`, `dtn-design.md`). Tier encoding proposed. | `[PROPOSED SPECIFICATION]` |
| `coarse_category` | Header (Plaintext) | Integer / Enum | `uint8` | Category hint for relay routing. Privacy vs routing trade-off pending review. | `[OPEN - Medha / Manvitha]` |
| `location_flag` | Header (Plaintext) | Integer (8-bit) | `uint8` (`0`=Available, `1`=Unavailable) | Flags whether encrypted payload contains valid GPS coordinates (`[ESTABLISHED REQUIREMENT]`, `ui-gateway-design.md`). Encoding proposed. | `[PROPOSED SPECIFICATION]` |
| `nonce_iv` | Security (Plaintext) | Binary | 12 bytes (96-bit) | Nonce for AES-256-GCM. **Must never repeat with the same key.** Neither random nonces nor persistent counters are automatically safe; generation scheme is unresolved. | `[OPEN - Medha]` |
| `auth_tag` | Security (Plaintext) | Binary | 16 bytes (128-bit) | Authentication tag produced by AES-256-GCM (`[ESTABLISHED REQUIREMENT]`, `security-design.md`). Length proposed. | `[PROPOSED SPECIFICATION]` |
| `signature` | Security (Plaintext) | Binary | 64 bytes | Ed25519 signature over canonical signed envelope fields (`[ESTABLISHED REQUIREMENT]`, `security-design.md`). Length proposed. | `[PROPOSED SPECIFICATION]` |
| `recipient_key_id` | Security (Plaintext) | Binary / Hex | 8 bytes | Identifies the authorized gateway encryption key or key generation. | `[OPEN - Medha]` |
| `encrypted_payload`| Payload (Encrypted) | Binary blob | Ciphertext bytes | AES-256-GCM encrypted confidential incident details (`[ESTABLISHED REQUIREMENT]`, `security-design.md`). | `[ESTABLISHED REQUIREMENT]` |

### 3.2 Confidential Protected Payload Structure (Encrypted)
`[PROPOSED SPECIFICATION]` Decrypted **only** by an authorized node possessing the 256-bit symmetric decryption key. The payload decodes into the following canonical JSON or binary structure:

```json
{
  "emergency_category": "MEDICAL",
  "priority_level": 2,
  "incident_description": "Synthetic test incident description for protocol validation.",
  "location": {
    "status": "AVAILABLE",
    "latitude": 12.970000,
    "longitude": 77.590000,
    "altitude_meters": 920.0,
    "accuracy_meters": 5.0,
    "timestamp": 1793085339000
  },
  "device_telemetry": {
    "battery_level_percent": 75
  }
}
```
*Privacy and Redaction Invariant:* `[ESTABLISHED REQUIREMENT]` Device telemetry and payload must **never** include IMEI numbers, IMSI numbers, baseband serials, phone numbers, or persistent MAC addresses (`device-inventory.md`). Coordinates in documentation examples are strictly synthetic.

### 3.3 Open Decisions on Envelope Serialization
> [!WARNING]
> **Open Serialization Choice `[OPEN - Prathik / Medha / Pooja / Manvitha]`:**
> The team has not agreed on the wire serialization format:
> - **Option A (Binary Protobuf / CBOR):** Compact byte footprint, minimizes radio airtime on BLE, eliminates Base64 parsing overhead.
> - **Option B (Canonical JSON + Base64):** Simpler debugging in early prototypes, native interoperability with React dashboard, but introduces ~33% Base64 expansion and higher transmission overhead.
> **Approval Criterion:** Prathik to benchmark BLE throughput and packet fragmentation overhead across physical inventory devices before team sign-off.

---

## 4. Security Contract

`[ESTABLISHED REQUIREMENT]` Grounded in `security-design.md`.

### 4.1 Cryptographic Algorithms and Key Separation
- **Authenticated Symmetric Encryption:** AES-256-GCM (`[ESTABLISHED REQUIREMENT]`, `security-design.md`). Requires a 256-bit symmetric key. Provides confidentiality and integrity for the incident payload.
- **Digital Signatures:** Ed25519 (`[ESTABLISHED REQUIREMENT]`, `security-design.md`). Asymmetric signature scheme. Originating nodes sign with an Ed25519 private key; relays, gateways, and backend verify with the public key.
- **Key Storage:** Android Keystore for protected key management (`[ESTABLISHED REQUIREMENT]`, `security-design.md`).
- **Cryptographic Independence:** **Ed25519 public keys cannot encrypt payloads, and possession of a public key does not grant decryption capabilities.** AES-256-GCM encryption keys and Ed25519 signing keys are distinct cryptographic primitives with separate lifecycles.
- **Signature Verification vs. Sender Authorization:** Anyone can generate an Ed25519 keypair and produce a mathematically valid digital signature. A valid signature proves integrity and key possession, but does **not** prove the sender is authorized. Sender authorization requires validating the sender's public key against an authorized trust policy (`[OPEN - Medha]`).
- **Relay Non-Decryption Boundary:** Relays do not possess AES-256-GCM keys and **must not decrypt payloads without an explicitly authorized decryption key**.

### 4.2 Nonce Safety Invariant
`[ESTABLISHED REQUIREMENT]` AES-256-GCM requires that a key-nonce pair is **never reused** (`security-design.md:24`).
> [!CAUTION]
> **Cryptographic Nonce Invariant:**
> Under AES-256-GCM, repeating a nonce with the same 256-bit key completely compromises the authentication tag (allowing universal forgery via GHASH key recovery) and leaks the XOR of plaintexts.
> Neither a random nonce nor a persistent counter is automatically safe without rigorous operational justification:
> 1. **Random Nonces:** A 96-bit random nonce does not have zero collision risk. Due to the birthday bound, the collision probability accumulates as the number of messages under a given key grows. A random nonce is not automatically safe; it requires strictly defined and enforced per-key message invocation limits and mandatory key rotation schedules.
> 2. **Persistent Counters:** A persistent sequence counter is not automatically safe against system crashes, abrupt power loss, or concurrency races. If an unclean shutdown occurs before state is committed to non-volatile storage, or if a database journal rolls back, nonces may repeat upon reboot.
> 3. **Crash/Reboot Recovery & Rotation:** The selected nonce architecture must explicitly account for crash/reboot recovery without state rollback, enforce maximum per-key usage limits, and trigger mandatory key rotation before collision thresholds are reached. Neither approach has been implemented, tested, or verified.
> **Status `[OPEN - Medha]`:** The nonce generation and lifecycle persistence scheme remains unresolved (`DEC-04`).
> - *Candidate A:* Hardware-backed random 96-bit nonce generated by Android Keystore with enforced per-key invocation limits and rapid key rotation.
> - *Candidate B:* Room SQLite atomic monotonic sequence counter backed by a crash-safe anti-rollback journal.
> **Approval Criterion:** Medha's formal review and sign-off on a cryptographic nonce architecture that justifies uniqueness under each AES-GCM key, establishes mandatory per-key invocation and rotation limits, and provides crash/reboot state recovery without counter rollback. Neither random nonces nor persistent counters are automatically safe; neither approach has been implemented, tested, or verified.

### 4.3 Deterministic Canonical Signing and AAD Binding
`[ESTABLISHED REQUIREMENT]` Security design requires specifying which packet fields are signed and authenticated (`security-design.md:23`).

#### Canonical Serialization Requirement `[PROPOSED SPECIFICATION]`
To prevent signature verification failures caused by field reordering, character encoding variations, or integer endianness discrepancies, all signing operations must operate on a **deterministic canonical byte stream**:
- All integers encoded in Big-Endian (network byte order).
- All strings encoded in UTF-8 with length prefixes.
- Strict, immutable field ordering.

#### Isolation of Mutable Relay Metadata `[PROPOSED SPECIFICATION]`
Any hop-by-hop mutable metadata (e.g., hop counts, relay node identifiers, reception timestamps, signal strength RSSI, or hop-level signatures) **must be strictly isolated from the originating signature**. If a relay node alters or appends routing metadata, it must not invalidate the originating node's end-to-end Ed25519 signature.

#### Proposed Signed Byte Stream `[PROPOSED SPECIFICATION]`
```
canonical_signed_bytes = protocol_version (2 bytes BE)
                      || message_id_bytes (length-prefixed)
                      || sender_identity_bytes (length-prefixed)
                      || creation_time (8 bytes BE)
                      || ttl_expiry (8 bytes BE)
                      || priority (1 byte)
                      || location_flag (1 byte)
                      || recipient_key_id (length-prefixed)
                      || nonce_iv (12 bytes)
                      || auth_tag (16 bytes)
                      || encrypted_payload_bytes (length-prefixed)
```

#### Additional Authenticated Data (AAD) `[PROPOSED SPECIFICATION]`
To bind unencrypted routing headers cryptographically to the ciphertext, the following fields are supplied as AAD to the AES-256-GCM cipher during payload encryption and decryption:
`AAD = message_id || sender_identity || creation_time || priority`

> [!WARNING]
> **Open Scope `[OPEN - Medha]`:**
> The exact canonical byte layout, length-prefixing scheme, and AAD field set remain proposed until Medha reviews and signs off on the integrity protection strategy (`DEC-03`). Neither canonical serialization nor signature verification has been implemented, tested, or verified.

### 4.4 Key Distribution, Trust Policy, and Revocation
`[ESTABLISHED REQUIREMENT]` How sender public keys are authenticated and how encryption keys reach authorized gateways are unresolved design decisions (`security-design.md:21-22`).
> [!WARNING]
> **Open Trust Model Questions `[OPEN - Medha]`:**
> 1. **Sender Public Key Authentication & Trust Policy:** How does a receiving peer, gateway, or backend verify that `sender_identity` belongs to an authorized node rather than an arbitrary attacker generating valid keypairs?
>    - *Candidate A:* Pre-provisioned device authorization certificates signed by an emergency agency CA.
>    - *Candidate B:* Trust-On-First-Use (TOFU) mesh model with self-attested key identity.
>    - *Candidate C:* Out-of-band QR code provisioning during physical device setup.
> 2. **Payload Encryption Key Distribution:** How do originating nodes obtain the 256-bit AES encryption key (or public key in a hybrid ECIES/X25519 scheme) to encrypt payloads so that only authorized command decryptors can read them?
>    - *Candidate A:* Asymmetric Hybrid Encryption (ECIES / X25519 Diffie-Hellman) using pre-loaded Gateway/Backend Public Keys to derive an ephemeral AES-256-GCM session key.
>    - *Candidate B:* Pre-shared symmetric group emergency key provisioned in Keystore.
> 3. **Key Rotation & Revocation:** How are compromised device keys revoked across an offline mesh without access to online CRLs or OCSP?
> **Approval Criterion:** Medha's delivery and sign-off of the RESQNET Trust & Key Management Plan (`DEC-01`, `DEC-02`, `DEC-05`).

### 4.5 Cryptographic Failure Handling
`[ESTABLISHED REQUIREMENT]` Negative cryptographic tests must be handled deterministically (`security-design.md:29-37`):
- **Invalid Signature:** Immediate packet drop at the boundary (relay, gateway, or backend). Must not be stored or forwarded. Emit security audit event.
- **Decryption / Authentication Tag Failure:** Occurs **only** at authorized decryptors during AES-256-GCM decryption. Ciphertext is dropped; unauthenticated plaintext is never released.
- **Expired TTL:** Envelope dropped; forwarder resources freed.
- **Replayed Packet / Nonce:** Envelope discarded; duplicate counter incremented; forwarding suppressed.
- **Unauthorized / Untrusted Sender:** Dropped or quarantined according to trust policy (`[OPEN - Medha]`), even if the signature is mathematically valid.

---

## 5. DTN Contract (Delay-Tolerant Networking)

`[ESTABLISHED REQUIREMENT]` Grounded in `dtn-design.md`.
Target implementation: Room persistence library, SQLite database, Kotlin coroutines, bounded message queues.

### 5.1 Validation and Processing Sequence
Every incoming envelope received from a mesh peer must be processed in the following strict order (`[ESTABLISHED REQUIREMENT]`, `dtn-design.md:18-25`):
1. **Packet Boundary & Wire Check:** Verify framing integrity, magic bytes, minimum length, and protocol version.
2. **Structural Validation:** Validate field bounds (e.g., `ttl_expiry > creation_time`, required fields present).
3. **Cryptographic Authenticity Check:** Security layer verifies the Ed25519 digital signature over canonical header and ciphertext (`[ESTABLISHED REQUIREMENT]`, `dtn-design.md:20`). If invalid, reject immediately. *(Note: Relays verify the signature but do not decrypt the payload).*
4. **Duplicate Detection:** Check SQLite deduplication cache for `message_id`. If already seen, drop packet.
5. **Persistent Storage:** Atomically insert the eligible envelope into Room SQLite database.
6. **Queue Insertion:** Enqueue envelope into bounded priority queue.
7. **Store-Carry-Forward Trigger:** When a suitable peer or gateway is detected, select envelopes by priority and initiate forwarding.
8. **Delivery State & Expiry:** Record delivery state upon confirmation or expire stale packets.

### 5.2 Room / SQLite Schema Specification `[PROPOSED SPECIFICATION]`
Proposed Room database entities for persistent DTN storage:

```sql
-- Core stored DTN message envelope
CREATE TABLE dtn_envelopes (
    message_id TEXT PRIMARY KEY NOT NULL,
    protocol_version INTEGER NOT NULL,
    sender_identity TEXT NOT NULL,
    creation_time INTEGER NOT NULL,
    ttl_expiry INTEGER NOT NULL,
    priority INTEGER NOT NULL,
    coarse_category INTEGER NOT NULL,
    location_flag INTEGER NOT NULL,
    nonce_iv BLOB NOT NULL,
    auth_tag BLOB NOT NULL,
    signature BLOB NOT NULL,
    encrypted_payload BLOB NOT NULL,
    raw_envelope_bytes BLOB NOT NULL,
    delivery_state TEXT NOT NULL,          -- e.g., 'QUEUED_OFFLINE', 'TRANSMITTING', 'FORWARDED_TO_PEER'
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_time INTEGER NOT NULL DEFAULT 0,
    created_at_local INTEGER NOT NULL
);

-- Deduplication index table surviving application restarts
CREATE TABLE dtn_dedup_cache (
    message_id TEXT PRIMARY KEY NOT NULL,
    first_seen_time INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX idx_dtn_priority_ttl ON dtn_envelopes(priority DESC, ttl_expiry ASC);
CREATE INDEX idx_dtn_state ON dtn_envelopes(delivery_state);
CREATE INDEX idx_dedup_expiry ON dtn_dedup_cache(expires_at);
```

### 5.3 Queue Capacity and Eviction Strategy
`[ESTABLISHED REQUIREMENT]` Storage and queue capacity must be bounded (`dtn-design.md:29`).
- `[PROPOSED SPECIFICATION]`
  - Baseline capacity: 500 messages (or 10 MB maximum SQLite allocation).
  - When storage capacity is reached upon receiving a new valid message:
    1. Expired messages (`ttl_expiry < current_time`) are purged first.
    2. If still full, drop lowest-priority messages (`priority = 0`) with oldest timestamps.
    3. Critical emergencies (`priority = 2`) are **never** dropped to accommodate lower-priority messages.
- `[OPEN - Pooja]`: Pooja to finalize exact capacity bounds and low-memory eviction thresholds for inventory devices (`device-inventory.md`).
  *Approval Criterion:* Pooja's benchmark of Room memory footprints on the inventory devices (SM-A156E, CPH2705, V2355).

### 5.4 Priority and Expiry Handling
- **Priority Classes (`[ESTABLISHED REQUIREMENT]`, `dtn-design.md:30`):**
  - `Priority 2 (CRITICAL)`: Life-safety emergencies, active entrapment. Forwarded first.
  - `Priority 1 (URGENT)`: Medical requests without immediate life failure, hazards.
  - `Priority 0 (ROUTINE)`: Informational status, general inquiries.
- **Expiry Rules (`[ESTABLISHED REQUIREMENT]`, `dtn-design.md:31`):**
  - Background periodic coroutine worker inspects `ttl_expiry`.
  - Messages with `ttl_expiry <= current_time` transition to `EXPIRED` and are purged from the active queue.
  - Deduplication cache records are retained until `expires_at` (`ttl_expiry` + safety buffer) to prevent re-accepting old retransmissions.

### 5.5 Retry Handling and Reconnection Forwarding
`[ESTABLISHED REQUIREMENT]` Queued messages must survive application restarts and forward upon reconnection (`dtn-design.md:34, 43`).
- `[PROPOSED SPECIFICATION]`
  - If a transmission is interrupted mid-transfer, the envelope state reverts from `TRANSMITTING` to `QUEUED_OFFLINE`, and `retry_count` is incremented.
  - Retry backoff: Truncated exponential backoff with jitter (`backoff_delay = min(max_delay, base_delay * 2^retry_count) + random_jitter`).
- `[OPEN - Pooja]`: Exact retry backoff parameters (`base_delay`, `max_delay`, maximum retry ceiling before marking a message as failed).
  *Approval Criterion:* Pooja's simulation of mesh congestion under varying retry backoff curves.

---

## 6. Mesh Transport Contract

`[ESTABLISHED REQUIREMENT]` Grounded in `device-inventory.md` and `README.md`.
Target radio interfaces: Bluetooth Low Energy (BLE) and Wi-Fi Direct.
*Responsible Owner:* Prathik.

### 6.1 Peer Discovery and Privacy-Preserving Identity
- `[ESTABLISHED REQUIREMENT]` Devices communicate peer-to-peer without cellular infrastructure.
- `[PROPOSED SPECIFICATION]`
  - **BLE Discovery:** Standard BLE Advertising using a dedicated RESQNET Service UUID.
  - **Wi-Fi Direct Discovery:** Wi-Fi P2P Service Discovery for high-bandwidth peer detection.
- `[OPEN - Prathik]`: Peer identity on the wire. Must avoid exposing static MAC addresses, hardware serials, or persistent identifiers to prevent physical tracking of survivors.
  *Approval Criterion:* Prathik's privacy-preserving peer identification proposal (e.g., rotating ephemeral tokens or public key hashes).

### 6.2 Packet Framing Protocol `[PROPOSED SPECIFICATION]`
To bridge the gap between BLE MTU limits and Wi-Fi Direct streaming sockets, the transport layer employs a standardized framing header:

```
+--------------------------------------------------------------------------------+
| MAGIC (2B) | TOTAL_LENGTH (4B) | CHUNK_INDEX (2B) | TOTAL_CHUNKS (2B) | CHUNK_DATA |
|   0x5251   |    (Bytes BE)     |    (0-based)     |   (Chunk count)   |  (Payload) |
+--------------------------------------------------------------------------------+
```
- **Magic Bytes:** `0x52 0x51` (`"RQ"`).
- **Total Length:** Full envelope length in bytes.
- **Chunk Index & Total Chunks:** Supports hop-level fragmentation and reassembly over constrained BLE MTUs.

### 6.3 Maximum Packet Size
> [!WARNING]
> **Open Transport Constraint `[OPEN - Prathik]`:**
> The team has **not agreed** on a Maximum Transmission Unit (MTU) or maximum envelope size.
> - BLE GATT effective MTU ranges from 23 to 512 bytes depending on hardware and Android negotiation.
> - Wi-Fi Direct supports standard 1500-byte MTUs or TCP streaming sockets.
> **Approval Criterion:* Prathik to benchmark physical BLE MTU throughput and Wi-Fi Direct socket transfers on inventory devices (`device-inventory.md`) and propose an empirical maximum packet size.

### 6.4 Send/Receive Outcomes and Responsibility Boundary
- **Outcomes:** `SEND_SUCCESS`, `SEND_TIMEOUT`, `CONNECTION_LOST`, `PEER_REJECTED`.
- **Boundary Separation:**
  - **Transport Layer Responsibility:** Immediate hop-level chunk retransmission within an active radio connection (up to 3 chunk retries).
  - **DTN Layer Responsibility:** Persistent store-carry-forward, managing retransmissions across prolonged disconnection intervals lasting minutes or hours.

---

## 7. Gateway REST API Draft

`[ESTABLISHED REQUIREMENT]` Grounded in `ui-gateway-design.md`.
*Responsible Owners:* Manvitha & Medha.

### 7.1 Gateway-to-Backend Trust Boundary and Architectural Options `[OPEN - Manvitha / Medha]`

> [!CRITICAL]
> **Trust Boundary Invariant:**
> **The backend MUST NOT trust `verified_payload` merely because it appears in a request.**
> Transport Layer Security (TLS) or gateway authentication credentials (such as API tokens or mTLS) **only prove that an authorized gateway device transmitted the HTTP request over the network**. Gateway authentication alone does **NOT** prove that the originating sender's Ed25519 signature was valid, that the sender was authorized, or that the payload was genuinely generated by the claimed emergency victim.
> Neither of the following architectures is chosen prematurely; both are submitted for team review:

#### Architectural Options:
1. **Option A: Backend Decryption and Independent Verification (End-to-End Mesh to Backend)**
   - *Architecture:* The gateway acts strictly as a store-and-forward mesh bridge. It forwards the unverified or signature-verified encrypted envelope, envelope headers, and radio metadata to the backend.
   - *Backend Responsibility:* The backend holds the authorized 256-bit AES decryption keys and the sender trust roster. The backend independently verifies the Ed25519 signature, validates sender authorization, verifies AAD, and decrypts the AES-256-GCM ciphertext.
   - *Payload in Request:* The request body contains only `envelope` and `gateway_metadata`, and **no** `verified_payload`.
   - *Security Trade-off:* Strongest end-to-end confidentiality; gateway compromise does not expose victim payload or allow forging emergency incidents. Requires the backend to manage individual device keys or group decryption keys.

2. **Option B: Gateway Decryption and Verification with Authenticated Attestation**
   - *Architecture:* An authorized gateway node (equipped with Keystore-protected decryption keys) decrypts the AES-256-GCM payload and verifies the sender's Ed25519 signature and authorization locally. It then constructs a verified incident report and transmits it to the backend over an authenticated, integrity-protected channel.
   - *Distinction of Gateway Security Controls:*
     - **Mutual TLS (mTLS):** Authenticates the gateway connection (preventing network eavesdropping, tampering, and machine-in-the-middle impersonation).
     - **Gateway Digital Signature:** Binds the submitted incident to the gateway's signing key (ensuring non-repudiation and integrity between gateway and backend).
     - **Android Hardware-Key Attestation:** Can provide evidence about key provenance and security properties (such as hardware backing in TEE / StrongBox, non-exportability, and rollback resistance).
     - **Attestation Trust Boundary Limitation:** **None of these alone proves that the gateway correctly verified the originating sender's signature or authorization.** A gateway signature binds the submitted incident to the gateway's signing key, but does **not** independently prove that the gateway's claims are true. A compromised, rogue, or malfunctioning gateway process operating with valid, hardware-attested keys could sign false assertions, misreport verification outcomes, or bypass authorization checks.
   - *Proposed Gateway-Signed Evidence Schema `[PROPOSED SPECIFICATION]`:*
     To allow the backend to evaluate the gateway's claims under Option B, the proposed gateway-signed evidence must cover, at minimum:
     1. **The canonical incident payload or its cryptographic hash.**
     2. **The originating encrypted envelope or its cryptographic hash.**
     3. **The verification outcome and sender-authorization outcome.**
     4. **A unique incident/message identifier and protocol version.**
     5. **A timestamp or sequence/freshness value where appropriate.**
   - *Backend Verification Duties under Option B:*
     The backend must:
     1. Authenticate the gateway connection (via mTLS or authorized gateway credentials).
     2. Verify the gateway signature against an authorized gateway key from the backend's authorized gateway key roster.
     3. Validate the evidence (confirming that payload and envelope hashes match the accompanying data, and checking reported verification and sender-authorization outcomes).
     4. Apply replay and idempotency checks using the unique incident/message identifier and timestamp/sequence values.
     5. Enforce request schema validation, persist the incident, and emit a security audit log recording the gateway's attestation.
   - *Open Decision & Trust Policy:* The exact attestation format and trust policy remain `[OPEN - Medha / Manvitha]` for joint approval. The specification must not imply that a gateway signature independently proves the gateway's claims are true.
   - *Security Trade-off:* Enables local gateway incident triage in the field and reduces backend cryptographic load, but introduces gateway trust dependency.

> [!WARNING]
> **Open API & Architecture Decision `[OPEN - Manvitha / Medha]`:**
> The selected architecture (Option A vs. Option B), the final request schema, URI paths, HTTP status codes, and authentication mechanisms remain proposed until Manvitha and Medha formally agree on the trust boundary (`DEC-12`).

### 7.2 Proposed Ingestion Endpoint: `POST /api/v1/incidents/ingest` `[PROPOSED SPECIFICATION]`
Transfers an emergency envelope from a gateway node to the command backend.

#### Proposed Request Headers:
- `Content-Type: application/json`
- `X-Gateway-ID: gw-android-001`
- `Authorization: Bearer <PROPOSED_MOCK_BEARER_TOKEN_MANVITHA_REVIEW_PENDING>`

#### Proposed Request Body:
```json
{
  "protocol_version": 1,
  "message_id": "9f8b4d2a-8c3e-4b6a-a1e2-f3d4e5a6b7c8",
  "gateway_metadata": {
    "gateway_id": "gw-android-001",
    "ingest_timestamp": 1793085345000,
    "hop_count": 2,
    "rssi_dbm": -68
  },
  "envelope": {
    "sender_identity": "a3f5c789b12d4e6f8a0b2c4d6e8f0a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f",
    "creation_time": 1793085339000,
    "ttl_expiry": 1793171739000,
    "priority": 2,
    "location_flag": 0,
    "recipient_key_id": "key-gw-2026",
    "nonce_iv": "1a2b3c4d5e6f7a8b9c0d1e2f",
    "auth_tag": "3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c",
    "signature": "e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2",
    "encrypted_payload": "q83k4j...[base64_ciphertext]..."
  },
  "/* NOTE: verified_payload and gateway_attestation are included ONLY under Option B. Under Option A, backend decrypts envelope directly */": true,
  "verified_payload": {
    "emergency_category": "MEDICAL",
    "incident_description": "Synthetic test emergency incident.",
    "location": {
      "status": "AVAILABLE",
      "latitude": 12.970000,
      "longitude": 77.590000,
      "accuracy_meters": 5.0,
      "timestamp": 1793085339000
    }
  },
  "gateway_attestation": {
    "protocol_version": 1,
    "message_id": "9f8b4d2a-8c3e-4b6a-a1e2-f3d4e5a6b7c8",
    "gateway_id": "gw-android-001",
    "attestation_timestamp": 1793085345100,
    "sequence_number": 1042,
    "origin_envelope_sha256": "4a5b6c...[sha256_of_envelope]...",
    "canonical_payload_sha256": "8f9a0b...[sha256_of_payload]...",
    "origin_signature_verified": true,
    "sender_authorized": true,
    "gateway_signature": "d4e5f6...[signature_over_evidence]..."
  }
}
```

#### Proposed Success Response:
- **HTTP Status:** `201 Created` (First receipt) or `200 OK` (Duplicate idempotent receipt) `[OPEN - Manvitha]`
```json
{
  "status": "SUCCESS",
  "acknowledgement_id": "ack-c108f92e-5d1b-4f9e-8c3a-2e7d4f9b0c1a",
  "message_id": "9f8b4d2a-8c3e-4b6a-a1e2-f3d4e5a6b7c8",
  "server_time": 1793085346120,
  "incident_tracking_number": "INC-2026-0042",
  "action": "DISPATCHED_TO_DASHBOARD"
}
```

#### Proposed Duplicate Response (Idempotency):
- **HTTP Status:** `200 OK` (or `409 Conflict` `[OPEN - Manvitha]`)
```json
{
  "status": "DUPLICATE",
  "acknowledgement_id": "ack-c108f92e-5d1b-4f9e-8c3a-2e7d4f9b0c1a",
  "message_id": "9f8b4d2a-8c3e-4b6a-a1e2-f3d4e5a6b7c8",
  "incident_tracking_number": "INC-2026-0042",
  "action": "ALREADY_REGISTERED"
}
```

#### Proposed Error Responses:
- **HTTP Status:** `400 Bad Request` (Malformed JSON or missing fields).
- **HTTP Status:** `422 Unprocessable Entity` (Cryptographic verification failure or expired TTL).
- **HTTP Status:** `401 Unauthorized / 403 Forbidden` (Invalid gateway credentials).

### 7.3 Acknowledgement Correlation and End-to-End Routing
`[ESTABLISHED REQUIREMENT]` Grounded in `ui-gateway-design.md`.
- Ingestion assigns an `acknowledgement_id` mapped 1-to-1 with `message_id`.
- `[OPEN - Manvitha / Pooja / Prathik]`: How the ACK propagates back across the offline mesh to the originating Android device:
  - *Candidate A:* Reverse-path hop routing (requires transient path state on intermediate nodes).
  - *Candidate B:* Epidemic gossip broadcast of compact ACK tokens (`ack_id || message_id`).
  - *Candidate C:* Direct-range confirmation only (no reverse mesh propagation; sender confirms only if in gateway range).
  *Approval Criterion:* Joint review by Manvitha, Pooja, and Prathik on mesh bandwidth overhead vs user feedback value (`DEC-13`).

---

## 8. Shared Delivery and Security States for Android and Dashboard

`[ESTABLISHED REQUIREMENT]` Grounded in `ui-gateway-design.md`, `dtn-design.md`, and `security-design.md`.

### 8.1 Delivery State Machine
The states differentiate between local queueing, relay forwarding, gateway receipt, and backend dashboard registration:

| Canonical State | Android User Interface Meaning (`ui-gateway-design.md`) | DTN Engine State (`dtn-design.md`) | Dashboard Incident Meaning |
|---|---|---|---|
| `READY` | Ready to compose an emergency SOS. | No active message. | Not applicable. |
| `PREPARING_SOS` | Capturing GPS, encrypting, and signing. | In-memory preparation. | Not applicable. |
| `QUEUED_OFFLINE` | Envelope saved in Room SQLite; waiting for peer/gateway contact. | Stored in DB; awaiting route. | Not visible on dashboard. |
| `TRANSMITTING` | Actively pushing bytes over radio link. | Socket transfer active. | Not visible on dashboard. |
| `FORWARDED_TO_PEER`| Envelope transferred to an intermediary relay node. | Stored; held for relay ACK. | Not visible on dashboard. |
| `RECEIVED_BY_GATEWAY`| Envelope reached a gateway node; awaiting HTTP upload. | Gateway holding for dispatch. | Ingestion queue pending. |
| `DELIVERED_TO_DASHBOARD`| Backend REST API confirmed registration with `acknowledgement_id`. | Delivery confirmed; archivable. | Verified incident displayed to dispatchers. |
| `EXPIRED` | Message TTL exceeded before gateway delivery. | Purged from active queue. | Dropped / rejected if arriving late. |
| `REJECTED_OR_FAILED` | Transmission failed or validation rejected envelope. | Dropped; error recorded. | Security audit log recorded. |

### 8.2 Orthogonal Location Status (`[ESTABLISHED REQUIREMENT]`, `ui-gateway-design.md:37`)
- `LOCATION_AVAILABLE`: Valid coordinates present.
- `LOCATION_UNAVAILABLE`: Coordinates missing due to permission denial or hardware timeout; explicitly displayed on UI without crashing.

### 8.3 Security Verification State Machine
Separates signature verification (relays, gateways, backend) from sender authorization and payload decryption:

| Canonical Security State | Description | Verification Agent | System Action |
|---|---|---|---|
| `UNVERIFIED` | Raw packet received; verification pending. | Any Node | Held in memory buffer. |
| `SIGNATURE_VERIFIED` | Ed25519 signature valid under `sender_identity` public key. Proves integrity and key possession; does NOT prove sender authorization. | Relay, Gateway, Backend | Eligible for DTN storage and forwarding. |
| `SIGNATURE_INVALID` | Signature check failed or header tampered with. | Relay, Gateway, Backend | Dropped immediately; security event logged. |
| `SENDER_AUTHORIZED` | `sender_identity` verified against authorized trust policy/roster. | Gateway / Backend | Incident accepted as trusted origin. |
| `UNAUTHORIZED_SENDER`| Valid signature, but sender public key is unknown, unauthorized, or revoked. | Gateway / Backend | Dropped or quarantined according to trust policy (`[OPEN - Medha]`). |
| `DECRYPTED_SUCCESS` | Authorized node cleanly decrypted AES-256-GCM ciphertext and verified AAD. | Gateway (Option B) / Backend (Option A) | Incident parsed for dashboard display. |
| `DECRYPTION_FAILED` | AES-256-GCM auth tag mismatch or corrupt ciphertext. | Gateway (Option B) / Backend (Option A) | Dropped; dashboard dispatch blocked. |
| `REPLAY_DETECTED` | Duplicate message ID or repeated nonce identified. | Any Node | Discarded; duplicate counter incremented. |

---

## 9. Structured Logging Requirements

`[ESTABLISHED REQUIREMENT]` Grounded in `security-design.md`, `dtn-design.md`, `ui-gateway-design.md`, and `device-inventory.md`.

### 9.1 Privacy and Security Redaction Invariants (NON-NEGOTIABLE)
Under no circumstances may any RESQNET component write the following to local disk logs, logcat, terminal output, telemetry, or network crash reports:
1. **Private Keys:** Never log Android Keystore private key handles, raw Ed25519 secret seed bytes, or private keys.
2. **Symmetric Encryption Keys:** Never log AES-256 session keys or pre-shared keys.
3. **Authentication Tokens:** Never log gateway Bearer tokens, API credentials, or backend passwords.
4. **Hardware Serial Identifiers & IMEI Numbers:** Never inspect or log device IMEI numbers, IMSI numbers, baseband serials, or ICCIDs (`[ESTABLISHED REQUIREMENT]`, `device-inventory.md`).
5. **Personal Location Data:** Never log raw high-precision GPS coordinates in routine debug, DTN, or transport logs. Exact coordinates are restricted strictly to the encrypted payload and authorized dashboard views.

### 9.2 Proposed Log Schema (JSON) `[PROPOSED SPECIFICATION]`
```json
{
  "timestamp": "2026-10-27T07:05:46.120Z",
  "level": "INFO",
  "subsystem": "DTN",
  "event_type": "ENVELOPE_STORED",
  "node_id": "node-cph2705-02",
  "message_id": "9f8b4d2a-8c3e-4b6a-a1e2-f3d4e5a6b7c8",
  "details": {
    "priority": 2,
    "ttl_expiry": 1793171739000,
    "queue_depth": 3,
    "size_bytes": 482
  }
}
```

### 9.3 Standard Event Taxonomy `[PROPOSED SPECIFICATION]`
- **Security Events:** `KEYSTORE_INITIALIZED`, `KEY_GENERATED`, `SIGNATURE_GENERATION_SUCCESS`, `SIGNATURE_VERIFIED`, `SIGNATURE_FAILED`, `DECRYPTION_FAILED`, `REPLAY_REJECTED`, `UNTRUSTED_SENDER_REJECTED`.
- **DTN Events:** `ENVELOPE_STORED`, `QUEUE_CAPACITY_WARNING`, `MESSAGE_EVICTED`, `MESSAGE_EXPIRED`, `DEDUPLICATION_HIT`, `DATABASE_TRANSACTION_ROLLBACK`.
- **Transport Events:** `PEER_DISCOVERED`, `PEER_CONNECTED`, `CHUNK_SENT`, `CHUNK_RECEIVED`, `LINK_DISCONNECTED`, `TRANSPORT_ERROR`.
- **Gateway Events:** `GATEWAY_RECEIVED_ENVELOPE`, `REST_DISPATCH_SUCCESS`, `REST_DISPATCH_RETRY`, `GATEWAY_AUTH_FAILURE`.

---

## 10. Cross-Module Test Cases and Measurable Acceptance Criteria

`[ESTABLISHED REQUIREMENT]` Synthesizes testing requirements from `security-design.md`, `dtn-design.md`, `ui-gateway-design.md`, and `device-inventory.md`.
*Current Status: Planned test specifications only. Implementation and automated test runs have not yet been executed.*

| Test ID | Module(s) | Description / Scenario | Execution Steps | Measurable Acceptance Criteria |
|---|---|---|---|---|
| **SEC-01** | Security | Modified Ciphertext Detection (`security-design.md:30`) | Flip 1 bit inside `encrypted_payload`; submit to GCM decryptor. | Decryption aborts with `AEADBadTagException`; plaintext is never produced; security audit log emitted. |
| **SEC-02** | Security | Invalid Authentication Tag (`security-design.md:31`) | Substitute `auth_tag` with 16 random bytes; attempt decryption. | Decryption rejected immediately; zero allocation of unverified buffer. |
| **SEC-03** | Security | Invalid Digital Signature (`security-design.md:32`) | Corrupt 1 byte of `signature`; submit envelope to relay or gateway. | Signature verification returns `false`; envelope is discarded before database insertion. |
| **SEC-04** | Security | Modified Signed Header (`security-design.md:33`) | Alter `priority` or `creation_time` in envelope header without updating signature. | Signature verification fails; packet dropped; tamper attempt logged. |
| **SEC-05** | Security / DTN | Duplicate Packet Submission (`security-design.md:34`) | Inject identical `message_id` envelope twice within TTL window. | First packet is stored; second packet matches `dtn_dedup_cache`, is dropped immediately, and duplicate counter increments. |
| **SEC-06** | Security / DTN | Expired Message Rejection (`security-design.md:35`) | Construct envelope with `ttl_expiry` in the past. | Validation rejects packet immediately with status `EXPIRED`; packet is not forwarded. |
| **SEC-07** | Security | Unknown / Unauthorized Sender (`security-design.md:36`) | Submit envelope signed by an unauthorized key. | Envelope rejected at boundary; processed according to trust policy. |
| **DTN-01** | DTN | Room DB Store & Retrieve (`dtn-design.md:38`) | Insert valid envelope into Room SQLite database and retrieve by `message_id`. | Stored byte array and metadata match original envelope exactly with zero corruption. |
| **DTN-02** | DTN | Application Restart Recovery (`dtn-design.md:39`) | Queue envelopes in Room DB, kill Android process, relaunch application. | DTN Engine recovers all unexpired envelopes from SQLite; queue order and retry counters are restored. |
| **DTN-03** | DTN | Queue Capacity Enforcement (`dtn-design.md:42`) | Submit envelopes exceeding configured queue capacity limit. | Total stored envelopes strictly remain within capacity bound; lowest-priority, oldest messages evicted first; zero OOM/crash. |
| **DTN-04** | DTN | Stale Message Expiration (`dtn-design.md:41`) | Allow queued messages to exceed `ttl_expiry`. Run cleaner worker. | Stale messages transition to `EXPIRED` and are removed from active forwarding queue. |
| **DTN-05** | DTN | Reconnection Forwarding (`dtn-design.md:43`) | Queue messages during radio disconnection; bring a mock peer into range. | DTN engine detects peer connection and initiates forwarding in priority order. |
| **DTN-06** | DTN | Database Transaction Safety (`dtn-design.md:44`) | Simulate SQLite disk write error / lock contention during batch insertion. | Transaction rolls back cleanly; database remains uncorrupted; error handled without app termination. |
| **TRN-01** | Transport | MTU Packet Fragmentation | Transmit envelope exceeding negotiated BLE MTU over radio link. | Envelope frames into chunks; receiving peer reassembles byte buffer matching original SHA-256 hash. |
| **TRN-02** | Transport | Mid-Transfer Disconnection | Disconnect peer radio socket while chunks are actively transmitting. | Receiving node discards partial buffer after timeout; sending node resets state to `QUEUED_OFFLINE`. |
| **TRN-03** | Transport / DTN| Retry Boundary Separation | Fail immediate packet delivery across maximum transport chunk retries. | Transport layer escalates to DTN layer; DTN engine retains message in Room and schedules backoff timer. |
| **GW-01** | Gateway / UI| End-to-End REST Ingestion (`ui-gateway-design.md:24`) | Gateway submits envelope (and parsed incident if Option B) to ingestion API. | Backend returns proposed HTTP 201 with valid `acknowledgement_id`; incident appears on dashboard. |
| **GW-02** | Gateway / UI| Duplicate Ingestion Idempotency (`ui-gateway-design.md:27`) | Submit identical envelope to gateway REST API multiple times. | Backend returns proposed duplicate response; incident is rendered **exactly once** on dashboard. |
| **GW-03** | Gateway | Gateway Offline Fallback (`ui-gateway-design.md:43`) | Disconnect gateway internet connection while mesh messages arrive. | Gateway queues verified envelopes in DTN storage; dispatches to backend automatically upon reconnection. |
| **GW-04** | Gateway | Invalid API Response Handling (`ui-gateway-design.md:44`) | Mock backend returning HTTP 500 / 502 / invalid JSON. | Gateway catches error safely, retains envelope in Room DB, and schedules exponential retry without crashing. |
| **UI-01** | Android UI | SOS Form Validation (`ui-gateway-design.md:40`) | Attempt submitting SOS with empty message and no category selected. | UI blocks submission, displays readable error message, keeps user on composition screen. |
| **UI-02** | Android UI | Location Permission Denial (`ui-gateway-design.md:41`) | Deny location permission; submit emergency SOS. | App creates envelope with `location_flag = 1`, logs warning, and queues message successfully without crashing. |
| **UI-03** | Android UI | Offline State Progression (`ui-gateway-design.md:42`) | Submit SOS offline; bring peer into range. | UI transitions visibly: `PREPARING_SOS` -> `QUEUED_OFFLINE` -> `TRANSMITTING` -> `FORWARDED_TO_PEER`. |

---

## 11. Decision Register

The following unresolved technical decisions must be reviewed and decided by the respective module owners before protocol finalization and code implementation.

| Decision ID | Subsystem / Topic | Single Clear Question | Proposed Alternatives | Responsible Owner | Specific Approval Criterion | Status |
|---|---|---|---|---|---|---|
| **DEC-01** | Security / Trust | How are originating node public keys authenticated across an offline mesh without access to an online CA? (`security-design.md:21`) | **A:** Pre-shared agency CA-signed device certificates.<br>**B:** Trust-On-First-Use (TOFU) with self-attestation.<br>**C:** Physical QR code field enrollment. | **Medha** | Medha's delivery of an offline sender authentication threat model and policy sign-off (distinguishing signature validity from authorization). | `OPEN` |
| **DEC-02** | Security / Crypto | How do originating nodes obtain the symmetric 256-bit AES key to encrypt confidential payloads for authorized gateways/backends? (`security-design.md:22`) | **A:** Asymmetric hybrid encryption (ECIES / X25519) using pre-loaded Gateway/Backend Public Keys.<br>**B:** Pre-shared group symmetric key in Keystore. | **Medha** | Medha's specification of the payload key establishment protocol and cryptographic proof. | `OPEN` |
| **DEC-03** | Security / Framing | What is the exact deterministic canonical byte layout and field sequence covered by the Ed25519 signature? (`security-design.md:23`) | **A:** Canonical big-endian header and ciphertext stream excluding mutable relay headers.<br>**B:** Truncated header hash stream. | **Medha** | Medha's sign-off on the canonical byte sequence definition. Neither canonical serialization nor signature verification has been implemented, tested, or verified. | `OPEN` |
| **DEC-04** | Security / Nonce | How is 96-bit AES-GCM nonce uniqueness guaranteed under each key across app reboots, crashes, and key lifecycles? (`security-design.md:24-25`) | **A:** Android Keystore internal hardware random generation with enforced per-key invocation limits and rapid key rotation.<br>**B:** Room SQLite atomic monotonic sequence counter with crash-safe anti-rollback journal. | **Medha** | Medha's formal review and sign-off on a cryptographic nonce architecture that justifies uniqueness under each AES-GCM key, establishes mandatory per-key invocation and rotation limits, and provides crash/reboot state recovery without counter rollback. Neither random nonces nor persistent counters are automatically safe; neither approach has been implemented, tested, or verified. | `OPEN` |
| **DEC-05** | Security / Policy | How are compromised keys revoked across an offline mesh without internet access? (`security-design.md:26`) | **A:** Signed revocation gossip packets propagated via DTN.<br>**B:** Short-lived epoch keys expiring automatically. | **Medha** | Medha's specification of the offline revocation protocol. | `OPEN` |
| **DEC-06** | Transport / Radio | What wire serialization format should be adopted for message envelopes? | **A:** Compact binary Protobuf or CBOR.<br>**B:** Canonical JSON with Base64 fields. | **Prathik** | Prathik's empirical BLE throughput and airtime benchmark across inventory devices. | `OPEN` |
| **DEC-07** | Transport / Framing | What is the maximum allowable packet size and BLE MTU fragmentation limit? | **A:** 512 bytes (optimized for BLE GATT MTU).<br>**B:** 1500 bytes (optimized for Wi-Fi Direct). | **Prathik** | Physical device BLE MTU negotiation benchmarks on devices D1, D2, and D3 (`device-inventory.md`). | `OPEN` |
| **DEC-08** | Transport / Privacy | How should peer identities be represented on the wire over BLE/Wi-Fi Direct to prevent physical tracking? | **A:** Ephemeral session tokens rotated hourly.<br>**B:** Truncated public key hashes. | **Prathik** | Prathik's review against Android Wi-Fi Direct/BLE MAC randomization behavior. | `OPEN` |
| **DEC-09** | DTN / Capacity | What are the maximum queue capacity bounds and low-memory eviction policies for Android devices? | **A:** Fixed 500 messages with priority-tiered drop.<br>**B:** Dynamic capacity based on available flash storage. | **Pooja** | Pooja's SQLite memory benchmark on entry-level Android devices in `device-inventory.md`. | `OPEN` |
| **DEC-10** | DTN / Retry | What retry backoff curve and neighbor forwarding parameters should be adopted? | **A:** Truncated exponential backoff with jitter.<br>**B:** Density-adaptive linear retry interval. | **Pooja** | Pooja's mesh simulation report demonstrating storm-suppression under congestion. | `OPEN` |
| **DEC-11** | Gateway / API | What are the final REST API endpoint paths and HTTP status code semantics for duplicate ingestion? | **A:** `POST /api/v1/incidents/ingest` returning `201 Created` / `200 OK` (Duplicate).<br>**B:** `POST /api/v1/sos/envelope` returning `201 Created` / `409 Conflict`. | **Manvitha** | Manvitha's OpenAPI 3.0 specification approval for gateway and dashboard integration. | `OPEN` |
| **DEC-12** | Gateway / Backend | Which trust boundary architecture (Option A vs. Option B) and gateway attestation evidence model governs incident ingestion to the backend? | **A:** Option A (Backend Decryption): Backend independently verifies origin Ed25519 signature, authorizes sender, and decrypts AES-GCM payload.<br>**B:** Option B (Gateway Decryption with Attestation): Gateway decrypts and verifies envelope, then submits incident with gateway-signed evidence covering at minimum canonical payload (or hash), originating envelope (or hash), verification and sender-authorization outcomes, unique incident/message ID and protocol version, and timestamp or sequence/freshness value. Backend verifies gateway signature against an authorized gateway key, validates evidence, and applies replay/idempotency checks. (Clarified that mTLS authenticates gateway connection, gateway signature binds to gateway signing key, and Android hardware-key attestation provides evidence about key provenance and security properties, but none of these alone proves gateway correctly verified sender signature or authorization, nor does gateway signature independently prove claims are true). | **Medha / Manvitha** | Joint review and approval by Medha and Manvitha of the backend trust boundary, exact gateway attestation format, evidence fields, and trust policy. Neither architecture is implemented or verified. | `OPEN` |
| **DEC-13** | UI / Protocol | How should gateway receipt acknowledgements propagate back to the originating Android device? | **A:** Reverse-path hop routing.<br>**B:** Epidemic gossip broadcast of compact ACK tokens.<br>**C:** Direct-range confirmation only. | **Manvitha / Pooja / Prathik** | Joint approval by Manvitha, Pooja, and Prathik on return-path feasibility. | `OPEN` |
| **DEC-14** | UI / Envelope | Should emergency category be visible in the plaintext header or encrypted inside the payload? | **A:** Coarse category in plaintext header for DTN routing.<br>**B:** Category strictly inside encrypted payload for maximum privacy. | **Medha / Manvitha** | Joint approval by Medha and Manvitha balancing routing priority against metadata privacy. | `OPEN` |

---

## 12. Verification & Next Steps

1. **Team Review Meeting:** Team members (Prathik, Medha, Pooja, Manvitha) will review the Decision Register and assign resolutions to `OPEN` items.
2. **Subsystem Prototyping:**
   - Prathik: Physical device BLE MTU and throughput benchmarks using test devices (`device-inventory.md`).
   - Medha: Android Keystore AES-256-GCM and Ed25519 benchmarking script.
   - Pooja: Room database schema migration and SQLite concurrency unit tests.
   - Manvitha: Android Compose SOS submission screen and mock Gateway REST controller.
3. **Draft Promotion:** Once all items in the Decision Register are transitioned from `OPEN` to `APPROVED`, this document will be tagged as `v1.0-final` on the `main` branch.
