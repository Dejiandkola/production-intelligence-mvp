import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const migration = await readFile(new URL('../migrations/20261031151157_separate_amendment_completion_from_accounts.sql', import.meta.url), 'utf8')
const paymentMigration = await readFile(new URL('../migrations/028_assignment_disbursements.sql', import.meta.url), 'utf8')
const invariantStart = paymentMigration.indexOf('CREATE OR REPLACE FUNCTION public.enforce_work_assignment_invariants()')
const paymentInvariant = paymentMigration.slice(invariantStart, paymentMigration.indexOf('\n$$;', invariantStart) + 4)

// An isolated PostgreSQL fixture: the production migration is executed unchanged.
// Auth helpers simulate role claims; this does not validate deployed RLS policies.
test('completion and Accounts review are separate database transitions', async t => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE ROLE authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${id(1)}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${id(1)}'::uuid $$;
    CREATE FUNCTION public.current_org_id() RETURNS uuid LANGUAGE sql AS $$
      SELECT current_setting('test.org')::uuid $$;
    CREATE FUNCTION public.has_permission(p text) RETURNS boolean LANGUAGE sql AS $$
      SELECT p = ANY(string_to_array(current_setting('test.permissions'), ',')) $$;
    SET test.org = '${id(2)}';
    SET test.permissions = 'submit_work_requests';
    CREATE TYPE public.work_assignment_status AS ENUM ('CREATED','QC_PASSED','QC_FAILED','PAID','REVERSED');
    CREATE TABLE public.work_change_requests(id uuid PRIMARY KEY, organization_id uuid, kind text, status text, note text, reviewed_at timestamptz);
    CREATE TABLE public.amendment_occurrences(id uuid PRIMARY KEY, request_id uuid, organization_id uuid, item_id uuid, ordinal integer);
    CREATE TABLE public.work_assignments(
      id uuid PRIMARY KEY, organization_id uuid, amendment_occurrence_id uuid, item_id uuid,
      status public.work_assignment_status, qc_notes text, reversal_reason text, updated_at timestamptz DEFAULT now(),
      category_type_id uuid, task_type_id uuid, tailor_id uuid, pay_amount numeric, created_at timestamptz DEFAULT now(),
      pay_band_snapshot text, rate_snapshot numeric, pay_source text, negotiated_pay_amount numeric, negotiated_price_note text
    );
    CREATE TABLE public.assignment_disbursements(assignment_id uuid, organization_id uuid, amount numeric);
    CREATE TABLE public.work_assignment_corrections(id uuid, assignment_id uuid, status text);
    CREATE TABLE public.items(id uuid, replacement_of_item_id uuid, ticket_id uuid, organization_id uuid,
      item_key text, status text, product_type_id uuid, created_at timestamptz, approved_work_change_request_id uuid);
    CREATE TABLE public.product_types(id uuid, name text);
    CREATE TABLE public.task_types(id uuid, name text);
    CREATE TABLE public.category_types(id uuid, name text);
    CREATE TABLE public.tailors(id uuid, name text);
    INSERT INTO public.work_change_requests VALUES ('${id(3)}','${id(2)}','AMENDMENT','APPROVED','Sleeves',null);
    INSERT INTO public.amendment_occurrences VALUES ('${id(4)}','${id(3)}','${id(2)}','${id(5)}',0);
    INSERT INTO public.items VALUES ('${id(5)}',null,'${id(6)}','${id(2)}','Suit-1','NEW','${id(7)}',now(),null);
    INSERT INTO public.product_types VALUES ('${id(7)}','Suit');
    INSERT INTO public.work_assignments(id,organization_id,amendment_occurrence_id,item_id,status,qc_notes) VALUES
      ('${id(10)}','${id(2)}','${id(4)}','${id(5)}','CREATED',null),
      ('${id(11)}','${id(2)}','${id(4)}','${id(5)}','CREATED',null),
      ('${id(12)}','${id(2)}',null,'${id(5)}','CREATED',null),
      ('${id(20)}','${id(2)}','${id(40)}',null,'QC_PASSED','Completion confirmed by Consultant or Customer Service'),
      ('${id(21)}','${id(2)}','${id(40)}',null,'PAID','Completion confirmed by Consultant or Customer Service'),
      ('${id(22)}','${id(2)}','${id(40)}',null,'QC_PASSED','Approved by Accounts');
    INSERT INTO public.assignment_disbursements VALUES ('${id(21)}','${id(2)}',0);
  `)
  await db.exec(paymentInvariant)
  await db.exec('CREATE TRIGGER enforce_work_assignment_invariants BEFORE UPDATE ON public.work_assignments FOR EACH ROW EXECUTE FUNCTION public.enforce_work_assignment_invariants()')
  await db.exec(migration)
  const sql = query => db.query(query)
  const role = permissions => db.exec(`SET test.permissions = '${permissions}'`)
  const completion = done => sql(`SELECT public.set_amendment_request_completion('${id(3)}',${done})`)
  const review = (task, action, reason = 'Checked') => sql(`SELECT public.review_amendment_task('${id(task)}','${action}','${reason}')`)
  const task = async n => (await sql(`SELECT * FROM public.work_assignments WHERE id='${id(n)}'`)).rows[0]

  assert.equal((await task(20)).status, 'CREATED', 'old automatic approval becomes pending')
  assert.ok((await task(20)).amendment_completed_at)
  assert.equal((await task(21)).status, 'PAID', 'historical payments preserved')
  assert.equal((await task(22)).status, 'QC_PASSED', 'explicit Accounts approval preserved')
  await role('manage_payments')
  await assert.rejects(review(10, 'approve'), /confirm completion/)
  await role('submit_work_requests')
  await completion(true)
  for (const n of [10, 11]) {
    assert.equal((await task(n)).status, 'CREATED', 'completion must not approve')
    assert.ok((await task(n)).amendment_completed_at)
    assert.equal((await task(n)).amendment_completed_by, id(1))
  }
  assert.equal((await task(12)).amendment_completed_at, null, 'ordinary tasks untouched')
  const history = (await sql(`SELECT public.get_garment_work_history('${id(5)}') AS history`)).rows[0].history
  assert.ok(history.items[0].tasks.find(row => row.id === id(10)).amendment_completed_at)
  await assert.rejects(review(10, 'approve'), /Accounts permission/)
  await assert.rejects(sql(`UPDATE public.work_assignments SET status='QC_PASSED' WHERE id='${id(10)}'`), /Accounts permission/)
  await assert.rejects(sql(`INSERT INTO public.work_assignment_corrections VALUES ('${id(50)}','${id(10)}','PENDING')`), /In progress/)
  await assert.rejects(sql(`UPDATE public.work_assignments SET tailor_id='${id(99)}' WHERE id='${id(10)}'`), /In progress/)
  await role('manage_payments')
  await review(10, 'approve')
  assert.equal((await task(10)).status, 'QC_PASSED')
  await assert.rejects(review(11, 'reject', ''), /reason/)
  await review(11, 'reject')
  assert.equal((await task(11)).status, 'QC_FAILED')
  await role('submit_work_requests')
  await assert.rejects(completion(false), /reverse/)
  await role('manage_payments')
  await review(10, 'reverse')
  await review(11, 'reverse')
  await role('submit_work_requests')
  await completion(false)
  assert.equal((await task(10)).amendment_completed_at, null)
  await sql(`INSERT INTO public.work_assignment_corrections VALUES ('${id(50)}','${id(10)}','PENDING')`)
  await assert.rejects(completion(true), /pending assignment corrections/)
  assert.equal((await task(11)).amendment_completed_at, null, 'failed completion is atomic')
  await sql(`UPDATE public.work_assignment_corrections SET status='REJECTED'`)
  await completion(true)
  await db.exec(`SET test.org = '${id(999)}'`)
  await assert.rejects(completion(false), /not found/)
  await role('manage_payments')
  await assert.rejects(review(10, 'approve'), /not found/)
  await db.exec(`SET test.org = '${id(2)}'`)
  await assert.rejects(review(21, 'reverse'), /Paid work/)
  await assert.rejects(review(12, 'approve'), /not found/)
  assert.equal((await sql('SELECT count(*)::int AS count FROM public.assignment_disbursements')).rows[0].count, 1,
    'Accounts approval does not create payment records')
})
