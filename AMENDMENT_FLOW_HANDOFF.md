# Amendment flow handoff

## Current flow

Consultants or Customer Service assign a first amendment immediately. Its tasks start In progress. Confirming **Completed** records physical completion separately (`amendment_completed_at` and `amendment_completed_by`); it leaves task status `CREATED`, so Accounts still sees pending work.

Accounts shows **Completed / awaiting approval** with **Approve** and **Reject**. Only an Accounts user (`manage_payments`) or Admin can make that decision. Approval sets `QC_PASSED`; rejection sets `QC_FAILED` and requires a reason. Consultant completion does neither. The Accounts screen has no **Record Payment** action. Existing payment history remains intact.

Further amendments remain on hold. Replacement requests retain their existing approval workflow.

## Correcting an assigned amendment

**Correct assignment** is available when all tasks are In progress and awaiting Accounts review. It opens only that amendment's tasks. Choose **Correct**, select a different task or tailor, and provide a reason. The existing Customer Service review flow applies the correction. Pending corrections must be resolved before completion can be confirmed.

A completed amendment can return to In progress while all tasks are still pending in Accounts. Once Accounts approves or rejects any task, Accounts must reverse those decisions first. Paid work is locked. Adding/removing tasks and editing notes remain separate product decisions.

## Migration and verification

Apply migrations `031`?`035` and then `20261031151157_separate_amendment_completion_from_accounts.sql` before deploying the dependent UI. The latest migration preserves existing completion and moves old, identifiable automatic approvals back to pending Accounts review only when their exact completion marker is present and there is no payment record. Paid work and explicit Accounts approvals are preserved.

Run `npm run test:amendment-accounts` in `erp-next` for the isolated PostgreSQL regression test. It executes the actual migration with a minimal schema and simulated permission helpers. It covers completion without approval, Accounts approve/reject/reverse, permission and organization boundaries, correction guards, payment preservation, and history output. It does not validate all deployed schema triggers, RLS policies, concurrent sessions, or browser behavior.

Before rollout, verify with separate Consultant and Accounts test users: assign ? complete ? pending in Accounts ? approve/reject ? reverse ? return to In progress ? correct assignment. Confirm Record Payment is absent. Live database application and end-to-end verification remain outstanding.
