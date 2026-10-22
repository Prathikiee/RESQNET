
# RESQNET

## Security-Aware Offline Emergency Communication Mesh

RESQNET is a research prototype for secure emergency messaging
between Android devices during interruptions to cellular and
internet infrastructure.

## Core objectives

- Offline peer discovery and message transfer.
- Secure emergency message creation and validation.
- Store-carry-forward messaging during intermittent connectivity.
- Authorized gateway integration with a command dashboard.
- Reproducible physical-device and security testing.

## Technology direction

- Android: Kotlin and Jetpack Compose.
- Networking: Bluetooth Low Energy and Wi-Fi Direct.
- Security: Android Keystore, AES-256-GCM and Ed25519.
- Storage: Room and SQLite.
- Dashboard: React and TypeScript.
- Research: Python and structured experimental telemetry.

## Project status

Initial repository foundation. Individual subsystem implementations
and integration tests are not yet verified.
