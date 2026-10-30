# Reparo incremental de ACL da Preview SERPRO

Escopo exclusivo: `preview/serpro-s22-certificacao` (`fgttffyrkabpycmbnppi`).

Esta pasta nao faz parte de `supabase/migrations` da aplicacao. O SQL exige a
consolidacao localmente certificada `20261030205748`, seu hash e sua auditoria;
nao pode ser usado em Producao/Homolog ou como executor SQL generico.

O reparo remove somente privilegios excedentes por objeto, preservando grants
legitimos, RLS, owners, funcoes, dados, defaults nativos e historico existente.
Nenhum baseline e reaplicado no ambiente hospedado. SERPRO permanece OFF.
