import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260807170000_p1_motor_comunicacoes_email.sql', 'utf8')
const remetenteMigration = readFileSync('supabase/migrations/20260810121000_snapshot_remetente_gestora_comunicacoes.sql', 'utf8')
const motor = readFileSync('src/lib/comunicacoes/motor.server.ts', 'utf8')
const cron = readFileSync('src/app/api/cron/comunicacoes/route.ts', 'utf8')
const email = readFileSync('src/lib/email.ts', 'utf8')

describe('arquitetura do motor de comunicacoes', () => {
  it('cria configuracao e templates versionados por fundo sem ativacao implicita', () => {
    expect(migration).toContain('create table public.comunicacao_configuracoes')
    expect(migration).toContain('create table public.comunicacao_configuracao_versoes')
    expect(migration).toContain('create table public.comunicacao_template_versoes')
    expect(migration).not.toMatch(/insert\s+into\s+public\.comunicacao_configuracoes[\s\S]*select\s+id\s+from\s+public\.fundos/i)
  })

  it('protege versoes publicadas e exige autorizacao por fundo', () => {
    expect(migration).toContain('Versoes publicadas de comunicacao sao imutaveis')
    expect(migration).toContain('private.usuario_pode_administrar_fundo_ativo')
    expect(migration).toContain('private.usuario_tem_acesso_fundo')
  })

  it('restringe mutacoes operacionais ao service role', () => {
    expect(migration).toContain("if auth.role() <> 'service_role'")
    expect(migration).toContain('grant execute on function public.registrar_comunicacao_operacional(jsonb, jsonb) to service_role')
    expect(migration).not.toContain('grant insert on table public.comunicacoes to authenticated')
  })

  it('preserva snapshot, idempotencia, Message-ID e no maximo tres tentativas', () => {
    expect(migration).toContain('comunicacoes_idempotency_unique')
    expect(migration).toContain('comunicacoes_message_id_unique')
    expect(migration).toContain('numero_tentativa between 1 and 3')
    expect(motor).toContain('messageId: row.message_id')
    expect(motor).toContain('idempotencyKey: row.idempotency_key')
  })

  it('reutiliza o dominio logistico e o calendario ANBIMA canonicos', () => {
    expect(motor).toContain("from '@/lib/logistica/central/dominio'")
    expect(motor).toContain("from '@/lib/operacoes/calculo'")
    expect(motor).toContain('projetarDocumentoLogistico')
    expect(motor).toContain('ehDiaUtilAnbima')
  })

  it('protege o cron e nao expoe segredos em resposta', () => {
    expect(cron).toContain('timingSafeEqual')
    expect(cron).toContain('CRON_SECRET')
    expect(cron).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('transporta idempotencia e Message-ID pelo SMTP IONOS', () => {
    expect(email).toContain("'X-BW-Idempotency-Key': idempotencyKey")
    expect(email).toContain('messageId }')
    expect(email).toContain("EMAIL_PROVIDER = 'ionos_smtp'")
    expect(email).not.toContain('RESEND_API_KEY')
  })

  it('congela a gestora do fundo como nome visivel do remetente', () => {
    expect(remetenteMigration).toContain('add column if not exists remetente_nome text')
    expect(remetenteMigration).toContain("p_comunicacao ->> 'remetente_nome'")
    expect(motor).toContain("select('id, nome, gestora_nome')")
    expect(motor).toContain('remetente_nome: config.gestoraNome')
    expect(motor).toContain('fromName: resolverNomeRemetenteGestora(row.remetente_nome)')
  })
})
