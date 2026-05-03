-- Partial payment tracking: run once on Supabase (SQL editor or migration pipeline).
-- amount_remaining_cents is generated — never INSERT/UPDATE that column.

CREATE TABLE IF NOT EXISTS public.billing_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_record_id UUID NOT NULL REFERENCES public.billing_records (id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_payments_billing_record_id_idx
  ON public.billing_payments (billing_record_id);

ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated full access" ON public.billing_payments;
CREATE POLICY "Authenticated full access" ON public.billing_payments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS amount_paid_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.billing_records
  DROP COLUMN IF EXISTS amount_remaining_cents;

ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS amount_remaining_cents INTEGER GENERATED ALWAYS AS (
    COALESCE(total_billed_cents, 0) - COALESCE(amount_paid_cents, 0)
  ) STORED;

-- If legacy total_paid_cents exists, one-time backfill (ignore errors if column missing):
-- UPDATE public.billing_records SET amount_paid_cents = COALESCE(total_paid_cents, 0);
