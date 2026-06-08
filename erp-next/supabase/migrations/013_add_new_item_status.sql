-- Migration 013: Add Customer Service intake status.

DO $$
BEGIN
  ALTER TYPE public.item_status ADD VALUE IF NOT EXISTS 'NEW' BEFORE 'IN_PRODUCTION';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
