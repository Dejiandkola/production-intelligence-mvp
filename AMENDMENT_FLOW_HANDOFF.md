# Amendment flow handoff

Current UI work is not deployed. Migrations `031`-`035` are in `erp-next/supabase/migrations/`; check which are already present in the intended database, apply any missing ones in order, and verify before deploying the UI. The Requests screen groups requests by customer/ticket, shows history in the assignment form, and uses one status dropdown per amendment. Consultants or Customer Service assign a first amendment immediately, then confirm completion before Accounts can pay. Further amendments remain on hold.

## Open decision: correcting an assigned amendment

An amendment is assigned as soon as it is submitted, so its request is no longer `PENDING` and the Requests screen does not show an Edit button. The status dropdown only changes **In progress / Completed** for all linked tasks; it cannot change a task, tailor, note, or task list.

Migration `027_approved_assignment_corrections.sql` already supports proposing a different task or tailor for an individual `CREATED` assignment, with a reason and Customer Service review. It does **not** add/remove tasks or edit paid work. Moving History into the assignment form made it read-only and removed the old visible correction entry point. This is the immediate UI gap, not a request to create a second amendment.

Example: if "shorten sleeves" was assigned to Tailor A but should go to Tailor B, the user needs a **Correct assignment** action on that assigned amendment while it is In progress. If it is Completed but unpaid, first return it to In progress; paid work should use a separate financial correction decision, not an ordinary edit. Decide whether changing notes or adding/removing tasks is needed before extending the database flow.

Relevant code: `erp-next/src/app/(app)/requests/RequestsClient.tsx`, `erp-next/src/components/Requests/RequestForm.tsx`, `erp-next/src/components/Requests/GarmentHistory.tsx`, and migrations `027`, `034`, `035`. The local Next.js build, TypeScript, and lint checks passed in this session; database integration and deployment were not verified.
