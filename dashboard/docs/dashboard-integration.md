# Dashboard data integration

## Current data flow

`App.tsx` requests a `DashboardData` value from `dashboardDataSource` when the
component mounts. The current source implements the typed
`DashboardDataSource` interface by returning `demoDashboardData` from
`src/data/demoData.ts`. The UI labels this source as demo data; dismissing an
alert only removes it from the current screen.

The demo contains three illustrative SOS alerts without verification status.
It supplies no network nodes or security events and marks the gateway as not
connected because no gateway API is configured. These values are not live
emergency, gateway, or security information.

## Integration points

- Implement `DashboardDataSource.getDashboardData()` in
  `src/data/dashboardDataSource.ts` using the API contract agreed with the
  RESQNET backend team. Keep API transport, authentication, and response
  mapping in that data-access layer, not in UI components.
- Map validated backend data into the domain interfaces in
  `src/types/dashboard.ts`; update those interfaces only after the actual
  contract is agreed.
- The dashboard consumes SOS alerts, node records, gateway status, and
  security events through `DashboardData`. An alert's verification status is
  optional and is displayed only when supplied by the source.
- The current source is asynchronous. Errors are surfaced in the dashboard
  instead of being replaced with demo data.

No endpoint, URL, authentication mechanism, wire format, polling strategy, or
gateway protocol has been assumed or configured. Live integration is not
implemented.

## Information needed from the backend and gateway teams

- API base URL(s), environment configuration, endpoint paths, HTTP methods,
  and API/versioning expectations.
- Authentication and authorization requirements, credential handling, CORS
  policy, and any network connectivity constraints.
- Response schemas and examples for alerts, nodes, gateway status, and
  security events, including stable identifiers, timestamps/time zones, and
  enumerated values.
- Which alert states mean received, verified, delivered, acknowledged, or
  resolved; which source is authoritative for each state; and how state
  changes are reported.
- Whether dashboard actions such as dismissing or acknowledging an alert
  should exist for backend data, and the corresponding request and error
  behavior.
- Gateway connectivity/health semantics, update cadence, stale-data rules,
  and any required gateway protocol or adapter.
- Refresh or streaming expectations, pagination/retention limits, and
  expected behavior for partial data or service outages.
