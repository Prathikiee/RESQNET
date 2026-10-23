
# RESQNET DTN and Storage Design

## Owner
Pooja — DTN Engine and Database

## Objective
Retain eligible emergency messages during disconnection and
forward them when a suitable connection becomes available.

## Planned technology
- Room persistence library.
- SQLite database.
- Kotlin coroutines for asynchronous work.
- Bounded message queues.

## Planned message lifecycle
1. Receive a packet.
2. Validate its basic structure.
3. Ask the security layer to validate its authenticity.
4. Check message identity and duplicate state.
5. Store an eligible packet persistently.
6. Queue it for forwarding.
7. Forward it when a suitable peer becomes available.
8. Record delivery state or expire it according to policy.

## Requirements
- Unique message identifiers.
- Bounded storage and queue capacity.
- Priority-based forwarding policy.
- TTL and expiry handling.
- Duplicate suppression.
- Safe database transactions.
- Retry handling and persistent state.
- Structured event logging.

## Tests to implement later
- Insert and retrieve a message.
- Restart the application and recover queued messages.
- Reject duplicate message identifiers.
- Expire stale messages.
- Enforce queue capacity.
- Forward a queued message after reconnection.
- Handle database errors safely.

## Status
Design preparation only. DTN implementation is not yet verified.
