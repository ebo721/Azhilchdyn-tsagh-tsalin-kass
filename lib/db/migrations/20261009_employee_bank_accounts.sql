-- Keep the recipient's full account as text, preserving leading zeroes.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS bank_account_number text NOT NULL DEFAULT '';

-- Only a verified final-salary link identifies the employee reliably.
-- bank.account is the RECIPIENT account; bank.bank_account_number is the
-- company's funding account and must never be copied into employee records.
-- Select the newest payment first, then validate it: do not silently substitute
-- an older account if the newest statement contains a masked/invalid account.
WITH latest_salary AS (
  SELECT DISTINCT ON (e.id)
    e.id AS employee_id,
    upper(regexp_replace(b.account, '[[:space:]]', '', 'g')) AS recipient_account
  FROM public.employees e
  JOIN public.cash_transactions c
    ON split_part(c.source_key, ':', 2) = e.id::text
   AND c.source_key ~ '^[0-9]{4}-[0-9]{2}:[0-9]+(:2)?$'
   AND c.source_type = 'payroll'
   AND c.type = 'expense'
  JOIN public.bank_transactions b
    ON b.cash_transaction_id = c.id
   AND c.bank_transaction_id = b.id
   AND c.bank_verified_at IS NOT NULL
   AND b.type = 'expense'
  ORDER BY e.id, coalesce(b.executed_at, b.transaction_at) DESC, b.id DESC
)
UPDATE public.employees e
SET bank_account_number = latest.recipient_account
FROM latest_salary latest
WHERE e.id = latest.employee_id
  AND e.bank_account_number = ''
  AND latest.recipient_account ~ '^(MN[0-9]{18}|[0-9]{6,34})$';
