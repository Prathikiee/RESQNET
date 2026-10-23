
# RESQNET Security Design

## Owner
Medha — Cryptography and Application Security

## Security objectives
1. Protect emergency message confidentiality.
2. Detect unauthorized message modification.
3. Authenticate the sender using digital signatures.
4. Reject duplicate or replayed messages.
5. Restrict message decryption to authorized receivers.

## Planned cryptographic components
- AES-256-GCM for authenticated payload encryption.
- Ed25519 for digital signatures.
- Android Keystore for protected key management.
- A defined key-distribution and trust policy.

## Design decisions to finalize
- How sender public keys are authenticated.
- How encryption keys reach authorized gateways.
- Which packet fields are signed.
- How nonce uniqueness is maintained.
- How replay state survives application restarts.
- How keys are rotated or revoked.
- How cryptographic failures are reported.

## Required negative tests
- Modified ciphertext.
- Invalid authentication tag.
- Invalid digital signature.
- Modified signed header.
- Duplicate packet submission.
- Expired message.
- Unknown or unauthorized sender.

## Status
Design preparation only. Cryptographic implementation is not yet verified.
