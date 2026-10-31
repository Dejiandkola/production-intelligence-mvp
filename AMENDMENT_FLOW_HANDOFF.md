# Amendment flow handoff

Current UI work is not deployed. Migrations `031`-`035` are in `erp-next/supabase/migrations/`; check which are already present in the intended database, apply any missing ones in order, and verify before deploying the UI. The Requests screen groups requests by customer/ticket, shows history in the assignment form, and uses one status dropdown per amendment. Consultants or Customer Service assign a first amendment immediately, then confirm completion before Accounts can pay. Further amendments remain on hold.

## Correcting an assigned amendment

An amendment is assigned as soon as it is submitted, so its request is no longer `PENDING` and the Requests screen does not show an Edit button. The status dropdown only changes **In progress / Completed** for all linked tasks; it cannot change a task, tailor, note, or task list.

The Requests screen now provides **Correct assignment** for an assigned amendment whose tasks are all In progress. It opens the existing correction form, scoped to that amendment's garment and tasks. Select **Correct** on a task, choose a different task or tailor, and provide a reason. Submission sends the proposal to Customer Service review; it does not immediately change the assignment. A task with a pending correction shows **Correction pending** and cannot submit another proposal from that view.

Migration `027_approved_assignment_corrections.sql` supports this flow for individual `CREATED` assignments. It does **not** add/remove tasks or edit paid work. History inside the assignment form remains read-only.

Example: if "shorten sleeves" was assigned to Tailor A but should go to Tailor B, use **Correct assignment** while it is In progress. If it is Completed or partly completed but unpaid, first return it to In progress; the Requests screen displays this guidance. Paid or partly paid amendments do not offer correction. Paid work requires a separate financial correction decision. Whether to allow changing notes or adding/removing tasks remains an open decision.

Relevant code: `erp-next/src/app/(app)/requests/RequestsClient.tsx`, `erp-next/src/components/Requests/RequestForm.tsx`, `erp-next/src/components/Requests/GarmentHistory.tsx`, and migrations `027`, `034`, `035`. The local Next.js build, TypeScript, and lint checks passed in this session; database integration and deployment were not verified.

Correction UI verification still needed with test users: open an In progress amendment, confirm only its tasks appear, submit a tailor change with a reason, verify the pending indicator, and approve/reject it through Customer Service. Check Completed → In progress → correction, and confirm paid/partly paid amendments offer no action. No new migration is required for this UI restoration.
