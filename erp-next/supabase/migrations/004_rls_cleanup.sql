-- Items policy cleanup
drop policy if exists "items_update_manage" on public.items;
drop policy if exists "items_delete_manage" on public.items;
drop policy if exists "items_insert_manage" on public.items;
drop policy if exists "items_insert_manage_production" on public.items;
drop policy if exists "items_update" on public.items;
drop policy if exists "items_delete" on public.items;
drop policy if exists "items_insert" on public.items;

create policy "items_insert"
on public.items
for insert
with check (
  organization_id = current_org_id()
  and has_permission('manage_production')
);

create policy "items_update"
on public.items
for update
using (
  organization_id = current_org_id()
  and (
    has_permission('manage_completion')
    or has_permission('manage_qc')
    or has_permission('manage_production')
  )
)
with check (
  organization_id = current_org_id()
);

create policy "items_delete"
on public.items
for delete
using (
  organization_id = current_org_id()
  and has_permission('manage_production')
);

-- Work assignments cleanup
drop policy if exists "work_assignments_delete_manage_production" on public.work_assignments;
drop policy if exists "work_assignments_insert_manage" on public.work_assignments;
drop policy if exists "work_assignments_update_manage" on public.work_assignments;
drop policy if exists "work_assignments_delete_manage" on public.work_assignments;
drop policy if exists "work_assignments_insert" on public.work_assignments;
drop policy if exists "work_assignments_update" on public.work_assignments;
drop policy if exists "work_assignments_delete" on public.work_assignments;

create policy "work_assignments_insert"
on public.work_assignments
for insert
with check (
  organization_id = current_org_id()
  and has_permission('manage_assignments')
);

create policy "work_assignments_update"
on public.work_assignments
for update
using (
  organization_id = current_org_id()
  and has_permission('manage_assignments')
)
with check (
  organization_id = current_org_id()
);

create policy "work_assignments_delete"
on public.work_assignments
for delete
using (
  organization_id = current_org_id()
  and has_permission('manage_assignments')
);

-- Rate cards cleanup
drop policy if exists "rate_cards_delete" on public.rate_cards;
drop policy if exists "rate_cards_delete_manage_rates" on public.rate_cards;
drop policy if exists "rate_cards_insert" on public.rate_cards;
drop policy if exists "rate_cards_insert_manage_rates" on public.rate_cards;
drop policy if exists "rate_cards_update" on public.rate_cards;
drop policy if exists "rate_cards_update_manage_rates" on public.rate_cards;

create policy "rate_cards_insert"
on public.rate_cards
for insert
with check (
  organization_id = current_org_id()
  and has_permission('manage_rates')
);

create policy "rate_cards_update"
on public.rate_cards
for update
using (
  organization_id = current_org_id()
  and has_permission('manage_rates')
)
with check (
  organization_id = current_org_id()
);

create policy "rate_cards_delete"
on public.rate_cards
for delete
using (
  organization_id = current_org_id()
  and has_permission('manage_rates')
);

-- Tailors cleanup
drop policy if exists "tailors_delete_same_org" on public.tailors;
drop policy if exists "tailors_insert_manage_tailors" on public.tailors;
drop policy if exists "tailors_update_manage_tailors" on public.tailors;
drop policy if exists "tailors_insert" on public.tailors;
drop policy if exists "tailors_update" on public.tailors;
drop policy if exists "tailors_delete" on public.tailors;

create policy "tailors_insert"
on public.tailors
for insert
with check (
  organization_id = current_org_id()
  and has_permission('manage_tailors')
);

create policy "tailors_update"
on public.tailors
for update
using (
  organization_id = current_org_id()
  and has_permission('manage_tailors')
)
with check (
  organization_id = current_org_id()
);

create policy "tailors_delete"
on public.tailors
for delete
using (
  organization_id = current_org_id()
  and has_permission('manage_tailors')
);

-- Task types cleanup
drop policy if exists "task_types_select_org" on public.task_types;
drop policy if exists "task_types_insert_same_org" on public.task_types;
drop policy if exists "task_types_select_same_org" on public.task_types;
drop policy if exists "task_types_update_same_org" on public.task_types;
drop policy if exists "task_types_delete_same_org" on public.task_types;
drop policy if exists "task_types_insert" on public.task_types;
drop policy if exists "task_types_update" on public.task_types;
drop policy if exists "task_types_delete" on public.task_types;

create policy "task_types_select_org"
on public.task_types
for select
using (
  organization_id = current_org_id()
);

create policy "task_types_insert"
on public.task_types
for insert
with check (
  organization_id = current_org_id()
  and has_permission('manage_rates')
);

create policy "task_types_update"
on public.task_types
for update
using (
  organization_id = current_org_id()
  and has_permission('manage_rates')
)
with check (
  organization_id = current_org_id()
);

create policy "task_types_delete"
on public.task_types
for delete
using (
  organization_id = current_org_id()
  and has_permission('manage_rates')
);

-- 
delete from role_permissions
where permission_id in (
  select id from permissions where name = 'manage_items'
);

delete from permissions
where name = 'manage_items';