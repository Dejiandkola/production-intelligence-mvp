-- Migration 017: Custom item fields for Settings and Customer Service intake.
--
-- Admins define item fields in Settings. Customer Service fills active fields
-- during item intake, and the values stay attached to the item through workflow.

CREATE OR REPLACE FUNCTION public.normalize_custom_field_label(p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT regexp_replace(lower(trim(coalesce(p_label, ''))), '\s+', ' ', 'g');
$$;

CREATE TABLE IF NOT EXISTS public.custom_fields (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  module text NOT NULL DEFAULT 'items' CHECK (module = 'items'),
  label text NOT NULL CHECK (length(trim(label)) > 0),
  label_normalized text GENERATED ALWAYS AS (public.normalize_custom_field_label(label)) STORED,
  field_type text NOT NULL CHECK (field_type IN ('short_text', 'long_text', 'number', 'date', 'dropdown', 'checkbox')),
  required boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, module, label_normalized)
);

CREATE TABLE IF NOT EXISTS public.custom_field_options (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(trim(label)) > 0),
  label_normalized text GENERATED ALWAYS AS (public.normalize_custom_field_label(label)) STORED,
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (field_id, label_normalized)
);

CREATE TABLE IF NOT EXISTS public.custom_field_values (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  text_value text,
  number_value numeric,
  boolean_value boolean,
  date_value date,
  option_value uuid REFERENCES public.custom_field_options(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(text_value, number_value, boolean_value, date_value, option_value) <= 1),
  UNIQUE (organization_id, item_id, field_id)
);

CREATE INDEX IF NOT EXISTS custom_fields_org_module_order_idx
ON public.custom_fields (organization_id, module, display_order, created_at);

CREATE INDEX IF NOT EXISTS custom_field_options_field_order_idx
ON public.custom_field_options (field_id, display_order, created_at);

CREATE INDEX IF NOT EXISTS custom_field_values_item_idx
ON public.custom_field_values (organization_id, item_id);

CREATE INDEX IF NOT EXISTS custom_field_values_field_idx
ON public.custom_field_values (organization_id, field_id);

ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_fields_select_org" ON public.custom_fields;
DROP POLICY IF EXISTS "custom_fields_admin_write" ON public.custom_fields;
DROP POLICY IF EXISTS "custom_field_options_select_org" ON public.custom_field_options;
DROP POLICY IF EXISTS "custom_field_options_admin_write" ON public.custom_field_options;
DROP POLICY IF EXISTS "custom_field_values_select_org" ON public.custom_field_values;
DROP POLICY IF EXISTS "custom_field_values_operational_write" ON public.custom_field_values;

CREATE POLICY "custom_fields_select_org"
ON public.custom_fields
FOR SELECT
USING (organization_id = public.current_org_id());

CREATE POLICY "custom_fields_admin_write"
ON public.custom_fields
FOR ALL
USING (organization_id = public.current_org_id() AND public.has_permission('admin'))
WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('admin'));

CREATE POLICY "custom_field_options_select_org"
ON public.custom_field_options
FOR SELECT
USING (organization_id = public.current_org_id());

CREATE POLICY "custom_field_options_admin_write"
ON public.custom_field_options
FOR ALL
USING (organization_id = public.current_org_id() AND public.has_permission('admin'))
WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('admin'));

CREATE POLICY "custom_field_values_select_org"
ON public.custom_field_values
FOR SELECT
USING (organization_id = public.current_org_id());

CREATE POLICY "custom_field_values_operational_write"
ON public.custom_field_values
FOR ALL
USING (
  organization_id = public.current_org_id()
  AND (
    public.has_permission('admin')
    OR public.has_permission('manage_customer_service')
    OR public.has_permission('manage_production')
  )
)
WITH CHECK (
  organization_id = public.current_org_id()
  AND (
    public.has_permission('admin')
    OR public.has_permission('manage_customer_service')
    OR public.has_permission('manage_production')
  )
);

DROP TRIGGER IF EXISTS set_updated_at_custom_fields ON public.custom_fields;
CREATE TRIGGER set_updated_at_custom_fields
BEFORE UPDATE ON public.custom_fields
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_custom_field_options ON public.custom_field_options;
CREATE TRIGGER set_updated_at_custom_field_options
BEFORE UPDATE ON public.custom_field_options
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_custom_field_values ON public.custom_field_values;
CREATE TRIGGER set_updated_at_custom_field_values
BEFORE UPDATE ON public.custom_field_values
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS audit_custom_fields ON public.custom_fields;
CREATE TRIGGER audit_custom_fields
AFTER INSERT OR UPDATE OR DELETE ON public.custom_fields
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_custom_field_options ON public.custom_field_options;
CREATE TRIGGER audit_custom_field_options
AFTER INSERT OR UPDATE OR DELETE ON public.custom_field_options
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_custom_field_values ON public.custom_field_values;
CREATE TRIGGER audit_custom_field_values
AFTER INSERT OR UPDATE OR DELETE ON public.custom_field_values
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

NOTIFY pgrst, 'reload schema';
