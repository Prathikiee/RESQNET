# Dashboard testing

## Tools

The dashboard uses Vitest for test execution, React Testing Library for
component rendering and accessible queries, `@testing-library/user-event` for
user interactions, `@testing-library/jest-dom` for DOM assertions, and jsdom
as the browser-like test environment.

## Configuration

Vitest is configured in `vite.config.ts` with the jsdom environment and
`src/test/setup.ts`, which registers the DOM matchers and cleans up rendered
components after each test. The tests are TypeScript files included by the
existing application TypeScript configuration and are type-checked by the
build.

## Test organization and coverage

- `src/App.test.tsx` tests dashboard navigation and summary data, demo alerts,
  optional alert verification, priority filtering, local demo dismissal, empty
  states, gateway and security-feed statuses, and data-source load failures.
- `src/data/dashboardDataSource.test.ts` verifies the configured data source
  returns the existing demo data.

The component tests mock the data-source boundary to exercise explicitly
supplied data and rejection states. They do not configure or imply a live
backend.

## Commands

- `npm run test` runs the suite once.
- `npm run test:watch` runs Vitest in watch mode.
- `npm run build` type-checks and builds the application, including test
  TypeScript files.
- `npm run lint` runs the configured Oxlint checks.

## Known limitations

The data source currently always returns local demo data; there is no live
backend or network integration to test. The automated suite therefore checks
the current data-source result and simulates failures and alternate source
states at the component boundary. jsdom does not validate layout, styling,
responsive behavior, or real browser rendering.
