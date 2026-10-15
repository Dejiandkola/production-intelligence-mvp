# Amendment and Replacement Checklist

A checked implementation item means the code was written and passed available static checks. It does not mean the workflow was tested end to end or deployed.

## Implementation

- [x] Define the workflow: Consultants propose; Customer Service approves or rejects; QC and Accounts handle work and pay.
- [x] Keep archived garments ineligible and require one Customer Service approval for replacement.
- [x] Add the Consultant role and Admin request access (migration 022).
- [x] Add the Admin Users screen, invite route, and guarded role assignment (migration 023).
- [x] Add pending requests, revisions, and edit/reject controls (migration 024).
- [x] Add amendment occurrences, repeated-task support, linked replacement items, approval, and assignment guards (migration 025).
- [x] Add Consultants ticket browsing, request forms, task/tailor selection, and request tracking.
- [x] Add Customer Service Pending Requests and read-only visibility for Consultants.
- [x] Add separate first-pass/replacement reporting and linked garment history (migration 026).
- [x] Add audited pre-QC assignment corrections (migration 027).
- [x] Add payment recording separate from QC pay approval (migration 028).
- [x] Initially reserve amendment numbers at submission (migration 029); superseded by approval-time numbering (migration 030).
- [x] Show previous amendments/replacements to reviewers; assign the permanent number on approval (migration 030).
- [x] Keep rejected requests for audit instead of adding deletion. Rejected requests do not receive a permanent amendment number.
- [ ] Add automated database, permission, workflow, reporting, and UI tests. Only read-only SQL assertions exist so far.

## Verification

Use a test organization and disposable items. Do not use live customer data for destructive scenarios.

- [ ] Confirm migrations 022-030 are applied as intended; run both read-only SQL checks in `erp-next/supabase/tests/`.
- [ ] Verify Consultant and Admin request access; Consultant cannot approve, create live assignments, pass QC, or pay.
- [ ] Verify Consultants can see Pending Requests but cannot edit or review another user's request.
- [ ] Verify Admin role assignment persists, rejects cross-organization users, and protects the last Admin.
- [ ] Configure the server-only `SUPABASE_SERVICE_ROLE_KEY`, Auth redirect for `https://erp.dejiandkola.com/reset-password`, and email delivery before testing real invitations.
- [ ] Invite a test Consultant, sign in, and verify their organization and role. Reject duplicate emails, invalid roles, and non-Admin invite calls.
- [ ] Submit and edit an Amendment with a note, multiple tasks, and tailor. Check revision history and confirm no live work or new item before approval.
- [ ] Approve as a different Customer Service user. Reject self-approval, unauthorized approval, and stale versions.
- [ ] Reject a request with a reason. Confirm no work is created and the decision remains visible.
- [ ] Repeat the same Amendment task on one item. Confirm the reviewer sees previous work; approval assigns separate numbered occurrences and assignments, with no overwrite or extra produced item. Reject another pending request and confirm it receives no permanent number.
- [ ] Confirm archived and cancelled items cannot receive or be approved for requests, including through direct RPC calls.
- [ ] Approve a Replacement. Confirm one linked new item, one approval, approved tasks, and separate replacement production counts.
- [ ] Add an Amendment to a replacement and verify the full lineage in garment history.
- [ ] QC-pass and QC-fail sample assignments; verify Accounts and tailor-portal labels and amounts.
- [ ] Submit a correction on pre-QC approved work, review with a different Customer Service user, and verify its audit trail. Block paid or post-QC silent edits.
- [ ] Record a test payment reference after QC approval. Verify paid versus approved-unpaid totals, block duplicate payment, and reject direct paid status changes without a payment record.
- [ ] Confirm approved assignments cannot be deleted by Production/QC users.
- [ ] Check mobile and desktop layouts, dropdowns, badges, counts, and modal actions.

## Deployment Gate

Do not treat a successful build or read-only SQL check as end-to-end verification. Test the request, approval, QC, correction, reporting, and payment paths with separate users in a test organization before deploying dependent UI changes.
