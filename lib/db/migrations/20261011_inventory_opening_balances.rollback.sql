DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.inventory_opening_balances)
     OR EXISTS (SELECT 1 FROM public.inventory_opening_consumptions) THEN
    RAISE EXCEPTION 'Cannot roll back opening stock with recorded balances or consumptions';
  END IF;
END $$;
DROP TABLE public.inventory_opening_consumptions;
DROP TABLE public.inventory_opening_balances;
