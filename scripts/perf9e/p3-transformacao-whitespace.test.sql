\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p3_transformar_definicao(
  p_definicao text,
  p_trecho_antigo text,
  p_trecho_novo text
)
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  v_definicao text := pg_catalog.replace(p_definicao, E'\r\n', E'\n');
  v_trecho_normalizado text := pg_catalog.replace(p_trecho_antigo, E'\r\n', E'\n');
  v_trecho_novo_normalizado text := pg_catalog.replace(p_trecho_novo, E'\r\n', E'\n');
  v_padrao text := '';
  v_char text;
  v_pos integer := 1;
  v_em_literal boolean := false;
  v_ocorrencias bigint;
  v_resultado text;
BEGIN
  WHILE v_pos <= pg_catalog.char_length(v_trecho_normalizado) LOOP
    v_char := pg_catalog.substr(v_trecho_normalizado, v_pos, 1);

    IF v_char = '''' THEN
      v_padrao := v_padrao || v_char;
      IF v_em_literal
         AND pg_catalog.substr(v_trecho_normalizado, v_pos + 1, 1) = '''' THEN
        v_padrao := v_padrao || '''';
        v_pos := v_pos + 2;
        CONTINUE;
      END IF;
      v_em_literal := NOT v_em_literal;
      v_pos := v_pos + 1;
      CONTINUE;
    END IF;

    IF NOT v_em_literal AND v_char ~ '[[:space:]]' THEN
      v_padrao := v_padrao || '[[:space:]]+';
      WHILE v_pos <= pg_catalog.char_length(v_trecho_normalizado)
        AND pg_catalog.substr(v_trecho_normalizado, v_pos, 1) ~ '[[:space:]]'
      LOOP
        v_pos := v_pos + 1;
      END LOOP;
      CONTINUE;
    END IF;

    IF pg_catalog.strpos(E'\\.^$|?*+()[]{}', v_char) > 0 THEN
      v_padrao := v_padrao || E'\\' || v_char;
    ELSE
      v_padrao := v_padrao || v_char;
    END IF;
    v_pos := v_pos + 1;
  END LOOP;

  IF v_em_literal THEN
    RAISE EXCEPTION 'anchor SQL invalido';
  END IF;

  SELECT pg_catalog.count(*)
    INTO v_ocorrencias
    FROM pg_catalog.regexp_matches(v_definicao, v_padrao, 'g');

  IF v_ocorrencias <> 1 THEN
    RAISE EXCEPTION 'esperado exatamente 1 trecho; encontrados %', v_ocorrencias;
  END IF;

  v_resultado := pg_catalog.regexp_replace(
    v_definicao,
    v_padrao,
    v_trecho_novo_normalizado
  );

  IF v_resultado = v_definicao
     OR pg_catalog.regexp_match(v_resultado, v_padrao) IS NOT NULL THEN
    RAISE EXCEPTION 'transformacao nao consumiu o anchor';
  END IF;

  RETURN v_resultado;
END;
$function$;

DO $test$
DECLARE
  v_anchor text := $anchor$INSERT INTO public.notificacoes (usuario_id, titulo, mensagem)
  SELECT c.user_id, 'Cessao efetivada', 'Mensagem operacional'
  FROM public.cedentes c
  WHERE c.id = op.cedente_id;$anchor$;
  v_novo text := $new$PERFORM private.notificar_cedente_ativos(
    op.cedente_id,
    'Cessao efetivada',
    'Mensagem operacional'
  );$new$;
  v_bloco_p0 text := E'BEGIN;\r\n  INSERT INTO public.notificacoes (usuario_id, titulo, mensagem)\r\n  SELECT c.user_id, ''Cessao efetivada'', ''Mensagem operacional''\r\n  FROM public.cedentes c\r\n  WHERE c.id = op.cedente_id;\r\nEND;';
  v_bloco_whitespace text := E'BEGIN;\n\tINSERT   INTO\tpublic.notificacoes (usuario_id,   titulo,\tmensagem)\n    SELECT\tc.user_id,   ''Cessao efetivada'',\t''Mensagem operacional''\n FROM\tpublic.cedentes   c\n WHERE   c.id   =   op.cedente_id;\nEND;';
  v_resultado text;
  v_falhou boolean;
BEGIN
  -- Caso 1: formatação real da P0, com CRLF e dois espaços.
  v_resultado := pg_temp.p3_transformar_definicao(v_bloco_p0, v_anchor, v_novo);
  IF pg_catalog.strpos(v_resultado, v_novo) = 0
     OR pg_catalog.strpos(v_resultado, 'INSERT INTO public.notificacoes') > 0 THEN
    RAISE EXCEPTION 'caso 1 nao produziu o corpo esperado';
  END IF;

  -- Caso 2: whitespace equivalente diferente fora dos literais SQL.
  v_resultado := pg_temp.p3_transformar_definicao(v_bloco_whitespace, v_anchor, v_novo);
  IF pg_catalog.strpos(v_resultado, v_novo) = 0 THEN
    RAISE EXCEPTION 'caso 2 nao produziu o corpo esperado';
  END IF;

  -- Caso 3: anchor ausente deve falhar fechado.
  v_falhou := false;
  BEGIN
    PERFORM pg_temp.p3_transformar_definicao(
      pg_catalog.replace(v_bloco_p0, 'public.notificacoes', 'public.auditoria'),
      v_anchor,
      v_novo
    );
  EXCEPTION WHEN OTHERS THEN
    v_falhou := SQLERRM LIKE '%encontrados 0%';
  END;
  IF NOT v_falhou THEN
    RAISE EXCEPTION 'caso 3 nao falhou como esperado';
  END IF;

  -- Caso 4: anchor duplicado deve falhar fechado.
  v_falhou := false;
  BEGIN
    PERFORM pg_temp.p3_transformar_definicao(
      v_bloco_p0 || E'\n' || v_bloco_p0,
      v_anchor,
      v_novo
    );
  EXCEPTION WHEN OTHERS THEN
    v_falhou := SQLERRM LIKE '%encontrados 2%';
  END;
  IF NOT v_falhou THEN
    RAISE EXCEPTION 'caso 4 nao falhou como esperado';
  END IF;

  -- Caso 5: trecho semelhante com literal semanticamente diferente não casa.
  v_falhou := false;
  BEGIN
    PERFORM pg_temp.p3_transformar_definicao(
      pg_catalog.replace(v_bloco_p0, 'Cessao efetivada', 'Cessao cancelada'),
      v_anchor,
      v_novo
    );
  EXCEPTION WHEN OTHERS THEN
    v_falhou := SQLERRM LIKE '%encontrados 0%';
  END;
  IF NOT v_falhou THEN
    RAISE EXCEPTION 'caso 5 substituiu trecho semanticamente diferente';
  END IF;
END;
$test$;

SELECT 'P3_TRANSFORMATION_TESTS=PASS' AS resultado;

ROLLBACK;
