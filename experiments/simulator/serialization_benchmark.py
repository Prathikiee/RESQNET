#!/usr/bin/env python3
"""
RESQNET Wire Serialization Benchmark Prototype (DEC-06 Candidate Evaluation)

Protocol Reference: docs/wire-protocol-v1.md (Section 3.1, 3.2, 3.3, 6.2)
Decision Reference: DEC-06 (OPEN — Assigned to Prathik)

Scope & Objective:
    Compares wire serialization alternatives for the 13-field RESQNET message envelope:
    1. Canonical JSON with Base64-encoded binary fields
    2. CBOR (RFC 8949) using compact integer map keys
    3. CBOR (RFC 8949) using descriptive string map keys
    4. Protocol Buffers (proto3)

DISCLAIMER:
    - Cryptographic signatures and nonces in this benchmark are synthetic test vectors.
    - BLE packet fragmentation results are simulated using the transport framing model
      from Section 6.2 (10-byte framing header + 3-byte ATT header). They are NOT
      physical over-the-air radio measurements.
    - DEC-06 remains OPEN pending empirical physical-device radio validation.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import statistics
import sys
import time
from typing import Any, Callable

# ==============================================================================
# Protocol Schema Constants (docs/wire-protocol-v1.md Section 3.1)
# ==============================================================================

# All 13 envelope fields defined in Table 3.1
ENVELOPE_FIELDS = (
    "protocol_version",
    "message_id",
    "sender_identity",
    "creation_time",
    "ttl_expiry",
    "priority",
    "coarse_category",
    "location_flag",
    "nonce_iv",
    "auth_tag",
    "signature",
    "recipient_key_id",
    "encrypted_payload",
)

# Binary fields that require Base64 encoding in JSON, but are native bytes in CBOR/Protobuf
BINARY_FIELDS = {
    "message_id",
    "sender_identity",
    "nonce_iv",
    "auth_tag",
    "signature",
    "recipient_key_id",
    "encrypted_payload",
}

# CBOR integer key mapping (1..13 matching envelope.proto tag numbering)
CBOR_INT_KEY_MAP = {
    1: "protocol_version",
    2: "message_id",
    3: "sender_identity",
    4: "creation_time",
    5: "ttl_expiry",
    6: "priority",
    7: "coarse_category",
    8: "location_flag",
    9: "nonce_iv",
    10: "auth_tag",
    11: "signature",
    12: "recipient_key_id",
    13: "encrypted_payload",
}
CBOR_NAME_TO_INT = {name: key for key, name in CBOR_INT_KEY_MAP.items()}

# ==============================================================================
# Dependency Imports with Graceful Fallbacks
# ==============================================================================

CBOR_AVAILABLE = False
try:
    import cbor2
    CBOR_AVAILABLE = True
except ImportError:
    cbor2 = None  # type: ignore

PROTOBUF_AVAILABLE = False
envelope_pb2 = None
try:
    # Look in the script's directory for envelope_pb2
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    import envelope_pb2  # type: ignore
    PROTOBUF_AVAILABLE = True
except ImportError:
    pass

# ==============================================================================
# Representative Test Vector Generation & Validation
# ==============================================================================

def generate_representative_vector(seed: int = 42) -> dict[str, Any]:
    """
    Generates a deterministic, representative 13-field test vector.
    Binary field lengths adhere strictly to docs/wire-protocol-v1.md Section 3.1:
      - message_id: 16 bytes (UUID)
      - sender_identity: 32 bytes (Ed25519 public key)
      - nonce_iv: 12 bytes (96-bit AES-GCM IV)
      - auth_tag: 16 bytes (128-bit AES-GCM tag)
      - signature: 64 bytes (Ed25519 digital signature)
      - recipient_key_id: 8 bytes (Gateway key identifier)
      - encrypted_payload: 200 bytes synthetic ciphertext
    """
    # Deterministic 200-byte synthetic ciphertext using linear congruential progression
    ciphertext = bytes(((i * 37 + seed * 13) % 256) for i in range(200))

    vector = {
        "protocol_version": 1,
        "message_id": bytes.fromhex("9f8b4d2a8c3e4b6aa1e2f3d4e5a6b7c8"),           # 16 bytes
        "sender_identity": bytes.fromhex("a3f5c789b12d4e6f8a0b2c4d6e8f0a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f"), # 32 bytes
        "creation_time": 1793085339000,                                              # int64 epoch ms
        "ttl_expiry": 1793171739000,                                                 # int64 epoch ms (+24h)
        "priority": 2,                                                               # uint8 (Critical)
        "coarse_category": 1,                                                        # uint8 (Medical)
        "location_flag": 0,                                                          # uint8 (Available)
        "nonce_iv": bytes.fromhex("1a2b3c4d5e6f7a8b9c0d1e2f"),                       # 12 bytes
        "auth_tag": bytes.fromhex("3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c"),               # 16 bytes
        "signature": bytes.fromhex(                                                  # 64 bytes
            "e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2"
            "e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2"
        ),
        "recipient_key_id": bytes.fromhex("6b65792d67772d32"),                       # 8 bytes ("key-gw-2")
        "encrypted_payload": ciphertext,                                             # 200 bytes
    }
    validate_vector(vector)
    return vector


def validate_vector(vec: dict[str, Any]) -> None:
    """Validates structural constraints and exact byte lengths of the test vector."""
    for field in ENVELOPE_FIELDS:
        if field not in vec:
            raise ValueError(f"Missing required envelope field: {field}")

    expected_lengths = {
        "message_id": 16,
        "sender_identity": 32,
        "nonce_iv": 12,
        "auth_tag": 16,
        "signature": 64,
        "recipient_key_id": 8,
        "encrypted_payload": 200,
    }
    for field, expected_len in expected_lengths.items():
        actual_len = len(vec[field])
        if actual_len != expected_len:
            raise ValueError(
                f"Field '{field}' length mismatch: expected {expected_len} bytes, got {actual_len}"
            )

    if not (0 <= vec["protocol_version"] <= 65535):
        raise ValueError("protocol_version out of uint16 bounds")
    if not (0 <= vec["priority"] <= 255):
        raise ValueError("priority out of uint8 bounds")
    if not (0 <= vec["coarse_category"] <= 255):
        raise ValueError("coarse_category out of uint8 bounds")
    if not (0 <= vec["location_flag"] <= 255):
        raise ValueError("location_flag out of uint8 bounds")
    if vec["ttl_expiry"] <= vec["creation_time"]:
        raise ValueError("ttl_expiry must be strictly greater than creation_time")


def verify_round_trip(original: dict[str, Any], decoded: dict[str, Any]) -> tuple[bool, str]:
    """Compares all 13 logical fields for strict byte and value equality."""
    for field in ENVELOPE_FIELDS:
        if field not in decoded:
            return False, f"Missing field in decoded output: '{field}'"
        orig_val = original[field]
        dec_val = decoded[field]
        if orig_val != dec_val:
            return False, f"Mismatch in field '{field}': expected {orig_val!r}, got {dec_val!r}"
    return True, "MATCH"

# ==============================================================================
# Codec Implementations
# ==============================================================================

# 1. JSON with Base64-encoded binary fields
def encode_json_b64(vec: dict[str, Any]) -> bytes:
    payload = {
        "protocol_version": vec["protocol_version"],
        "message_id": base64.b64encode(vec["message_id"]).decode("ascii"),
        "sender_identity": base64.b64encode(vec["sender_identity"]).decode("ascii"),
        "creation_time": vec["creation_time"],
        "ttl_expiry": vec["ttl_expiry"],
        "priority": vec["priority"],
        "coarse_category": vec["coarse_category"],
        "location_flag": vec["location_flag"],
        "nonce_iv": base64.b64encode(vec["nonce_iv"]).decode("ascii"),
        "auth_tag": base64.b64encode(vec["auth_tag"]).decode("ascii"),
        "signature": base64.b64encode(vec["signature"]).decode("ascii"),
        "recipient_key_id": base64.b64encode(vec["recipient_key_id"]).decode("ascii"),
        "encrypted_payload": base64.b64encode(vec["encrypted_payload"]).decode("ascii"),
    }
    # Compact JSON encoding without extra whitespace
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def decode_json_b64(raw: bytes) -> dict[str, Any]:
    d = json.loads(raw.decode("utf-8"))
    return {
        "protocol_version": d["protocol_version"],
        "message_id": base64.b64decode(d["message_id"].encode("ascii")),
        "sender_identity": base64.b64decode(d["sender_identity"].encode("ascii")),
        "creation_time": d["creation_time"],
        "ttl_expiry": d["ttl_expiry"],
        "priority": d["priority"],
        "coarse_category": d["coarse_category"],
        "location_flag": d["location_flag"],
        "nonce_iv": base64.b64decode(d["nonce_iv"].encode("ascii")),
        "auth_tag": base64.b64decode(d["auth_tag"].encode("ascii")),
        "signature": base64.b64decode(d["signature"].encode("ascii")),
        "recipient_key_id": base64.b64decode(d["recipient_key_id"].encode("ascii")),
        "encrypted_payload": base64.b64decode(d["encrypted_payload"].encode("ascii")),
    }


# 2. CBOR with Integer Map Keys
def encode_cbor_int(vec: dict[str, Any]) -> bytes:
    if not CBOR_AVAILABLE:
        raise RuntimeError("cbor2 is not installed")
    d = {CBOR_NAME_TO_INT[name]: vec[name] for name in ENVELOPE_FIELDS}
    return cbor2.dumps(d, canonical=True)


def decode_cbor_int(raw: bytes) -> dict[str, Any]:
    if not CBOR_AVAILABLE:
        raise RuntimeError("cbor2 is not installed")
    d = cbor2.loads(raw)
    return {CBOR_INT_KEY_MAP[key]: d[key] for key in CBOR_INT_KEY_MAP}


# 3. CBOR with String Map Keys
def encode_cbor_str(vec: dict[str, Any]) -> bytes:
    if not CBOR_AVAILABLE:
        raise RuntimeError("cbor2 is not installed")
    return cbor2.dumps(vec, canonical=True)


def decode_cbor_str(raw: bytes) -> dict[str, Any]:
    if not CBOR_AVAILABLE:
        raise RuntimeError("cbor2 is not installed")
    return cbor2.loads(raw)


# 4. Protocol Buffers (proto3)
def encode_protobuf(vec: dict[str, Any]) -> bytes:
    if not PROTOBUF_AVAILABLE or envelope_pb2 is None:
        raise RuntimeError("envelope_pb2 is not compiled or available")
    msg = envelope_pb2.MessageEnvelope(
        protocol_version=vec["protocol_version"],
        message_id=vec["message_id"],
        sender_identity=vec["sender_identity"],
        creation_time=vec["creation_time"],
        ttl_expiry=vec["ttl_expiry"],
        priority=vec["priority"],
        coarse_category=vec["coarse_category"],
        location_flag=vec["location_flag"],
        nonce_iv=vec["nonce_iv"],
        auth_tag=vec["auth_tag"],
        signature=vec["signature"],
        recipient_key_id=vec["recipient_key_id"],
        encrypted_payload=vec["encrypted_payload"],
    )
    return msg.SerializeToString()


def decode_protobuf(raw: bytes) -> dict[str, Any]:
    if not PROTOBUF_AVAILABLE or envelope_pb2 is None:
        raise RuntimeError("envelope_pb2 is not compiled or available")
    msg = envelope_pb2.MessageEnvelope()
    msg.ParseFromString(raw)
    return {
        "protocol_version": msg.protocol_version,
        "message_id": msg.message_id,
        "sender_identity": msg.sender_identity,
        "creation_time": msg.creation_time,
        "ttl_expiry": msg.ttl_expiry,
        "priority": msg.priority,
        "coarse_category": msg.coarse_category,
        "location_flag": msg.location_flag,
        "nonce_iv": msg.nonce_iv,
        "auth_tag": msg.auth_tag,
        "signature": msg.signature,
        "recipient_key_id": msg.recipient_key_id,
        "encrypted_payload": msg.encrypted_payload,
    }

# ==============================================================================
# Benchmarking Core
# ==============================================================================

def benchmark_function(
    fn: Callable[[Any], Any],
    arg: Any,
    iterations: int,
    warmup: int
) -> tuple[float, float, float, float]:
    """
    Executes warmup iterations, then measures per-iteration latency across `iterations`.
    Returns: (median_us, p95_us, p99_us, mean_us).
    """
    for _ in range(warmup):
        fn(arg)

    latencies_us: list[float] = [0.0] * iterations
    for i in range(iterations):
        t0 = time.perf_counter_ns()
        fn(arg)
        t1 = time.perf_counter_ns()
        latencies_us[i] = (t1 - t0) / 1000.0  # nanoseconds to microseconds

    latencies_us.sort()
    med = statistics.median(latencies_us)
    mean = statistics.fmean(latencies_us)

    p95_idx = int(math.ceil(0.95 * iterations)) - 1
    p95 = latencies_us[max(0, min(p95_idx, iterations - 1))]

    p99_idx = int(math.ceil(0.99 * iterations)) - 1
    p99 = latencies_us[max(0, min(p99_idx, iterations - 1))]

    return med, p95, p99, mean


def simulate_ble_fragmentation(
    serialized_len: int,
    mtu_list: list[int]
) -> list[dict[str, Any]]:
    """
    Simulates BLE packet fragmentation per docs/wire-protocol-v1.md Section 6.2:
      - Framing header: 10 bytes (Magic: 2B, TotalLen: 4B, ChunkIdx: 2B, TotalChunks: 2B)
      - ATT header: 3 bytes
      - Total overhead per chunk = 13 bytes
      - Max chunk payload = MTU - 13
      - Number of chunks = ceil(serialized_len / MaxChunkPayload)
      - Total transmitted bytes = serialized_len + (chunks * 13)
    """
    sim_results = []
    for mtu in mtu_list:
        max_chunk_payload = mtu - 13
        if max_chunk_payload <= 0:
            raise ValueError(f"MTU {mtu} is too small to carry 13-byte transport framing")
        chunks = math.ceil(serialized_len / max_chunk_payload)
        framing_overhead = chunks * 10
        total_on_air = serialized_len + (chunks * 13)
        sim_results.append({
            "mtu": mtu,
            "max_payload": max_chunk_payload,
            "chunks": chunks,
            "framing_overhead": framing_overhead,
            "total_on_air": total_on_air,
        })
    return sim_results

# ==============================================================================
# Main Orchestrator
# ==============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="RESQNET Wire Serialization Benchmark Prototype (DEC-06)"
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=10000,
        help="Number of timed benchmark iterations per operation (default: 10000)"
    )
    parser.add_argument(
        "--warmup",
        type=int,
        default=500,
        help="Number of untimed warmup iterations (default: 500)"
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Deterministic pseudo-random seed for synthetic payload (default: 42)"
    )
    parser.add_argument(
        "--mtus",
        type=str,
        default="23,185,247,517",
        help="Comma-separated BLE ATT MTU sizes to simulate (default: 23,185,247,517)"
    )
    parser.add_argument(
        "--compile-proto",
        action="store_true",
        help="Attempt compiling envelope.proto using grpc_tools.protoc if installed"
    )
    args = parser.parse_args()

    # Optional Protobuf compilation helper
    global PROTOBUF_AVAILABLE, envelope_pb2
    if args.compile_proto and not PROTOBUF_AVAILABLE:
        try:
            from grpc_tools import protoc
            proto_dir = os.path.dirname(os.path.abspath(__file__))
            proto_file = os.path.join(proto_dir, "envelope.proto")
            print(f"[*] Compiling {proto_file} via grpc_tools.protoc...")
            res = protoc.main([
                "protoc",
                f"-I{proto_dir}",
                f"--python_out={proto_dir}",
                proto_file,
            ])
            if res == 0:
                print("[+] Compilation succeeded.")
                if proto_dir not in sys.path:
                    sys.path.insert(0, proto_dir)
                import envelope_pb2 as pb2_mod
                envelope_pb2 = pb2_mod
                PROTOBUF_AVAILABLE = True
            else:
                print(f"[-] protoc failed with exit code: {res}")
        except ImportError:
            print("[-] grpc_tools is not installed. Run: pip install grpcio-tools")

    mtu_list = [int(m.strip()) for m in args.mtus.split(",") if m.strip()]

    print("=" * 80)
    print("RESQNET WIRE SERIALIZATION BENCHMARK (DEC-06 CANDIDATES)")
    print(f"Target: docs/wire-protocol-v1.md | Iterations: {args.iterations:,} | Warmup: {args.warmup:,}")
    print("=" * 80)

    # 1. Generate & Validate Test Vector
    test_vec = generate_representative_vector(seed=args.seed)
    raw_binary_bytes = sum(len(test_vec[f]) for f in BINARY_FIELDS)
    print(f"Logical Fields:        13 envelope fields")
    print(f"Raw Binary Data:       {raw_binary_bytes} bytes across 7 cryptographic fields")
    print(f"Synthetic Ciphertext:  {len(test_vec['encrypted_payload'])} bytes (AES-256-GCM incident payload)")
    print()

    # 2. Candidate Formats Definitions
    candidates: list[dict[str, Any]] = [
        {
            "name": "JSON + Base64",
            "available": True,
            "encoder": encode_json_b64,
            "decoder": decode_json_b64,
            "note": "Standard library json + base64 (compact separators)",
        },
        {
            "name": "CBOR (Integer Keys)",
            "available": CBOR_AVAILABLE,
            "encoder": encode_cbor_int,
            "decoder": decode_cbor_int,
            "note": "RFC 8949 canonical, 1-byte integer keys 1..13",
            "missing_reason": "cbor2 package not installed (pip install cbor2)",
        },
        {
            "name": "CBOR (String Keys)",
            "available": CBOR_AVAILABLE,
            "encoder": encode_cbor_str,
            "decoder": decode_cbor_str,
            "note": "RFC 8949 canonical, descriptive UTF-8 string keys",
            "missing_reason": "cbor2 package not installed (pip install cbor2)",
        },
        {
            "name": "Protobuf (proto3)",
            "available": PROTOBUF_AVAILABLE,
            "encoder": encode_protobuf,
            "decoder": decode_protobuf,
            "note": "envelope.proto compiled via grpc_tools.protoc",
            "missing_reason": "envelope_pb2.py missing (pip install protobuf grpcio-tools)",
        },
    ]

    # 3. Benchmark Execution
    results: list[dict[str, Any]] = []
    print(f"{'Format':<22} | {'Status':<10} | {'Size (B)':<8} | {'Enc Med (us)':<12} | {'Enc p95':<8} | {'Dec Med (us)':<12} | {'Dec p95':<8} | {'Round-Trip'}")
    print("-" * 105)

    for cand in candidates:
        name = cand["name"]
        if not cand["available"]:
            print(f"{name:<22} | {'SKIPPED':<10} | {'-':<8} | {'-':<12} | {'-':<8} | {'-':<12} | {'-':<8} | {cand['missing_reason']}")
            continue

        encoder = cand["encoder"]
        decoder = cand["decoder"]

        # Serialization size & round-trip verification
        try:
            serialized = encoder(test_vec)
            size_b = len(serialized)
            decoded = decoder(serialized)
            rt_match, rt_msg = verify_round_trip(test_vec, decoded)
            rt_status = "PASS" if rt_match else f"FAIL ({rt_msg})"
        except Exception as ex:
            print(f"{name:<22} | {'ERROR':<10} | {'-':<8} | {'-':<12} | {'-':<8} | {'-':<12} | {'-':<8} | {ex}")
            continue

        # Encoding latency
        enc_med, enc_p95, enc_p99, enc_mean = benchmark_function(
            encoder, test_vec, args.iterations, args.warmup
        )

        # Decoding latency
        dec_med, dec_p95, dec_p99, dec_mean = benchmark_function(
            decoder, serialized, args.iterations, args.warmup
        )

        print(
            f"{name:<22} | {'OK':<10} | {size_b:<8} | {enc_med:>10.2f} us | {enc_p95:>6.2f} us | "
            f"{dec_med:>10.2f} us | {dec_p95:>6.2f} us | {rt_status}"
        )

        results.append({
            "name": name,
            "size": size_b,
            "enc_med": enc_med,
            "enc_p95": enc_p95,
            "dec_med": dec_med,
            "dec_p95": dec_p95,
            "rt_status": rt_status,
            "serialized": serialized,
        })

    print("-" * 105)
    print()

    # 4. BLE Packet Fragmentation Simulation (Section 6.2 Framing Model)
    print("=" * 80)
    print("SIMULATED BLE PACKET FRAGMENTATION (docs/wire-protocol-v1.md Sec 6.2)")
    print("NOTE: Simulation model (10B framing header + 3B ATT header). Not a physical radio test.")
    print("=" * 80)

    for mtu in mtu_list:
        max_chunk = mtu - 13
        print(f"\n--- ATT MTU: {mtu} bytes (Max Chunk Payload = {max_chunk} bytes) ---")
        print(f"{'Format':<22} | {'Wire Size':<10} | {'Chunks Needed':<14} | {'Framing Overhead':<18} | {'Total On-Air Bytes'}")
        print("-" * 80)
        for res in results:
            sim = simulate_ble_fragmentation(res["size"], [mtu])[0]
            chunks = sim["chunks"]
            overhead = sim["framing_overhead"]
            total_bytes = sim["total_on_air"]
            fragment_label = " (NO FRAGMENTATION)" if chunks == 1 else ""
            print(
                f"{res['name']:<22} | {res['size']:>6} B   | {chunks:>6} chunks   | "
                f"{overhead:>8} B (+{(overhead/res['size'])*100:4.1f}%)   | {total_bytes:>8} B{fragment_label}"
            )

    # 5. Missing Dependency Diagnostics
    missing_deps = [c for c in candidates if not c["available"]]
    if missing_deps:
        print("\n" + "=" * 80)
        print("DEPENDENCY & REPRODUCIBILITY INSTRUCTIONS:")
        print("To run all 4 candidates in this benchmark:")
        print("  1. Install dependencies:")
        print("     pip install -r experiments/simulator/requirements.txt")
        print("  2. Compile envelope.proto:")
        print("     python -m grpc_tools.protoc -Iexperiments/simulator --python_out=experiments/simulator experiments/simulator/envelope.proto")
        print("     (Or re-run this script with: python experiments/simulator/serialization_benchmark.py --compile-proto)")
        print("  3. Run the benchmark:")
        print("     python experiments/simulator/serialization_benchmark.py")
        print("=" * 80)


if __name__ == "__main__":
    main()
