import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const migration = name => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')

test('workspace edits and additions preserve the round and enforce its boundaries', async t => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${id(1)}'::uuid $$;
    CREATE FUNCTION current_org_id() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('test.org')::uuid $$;
    CREATE FUNCTION has_permission(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.permissions') = 'yes' $$;
    SET test.org = '${id(2)}'; SET test.permissions = 'yes';
    CREATE TABLE work_change_requests(id uuid PRIMARY KEY, organization_id uuid, item_id uuid, kind text,
      status text, version integer, note text, proposed_assignments jsonb, approved_snapshot jsonb,
      updated_by uuid, updated_at timestamptz);
    CREATE TABLE amendment_occurrences(id uuid PRIMARY KEY, organization_id uuid, item_id uuid, request_id uuid, ordinal integer);
    CREATE TABLE items(id uuid PRIMARY KEY, organization_id uuid, product_type_id uuid, status text, approved_work_change_request_id uuid);
    CREATE TABLE work_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
      item_id uuid, amendment_occurrence_id uuid, category_type_id uuid, task_type_id uuid, tailor_id uuid,
      status text, amendment_completed_at timestamptz, pay_amount numeric, pay_band_snapshot text,
      rate_snapshot numeric, pay_source text, negotiated_pay_amount numeric, negotiated_price_note text,
      negotiated_price_set_by uuid, negotiated_price_set_at timestamptz, price_review_requested boolean,
      price_review_reason text, price_review_requested_by uuid, price_review_requested_at timestamptz,
      price_review_resolved_at timestamptz, updated_at timestamptz, created_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX work_assignments_amendment_task_unique ON work_assignments(amendment_occurrence_id,category_type_id,task_type_id)
      WHERE amendment_occurrence_id IS NOT NULL;
    CREATE TABLE assignment_disbursements(assignment_id uuid, organization_id uuid);
    CREATE TABLE work_assignment_corrections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
      request_id uuid, assignment_id uuid, before_assignment jsonb, proposed_assignment jsonb,
      note text, created_by uuid, status text, reviewed_by uuid, reviewed_at timestamptz, applied_at timestamptz);
    CREATE TABLE work_change_request_revisions(request_id uuid, organization_id uuid, version integer,
      actor_user_id uuid, action text, before_state jsonb, after_state jsonb, UNIQUE(request_id, version));
    CREATE TABLE rate_cards(organization_id uuid, product_type_id uuid, category_type_id uuid, task_type_id uuid, active boolean);
    CREATE TABLE category_types(id uuid, organization_id uuid, name text);
    CREATE TABLE task_types(id uuid, organization_id uuid, name text);
    CREATE TABLE tailors(id uuid, organization_id uuid, active boolean);
    CREATE FUNCTION calculate_assignment_pay(uuid, uuid, uuid, uuid)
      RETURNS TABLE(pay_band text, base_fee numeric, final_fee numeric, special_fee numeric)
      LANGUAGE sql AS $$ SELECT 'A'::text, 100::numeric, 100::numeric, NULL::numeric $$;
    CREATE FUNCTION submit_work_assignment_correction(uuid, uuid, uuid, uuid, text)
      RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    INSERT INTO items VALUES ('${id(3)}','${id(2)}','${id(4)}','IN_PRODUCTION',NULL);
    INSERT INTO category_types VALUES ('${id(5)}','${id(2)}','Amendment');
    INSERT INTO task_types VALUES ('${id(6)}','${id(2)}','Waist'),('${id(7)}','${id(2)}','Sleeve');
    INSERT INTO tailors VALUES ('${id(8)}','${id(2)}',true),('${id(9)}','${id(2)}',true);
    INSERT INTO rate_cards VALUES ('${id(2)}','${id(4)}','${id(5)}','${id(6)}',true),('${id(2)}','${id(4)}','${id(5)}','${id(7)}',true);
    INSERT INTO work_change_requests VALUES ('${id(10)}','${id(2)}','${id(3)}','AMENDMENT','APPROVED',2,'Adjust waist',
      '[{"category_type_id":"${id(5)}","task_type_id":"${id(6)}","tailor_id":"${id(8)}"}]','{}',NULL,NULL);
    INSERT INTO amendment_occurrences VALUES ('${id(11)}','${id(2)}','${id(3)}','${id(10)}',0);
    INSERT INTO work_assignments(id,organization_id,item_id,amendment_occurrence_id,category_type_id,task_type_id,tailor_id,status)
      VALUES ('${id(12)}','${id(2)}','${id(3)}','${id(11)}','${id(5)}','${id(6)}','${id(8)}','CREATED');
  `)
  const original = await migration('027_approved_assignment_corrections.sql')
  const start = original.indexOf('CREATE OR REPLACE FUNCTION public.validate_work_change_assignment()')
  await db.exec(original.slice(start, original.indexOf('\n$$;', start) + 4))
  await db.exec('CREATE TRIGGER validate_work_change_assignment BEFORE INSERT OR UPDATE ON work_assignments FOR EACH ROW EXECUTE FUNCTION validate_work_change_assignment()')
  await db.exec(await migration('038_direct_assignment_corrections.sql'))
  await db.exec(await migration('039_amendment_round_workspace.sql'))
  await db.exec(await migration('040_add_amendment_round_tasks.sql'))
  const existing = { assignment_id: id(12), category_type_id: id(5), task_type_id: id(6), tailor_id: id(9) }
  const added = { assignment_id: null, category_type_id: id(5), task_type_id: id(7), tailor_id: id(8) }
  const edit = (version, rows) => db.query('SELECT edit_amendment_round($1,$2,$3,$4,$5::jsonb)', [id(10), version, 'Waist and sleeve', 'Missed sleeve and changed tailor', JSON.stringify(rows)])
  await assert.rejects(edit(1, [existing]), /changed/)
  await assert.rejects(edit(2, [existing, { ...added, task_type_id: id(6) }]), /only once/)
  await edit(2, [existing, added])
  let current = (await db.query('SELECT get_current_amendment_round($1) AS round', [id(3)])).rows[0].round
  assert.equal(current.assignments.length, 2)
  assert.equal(current.assignments.find(task => task.assignment_id === id(12)).tailor_id, id(9))
  assert.equal(current.version, 4)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM amendment_occurrences')).rows[0].n, 1)
  await assert.rejects(edit(2, current.assignments), /changed/)
  await assert.rejects(edit(4, [existing]), /cannot be removed/)
  await assert.rejects(edit(4, [
    ...current.assignments.map(task => task.assignment_id === id(12) ? { ...task, tailor_id: id(8) } : task),
    { ...added, task_type_id: id(98) },
  ]), /no longer available/)
  current = (await db.query('SELECT get_current_amendment_round($1) AS round', [id(3)])).rows[0].round
  assert.equal(current.version, 4, 'failed addition rolls back earlier corrections in the same save')
  assert.equal(current.assignments.find(task => task.assignment_id === id(12)).tailor_id, id(9))
  await db.exec(`INSERT INTO assignment_disbursements VALUES ('${id(12)}','${id(2)}')`)
  await assert.rejects(edit(4, current.assignments), /paid/)
  await db.exec('DELETE FROM assignment_disbursements')
  await db.exec(`UPDATE work_assignments SET amendment_completed_at = now() WHERE id = '${id(12)}'`)
  await assert.rejects(edit(4, current.assignments), /Completed/)
  await db.exec(`UPDATE work_assignments SET amendment_completed_at = NULL, status = 'QC_PASSED' WHERE id = '${id(12)}'`)
  await assert.rejects(edit(4, current.assignments), /approved/)
  await db.exec(`SET test.org = '${id(99)}'`)
  await assert.rejects(edit(4, current.assignments), /not found/)
  await db.exec(`SET test.org = '${id(2)}'; SET test.permissions = 'no'`)
  await assert.rejects(edit(4, current.assignments), /permission/)
  const add = (version, rows) => db.query('SELECT add_amendment_round_tasks($1,$2,$3,$4::jsonb)', [id(10), version, 'Add missing task', JSON.stringify(rows)])
  await assert.rejects(add(4, [added]), /permission/)
  await db.exec(`SET test.permissions = 'yes';
    INSERT INTO task_types VALUES ('${id(13)}','${id(2)}','Length');
    INSERT INTO rate_cards VALUES ('${id(2)}','${id(4)}','${id(5)}','${id(13)}',true);`)
  const extra = { ...added, task_type_id: id(13) }
  // One task is approved; the other is still in progress. Additions must not rewrite either.
  const beforeApproved = (await db.query('SELECT * FROM work_assignments WHERE id=$1', [id(12)])).rows[0]
  await add(4, [extra])
  current = (await db.query('SELECT get_current_amendment_round($1) AS round', [id(3)])).rows[0].round
  assert.equal(current.assignments.length, 3)
  assert.equal(current.version, 5)
  assert.deepEqual((await db.query('SELECT * FROM work_assignments WHERE id=$1', [id(12)])).rows[0], beforeApproved)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM amendment_occurrences')).rows[0].n, 1)
  await assert.rejects(add(4, [extra]), /changed/)
  await assert.rejects(add(5, [{ ...extra, tailor_id: id(9) }]), /already assigned/)
  const pencil = (version, task, tailor) => db.query('SELECT correct_amendment_round_task($1,$2,$3,$4,$5,$6,$7)',
    [id(10), version, task.assignment_id, task.category_type_id, task.task_type_id, tailor, 'Reassign unfinished task'])
  await assert.rejects(pencil(5, current.assignments.find(task => task.assignment_id === id(12)), id(8)), /unfinished/)
  const unfinished = current.assignments.find(task => task.task_type_id === id(7))
  await pencil(5, unfinished, id(9))
  await assert.rejects(pencil(5, unfinished, id(8)), /changed/)
  await db.exec('UPDATE work_assignments SET amendment_completed_at = now()')
  await assert.rejects(add(6, [extra]), /completed or locked/)
  await db.exec(`SET test.org = '${id(99)}'`)
  await assert.rejects(add(6, [extra]), /not found/)

  // Run 040 -> 041 directly, without a cancellation migration.
  await db.exec(`
    SET test.org = '${id(2)}'; SET test.permissions = 'yes';
    ALTER TABLE items ADD COLUMN replacement_of_item_id uuid, ADD COLUMN ticket_id uuid,
      ADD COLUMN item_key text, ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN is_received boolean DEFAULT false;
    CREATE TABLE tickets(id uuid PRIMARY KEY, ticket_number text, customer_name text);
    INSERT INTO tickets VALUES ('${id(14)}','1001','Customer');
    UPDATE items SET ticket_id = '${id(14)}', item_key = 'Suit-1';
    CREATE TABLE product_types(id uuid PRIMARY KEY, name text);
    INSERT INTO product_types VALUES ('${id(4)}','Suit');
    ALTER TABLE tailors ADD COLUMN name text DEFAULT 'Tailor', ADD COLUMN band text DEFAULT 'A';
    ALTER TABLE amendment_occurrences ADD COLUMN legacy_completion_attestation_allowed boolean DEFAULT false;
    ALTER TABLE work_change_requests ADD COLUMN reviewed_at timestamptz;
    ALTER TABLE work_change_requests ADD CONSTRAINT work_change_requests_proposed_assignments_check
      CHECK (jsonb_typeof(proposed_assignments) = 'array' AND jsonb_array_length(proposed_assignments) BETWEEN 1 AND 20);
    ALTER TABLE work_assignments ADD COLUMN reversal_reason text, ADD COLUMN amendment_completed_by uuid;
    ALTER TABLE work_change_request_revisions ADD COLUMN created_at timestamptz DEFAULT now();
    ALTER TABLE work_assignment_corrections ADD CONSTRAINT test_correction_assignment_fk
      FOREIGN KEY (assignment_id) REFERENCES work_assignments(id) ON DELETE RESTRICT;
    ALTER TABLE assignment_disbursements ADD CONSTRAINT test_disbursement_assignment_fk
      FOREIGN KEY (assignment_id) REFERENCES work_assignments(id) ON DELETE RESTRICT;
    UPDATE work_assignments SET status = 'CREATED', amendment_completed_at = NULL;
  `)
  function functionBody(source, marker) {
    const start = source.indexOf(marker)
    assert.ok(start >= 0)
    return source.slice(start, source.indexOf('\n$$;', start) + 4)
  }
  const accountsSource = await migration('020_negotiated_assignment_pay.sql')
  await db.exec(functionBody(accountsSource, 'CREATE OR REPLACE FUNCTION public.get_account_tailor_paginated_tasks('))
  await db.exec(functionBody(accountsSource, 'CREATE OR REPLACE FUNCTION public.get_ticket_paginated_items('))
  const completionSource = await migration('036_separate_amendment_completion_from_accounts.sql')
  await db.exec(functionBody(completionSource, 'CREATE OR REPLACE FUNCTION public.set_amendment_request_completion('))
  await db.exec(functionBody(completionSource, 'CREATE OR REPLACE FUNCTION public.get_garment_work_history('))
  await db.exec(functionBody(original, 'CREATE FUNCTION public.prevent_approved_work_assignment_delete()'))
  await db.exec(`CREATE TRIGGER prevent_approved_work_assignment_delete BEFORE DELETE ON work_assignments
    FOR EACH ROW EXECUTE FUNCTION prevent_approved_work_assignment_delete()`)
  await db.exec(await migration('041_delete_amendment_assignments.sql'))
  assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='work_assignments' AND column_name IN ('cancelled_at','cancelled_by','cancellation_reason')")).rows[0].n, 0)
  const queue = () => db.query("SELECT task FROM get_account_tailor_paginated_tasks(p_filter => 'all')")
  const completion = done => db.query('SELECT set_amendment_request_completion($1,$2)', [id(10), done])
  const remove = (version, assignment = id(12), reason = 'Wrong assignment') => db.query(
    'SELECT delete_amendment_assignment($1,$2,$3,$4)', [id(10), version, assignment, reason])
  await assert.rejects(db.query('DELETE FROM work_assignments WHERE id=$1', [id(12)]), /audited deletion/)
  await assert.rejects(remove(6, id(12), ''), /reason/)
  await assert.rejects(remove(5), /changed/)
  await assert.rejects(remove(6, id(99)), /current amendment round/)
  await db.exec(`SET test.permissions = 'no'`)
  await assert.rejects(remove(6), /permission/)
  await db.exec(`SET test.permissions = 'yes'; SET test.org = '${id(99)}'`)
  await assert.rejects(remove(6), /not found/)
  await db.exec(`SET test.org = '${id(2)}'`)
  await db.query('UPDATE work_assignments SET amendment_completed_at=now() WHERE id=$1', [id(12)])
  await assert.rejects(remove(6), /Completed/)
  await db.query("UPDATE work_assignments SET amendment_completed_at=NULL,status='QC_PASSED' WHERE id=$1", [id(12)])
  await assert.rejects(remove(6), /approved/)
  await db.query("UPDATE work_assignments SET status='CREATED' WHERE id=$1", [id(12)])
  await db.query('INSERT INTO assignment_disbursements VALUES ($1,$2)', [id(12), id(2)])
  await assert.rejects(remove(6), /Paid/)
  await db.exec('DELETE FROM assignment_disbursements')
  await db.query('INSERT INTO work_assignment_corrections(organization_id,request_id,assignment_id,status) VALUES ($1,$2,$3,$4)',
    [id(2), id(10), id(12), 'PENDING'])
  await remove(6)
  assert.equal((await db.query('SELECT id FROM work_assignments WHERE id=$1', [id(12)])).rows.length, 0)
  assert.equal((await db.query('SELECT id FROM work_assignment_corrections WHERE assignment_id=$1', [id(12)])).rows.length, 0)
  const deletion = (await db.query("SELECT before_state,after_state FROM work_change_request_revisions WHERE after_state->>'action'='DELETED' AND after_state->>'assignment_id'=$1", [id(12)])).rows[0]
  assert.equal(deletion.after_state.reason, 'Wrong assignment')
  assert.ok(deletion.before_state.corrections.some(correction => correction.status === 'PENDING'))
  assert.equal((await queue()).rows.length, 2)
  const afterDeletion = (await db.query('SELECT get_garment_work_history($1) AS history', [id(3)])).rows[0].history
  assert.equal(afterDeletion.items[0].tasks.some(task => task.id === id(12)), false)
  assert.equal((await db.query('SELECT item FROM get_ticket_paginated_items()')).rows[0].item.work_assignments.length, 2)
  await add(7, [{ ...added, task_type_id: id(6) }])
  assert.equal((await queue()).rows.length, 3, 'deleted task types can be assigned again using the original unique index')
  await assert.rejects(add(8, [{ ...added, task_type_id: id(6), tailor_id: id(9) }]), /already assigned/)
  current = (await db.query('SELECT get_current_amendment_round($1) AS round', [id(3)])).rows[0].round
  let version = current.version
  for (const task of current.assignments) await remove(version++, task.assignment_id)
  assert.equal((await queue()).rows.length, 0, 'deleted assignments disappear from Accounts')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM work_assignments')).rows[0].n, 0)
  assert.equal((await db.query('SELECT proposed_assignments FROM work_change_requests')).rows[0].proposed_assignments.length, 0)
  await assert.rejects(completion(true), /no linked tasks/)
  await db.exec('UPDATE amendment_occurrences SET legacy_completion_attestation_allowed = true')
  const emptyContext = (await db.query('SELECT get_additional_amendment_context($1) AS context', [id(3)])).rows[0].context
  assert.equal(emptyContext.previous_completed, false)
  assert.equal(emptyContext.can_attest, false, 'an empty round cannot be attested as completed')
  await add(version, [{ ...added, task_type_id: id(6) }])
  assert.equal((await queue()).rows.length, 1, 'the last assignment can be deleted and the empty round refilled')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM amendment_occurrences')).rows[0].n, 1)
})
