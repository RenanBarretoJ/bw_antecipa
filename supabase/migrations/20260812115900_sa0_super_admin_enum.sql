-- SA0: registra o papel administrativo antes das estruturas que o utilizam.
-- Esta migration precisa permanecer separada para que o novo valor do enum
-- seja confirmado antes de casts, tabelas e funcoes da migration seguinte.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'super_admin';
