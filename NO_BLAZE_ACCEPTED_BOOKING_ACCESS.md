# Accepted-booking monitoring access (no Blaze plan)

## What changed

- Farmer bookings are mirrored to Realtime Database at `storageBookings/{facilityId}/{bookingId}`.
- Cold Storage accounts receive their own requests from Firebase, even on a different browser/device.
- Only the Cold Storage account assigned to that facility can accept or reject the request.
- On acceptance, a rule-validated grant is created at `monitoringAccess/{farmerUid}/facilityIds/{facilityId}`.
- The farmer's Monitoring page automatically lists every facility with an accepted booking and subscribes to that facility's sensor feed.
- ESP32 write rules now use the locked-down `/deviceAccess/{deviceUid}` mapping, so each facility can have its own sensor device.
- No Cloud Functions deployment and no Blaze billing plan are used.

## Facilities currently mapped

| Facility ID | Cold storage |
|---|---|
| `COLD_BOX_01` | Agra Cold Storage |
| `GREEN_FRESH_01` | Green Fresh Storage |
| `YAMUNA_COLD_01` | Yamuna Cold Chain |

Only Agra currently has the sample ESP32 configuration/device set up in this project. Green Fresh and Yamuna can be authorized using this workflow, but they will show live values only after an ESP32 is installed and configured to upload to their matching facility paths.

## Deploy

1. Upload the updated project files to GitHub Pages.
2. In Firebase Console → Realtime Database → Rules, paste all of `database.rules.json` and Publish.
3. For each Cold Storage account, set its `/userAccess/{uid}` record with `active: true`, `role: "Cold Storage"`, and the correct `facilityId`.
4. For each farmer, keep its approved `/userAccess/{uid}` record with `active: true` and `role: "Farmer"`. Do not manually create a monitoring grant.
5. For each ESP32, create a separate Firebase Auth device user. Add `/deviceAccess/{deviceUid}` with `enabled: true` and the facility ID. Set that device's `FACILITY_ID` to the same ID.
6. Farmer creates a booking. The assigned storage account sees it in Booking Requests and clicks Accept Booking. The Monitoring page then lists that facility for the farmer.

## Security and limitations

- The automatic cross-device approval flow applies to bookings created after these updated files are deployed. Older requests stored only in a browser's `localStorage` are not automatically copied to Firebase; recreate those bookings or handle them through your existing process.

- `/userAccess` and `/deviceAccess` remain non-writable by normal browser users.
- Booking status can be changed only by the cold-storage account assigned to the facility.
- A monitoring grant must reference an accepted booking owned by that farmer.
- A farmer can read only the facility IDs granted to that account.
- Only minimal booking metadata is shared for cross-device approval; OTP/payment data are not synchronized to the authorization record. Other app workflows still use localStorage and have not all been migrated to a shared cloud database.
- A facility not listed in `firebase-config.js` must be added there with a unique facility ID and then assigned to the cold-storage account and sensor device.
