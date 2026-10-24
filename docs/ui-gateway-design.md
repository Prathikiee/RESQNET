
# RESQNET UI and Gateway Design

## Owner
Manvitha — Android UI, Dashboard and Gateway Integration

## Android SOS interface
- Emergency category selection.
- Emergency message input.
- Location permission and location status.
- Clear SOS submission and confirmation states.
- Visible delivery and verification status.
- Accessible controls and readable error messages.

## Web command dashboard
- Incoming verified incidents.
- Incident time, category and priority.
- Location display when valid coordinates are available.
- Packet verification and delivery status.
- Gateway and connection status.
- Security event visibility.

## Gateway integration requirements
- Define the REST API contract before implementation.
- Validate incoming data.
- Display only appropriately validated incidents.
- Handle duplicate requests and API errors.
- Keep sensitive credentials out of frontend code and logs.

## User-interface states
- Ready.
- Preparing SOS.
- Queued offline.
- Transmitting.
- Received by gateway.
- Rejected or failed.
- Location unavailable.

## Testing requirements
- Form validation.
- Location permission denial.
- Offline submission.
- Gateway unavailable.
- Invalid API response.
- Verified incident displayed once.

## Status
Design preparation only. UI and gateway integration are not yet verified.
