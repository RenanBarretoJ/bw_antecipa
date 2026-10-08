-- R1.8: additional non-relaxation proof; no business-function replacements.
BEGIN;
SELECT no_plan();
SELECT is(private.resolver_valor_base_antecipacao('LIQUIDO',100,90,'DOCUMENTO_EXPLICITO',false),90::numeric,'explicit fiscal net accepted');
SELECT ok(private.nfse_calculo_liquido_valido(100,90,'{"versao":1,"formula":"BRUTO_MENOS_RETENCOES","completo":true,"bruto":100,"total_retencoes":10,"liquido":90,"componentes":[{"codigo":"IRRF","valor":10,"rotulo":"IRRF"}]}'),'documented retentions accepted');
SELECT is(private.resolver_valor_base_antecipacao('LIQUIDO',100,90,'CALCULADO_RETENCOES',false),90::numeric,'calculated fiscal net supported');
SELECT ok(NOT private.nfse_calculo_liquido_valido(100,90,NULL),'missing evidence rejected');
SELECT ok(NOT private.nfse_calculo_liquido_valido(100,90,'{"versao":1,"formula":"BRUTO_MENOS_RETENCOES","completo":false,"bruto":100,"total_retencoes":10,"liquido":90,"componentes":[{"codigo":"IRRF","valor":10,"rotulo":"IRRF"}]}'),'incomplete evidence rejected');
SELECT ok(NOT private.nfse_calculo_liquido_valido(100,90,'{"versao":1,"formula":"BRUTO_MENOS_RETENCOES","completo":true,"bruto":100,"total_retencoes":10,"liquido":90,"componentes":[]}'),'empty retention evidence rejected');
SELECT ok(NOT private.nfse_calculo_liquido_valido(100,91,'{"versao":1,"formula":"BRUTO_MENOS_RETENCOES","completo":true,"bruto":100,"total_retencoes":10,"liquido":90,"componentes":[{"codigo":"IRRF","valor":10,"rotulo":"IRRF"}]}'),'inconsistent arithmetic rejected');
SELECT throws_ok($$SELECT private.resolver_valor_base_antecipacao('LIQUIDO',100,NULL,NULL,false)$$,'P0001','Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas','missing net rejected with exact contract');
SELECT throws_ok($$SELECT private.resolver_valor_base_antecipacao('LIQUIDO',100,0,'DOCUMENTO_EXPLICITO',false)$$,'P0001','Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas','zero explicit net rejected');
SELECT throws_ok($$SELECT private.resolver_valor_base_antecipacao('LIQUIDO',100,0,'CALCULADO_RETENCOES',false)$$,'P0001','Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas','zero calculated net rejected');
SELECT throws_ok($$SELECT private.resolver_valor_base_antecipacao('LIQUIDO',100,-1,'DOCUMENTO_EXPLICITO',false)$$,'P0001','Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas','negative net rejected');
SELECT throws_ok($$SELECT private.resolver_valor_base_antecipacao('LIQUIDO',100,101,'DOCUMENTO_EXPLICITO',false)$$,'P0001','Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas','net above gross rejected');
SELECT throws_ok($$SELECT private.resolver_valor_base_antecipacao('LIQUIDO',100,'NaN'::numeric,'DOCUMENTO_EXPLICITO',false)$$,'P0001','Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas','NaN net rejected');
SELECT throws_ok($$SELECT private.resolver_valor_base_antecipacao('LIQUIDO',100,90,'LEGACY_BRUTO',false)$$,'P0001','Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas','legacy fallback rejected');
SELECT * FROM finish();
ROLLBACK;
