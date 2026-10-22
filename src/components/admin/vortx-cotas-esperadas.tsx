'use client'

import { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { configuracaoCarteiraConsolidadaSchema, lerConfiguracaoCarteiraVortx, type CotaEsperadaVortx } from '@/lib/integracoes/vortx/carteira-configuracao'

type LinhaCota = CotaEsperadaVortx & { chave: number; codigoVisitado?: boolean; nomeVisitado?: boolean }
type Edicao = { estado: 'SEM_LISTA' } | { estado: 'INVALIDA' } | { estado: 'EDITANDO'; linhas: LinhaCota[]; sequencia: number }

function iniciarEdicao(configuracao: Record<string, unknown>): Edicao {
  const leitura = lerConfiguracaoCarteiraVortx(configuracao)
  if (leitura.estado !== 'CONFIGURADA') return { estado: leitura.estado === 'INVALIDA' ? 'INVALIDA' : 'SEM_LISTA' }
  return { estado: 'EDITANDO', linhas: leitura.configuracao.cotas.map((cota, chave) => ({ ...cota, chave })), sequencia: leitura.configuracao.cotas.length }
}

export function VortxCotasEsperadas({ configuracao, pending }: { configuracao: Record<string, unknown>; pending: boolean }) {
  const id = useId()
  const [edicao, setEdicao] = useState<Edicao>(() => iniciarEdicao(configuracao))
  const valor = edicao.estado === 'EDITANDO'
    ? { versao: 1, cotas: edicao.linhas.map(({ codigoCarteira, rotulo }) => ({ codigoCarteira, rotulo })) }
    : edicao.estado === 'INVALIDA' ? {} : null
  const validacao = configuracaoCarteiraConsolidadaSchema.safeParse(valor)

  function atualizarLinha(chave: number, campos: Partial<LinhaCota>) {
    setEdicao(atual => atual.estado === 'EDITANDO' ? { ...atual, linhas: atual.linhas.map(linha => linha.chave === chave ? { ...linha, ...campos } : linha) } : atual)
  }

  function adicionarLinha() {
    if (edicao.estado !== 'EDITANDO' || edicao.linhas.length >= 100) return
    const chave = edicao.sequencia
    setEdicao(atual => atual.estado === 'EDITANDO' ? {
      ...atual, sequencia: atual.sequencia + 1, linhas: [...atual.linhas, { chave, codigoCarteira: '', rotulo: '' }],
    } : atual)
    requestAnimationFrame(() => document.getElementById(`${id}-${chave}-codigo`)?.focus())
  }

  function removerLinha(chave: number) {
    if (edicao.estado !== 'EDITANDO') return
    const restantes = edicao.linhas.filter(linha => linha.chave !== chave)
    setEdicao(atual => atual.estado === 'EDITANDO' ? { ...atual, linhas: restantes } : atual)
    requestAnimationFrame(() => document.getElementById(restantes.length ? `${id}-${restantes[0].chave}-codigo` : `${id}-adicionar`)?.focus())
  }

  return <fieldset disabled={pending} className="space-y-4 rounded-xl border border-border p-4 md:col-span-2" aria-describedby={`${id}-ajuda`}>
    <legend className="px-1 text-sm font-semibold">Cotas esperadas da carteira</legend>
    <input type="hidden" name="carteiraConsolidada" value={JSON.stringify(valor)} />
    <p id={`${id}-ajuda`} className="text-sm text-muted-foreground">
      Informe todas as cotas deste Fundo pelos códigos da API Carteira JSON. Eles são diferentes do código da carteira VRS usado para solicitar relatórios.
      A consolidação exige todas as cotas na mesma data e não depende do horário da consulta.
    </p>
    {edicao.estado === 'INVALIDA' ? <div className="space-y-3">
      <p role="alert" className="text-sm text-destructive">A lista salva nesta versão não pôde ser validada. Ela não será apagada ou substituída automaticamente.</p>
      <Button type="button" variant="outline" onClick={() => setEdicao({ estado: 'EDITANDO', linhas: [{ chave: 0, codigoCarteira: '', rotulo: '' }], sequencia: 1 })}>Corrigir lista de cotas</Button>
    </div> : <>
      <label htmlFor={`${id}-definir`} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
        <input id={`${id}-definir`} type="checkbox" checked={edicao.estado === 'EDITANDO'} onChange={event => setEdicao(event.target.checked
          ? { estado: 'EDITANDO', linhas: [{ chave: 0, codigoCarteira: '', rotulo: '' }], sequencia: 1 }
          : { estado: 'SEM_LISTA' })} className="size-4" />Definir as cotas esperadas deste Fundo
      </label>
      {edicao.estado === 'SEM_LISTA' ? <p className="text-sm text-muted-foreground">Sem essa lista, a consolidação do PL permanece bloqueada. As demais funcionalidades da integração não são ativadas ou desativadas por este cadastro.</p> : <>
        <div className="space-y-3">{edicao.linhas.map((linha, index) => {
          const erros = validacao.success ? [] : validacao.error.issues
          const erroCodigo = erros.find(issue => issue.path[1] === index && issue.path[2] === 'codigoCarteira')?.message
          const erroNome = erros.find(issue => issue.path[1] === index && issue.path[2] === 'rotulo')?.message
          const mostrarCodigo = Boolean(erroCodigo && (linha.codigoVisitado || linha.codigoCarteira.trim()))
          const mostrarNome = Boolean(erroNome && linha.nomeVisitado)
          return <div key={linha.chave} className="grid items-start gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
            <div className="space-y-1">
              <Label htmlFor={`${id}-${linha.chave}-codigo`}>Código da cota {index + 1} (obrigatório)</Label>
              <Input id={`${id}-${linha.chave}-codigo`} value={linha.codigoCarteira} required maxLength={100} pattern="[A-Za-z0-9._\-]+" placeholder="Ex.: 12345" aria-invalid={mostrarCodigo || undefined} aria-describedby={mostrarCodigo ? `${id}-${linha.chave}-erro-codigo` : undefined}
                onChange={event => atualizarLinha(linha.chave, { codigoCarteira: event.target.value })} onBlur={() => atualizarLinha(linha.chave, { codigoVisitado: true })} />
              {mostrarCodigo && <p id={`${id}-${linha.chave}-erro-codigo`} className="text-sm text-destructive">{erroCodigo}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-${linha.chave}-nome`}>Nome da cota {index + 1} (obrigatório)</Label>
              <Input id={`${id}-${linha.chave}-nome`} value={linha.rotulo} required maxLength={100} placeholder="Ex.: Cota subordinada" aria-invalid={mostrarNome || undefined} aria-describedby={mostrarNome ? `${id}-${linha.chave}-erro-nome` : undefined}
                onChange={event => atualizarLinha(linha.chave, { rotulo: event.target.value })} onBlur={() => atualizarLinha(linha.chave, { nomeVisitado: true })} />
              {mostrarNome && <p id={`${id}-${linha.chave}-erro-nome`} className="text-sm text-destructive">{erroNome}</p>}
            </div>
            <Button type="button" variant="outline" className="min-h-11 min-w-11 sm:mt-6" aria-label={`Remover cota ${index + 1}`} onClick={() => removerLinha(linha.chave)}><Trash2 aria-hidden="true" className="size-4" /></Button>
          </div>
        })}</div>
        <div className="flex flex-wrap items-center gap-3">
          <Button id={`${id}-adicionar`} type="button" variant="outline" className="min-h-11" disabled={edicao.linhas.length >= 100} onClick={adicionarLinha}><Plus aria-hidden="true" className="size-4" />Adicionar cota</Button>
          <p className="text-sm text-muted-foreground" aria-live="polite">{edicao.linhas.length ? `${edicao.linhas.length} cota(s) na lista` : 'Adicione pelo menos uma cota antes de salvar.'}</p>
        </div>
      </>}
    </>}
    <p className="text-xs text-muted-foreground">Salvar altera somente o rascunho; a lista entra em vigor ao publicar essa versão com confirmação MFA. Este cadastro prepara a validação e ainda não habilita a importação da carteira.</p>
  </fieldset>
}

export function VortxCotasEsperadasResumo({ configuracao }: { configuracao: Record<string, unknown> }) {
  const leitura = lerConfiguracaoCarteiraVortx(configuracao)
  if (leitura.estado === 'NAO_CONFIGURADA') return <p className="text-xs text-muted-foreground">Cotas esperadas: não configuradas</p>
  if (leitura.estado === 'INVALIDA') return <p className="text-xs text-destructive">Cotas esperadas: configuração requer revisão</p>
  return <details className="mt-2 text-sm">
    <summary className="cursor-pointer font-medium">Cotas esperadas · {leitura.configuracao.cotas.length}</summary>
    <ul className="mt-2 space-y-1">{leitura.configuracao.cotas.map(cota => <li key={cota.codigoCarteira} className="break-words"><span className="font-mono">{cota.codigoCarteira}</span> · {cota.rotulo}</li>)}</ul>
  </details>
}
