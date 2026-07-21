'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { criarFundo, atualizarFundo, toggleAtivoFundo } from '@/lib/actions/gestor'
import { formatCNPJ } from '@/lib/utils'
import { Plus, Pencil, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
} from '@/components/ui/sheet'
import { Fundo } from '@/types/database'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { DetailSection, EmptyState, LoadingState, StatusBadge } from '@/components/data-display/primitives'

const camposVazios = {
  nome: '',
  cnpj: '',
  administradora_nome: '',
  administradora_cnpj: '',
  gestora_nome: 'BLUEWAVE ASSET LTDA',
  gestora_cnpj: '13.703.306/0001-56',
  custodiante_nome: '',
  custodiante_cnpj: '',
  banco: '',
  agencia: '',
  conta_vinculada: '',
  contato_nome: '',
  contato_email: '',
  administradora_endereco: '',
  administradora_ato_declaratorio: '',
}

type FormFields = typeof camposVazios

function fundoParaForm(f: Fundo): FormFields {
  return {
    nome: f.nome,
    cnpj: f.cnpj,
    administradora_nome: f.administradora_nome,
    administradora_cnpj: f.administradora_cnpj,
    gestora_nome: f.gestora_nome,
    gestora_cnpj: f.gestora_cnpj,
    custodiante_nome: f.custodiante_nome ?? '',
    custodiante_cnpj: f.custodiante_cnpj ?? '',
    banco: f.banco ?? '',
    agencia: f.agencia ?? '',
    conta_vinculada: f.conta_vinculada ?? '',
    contato_nome: f.contato_nome ?? '',
    contato_email: f.contato_email ?? '',
    administradora_endereco: f.administradora_endereco ?? '',
    administradora_ato_declaratorio: f.administradora_ato_declaratorio ?? '',
  }
}

function Campo({
  label, name, value, onChange, required, placeholder, half,
}: {
  label: string; name: string; value: string; onChange: (v: string) => void
  required?: boolean; placeholder?: string; half?: boolean
}) {
  return (
    <div className={half ? '' : 'col-span-2'}>
      <Label htmlFor={name} className="text-xs mb-1 block">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Input
        id={name}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm"
      />
    </div>
  )
}

function Secao({ titulo }: { titulo: string }) {
  return (
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t pt-4 mt-1">
      {titulo}
    </p>
  )
}

export default function FundosPage() {
  const [fundos, setFundos] = useState<Fundo[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editando, setEditando] = useState<Fundo | null>(null)
  const [form, setForm] = useState<FormFields>(camposVazios)
  const [salvando, setSalvando] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const set = (field: keyof FormFields) => (value: string) =>
    setForm(prev => ({ ...prev, [field]: value }))

  async function loadData() {
    const supabase = createClient()
    const { data } = await supabase
      .from('fundos')
      .select('*')
      .order('created_at', { ascending: false })
    setFundos((data || []) as Fundo[])
    setLoading(false)
  }

  // A carga inicial sincroniza a lista com o Supabase.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData() }, [])

  function abrirNovo() {
    setEditando(null)
    setForm(camposVazios)
    setSheetOpen(true)
  }

  function abrirEditar(fundo: Fundo) {
    setEditando(fundo)
    setForm(fundoParaForm(fundo))
    setSheetOpen(true)
  }

  async function handleSalvar() {
    if (!form.nome.trim() || !form.cnpj.trim() || !form.administradora_nome.trim() || !form.administradora_cnpj.trim()) {
      setMessage('Preencha os campos obrigatorios (*).')
      setMessageType('error')
      return
    }
    setSalvando(true)
    const result = editando
      ? await atualizarFundo(editando.id, form)
      : await criarFundo(form)
    if (result?.success) {
      setSheetOpen(false)
      await loadData()
      setMessage(result.message || 'Salvo.')
      setMessageType('success')
    } else {
      setMessage(result?.message || 'Erro ao salvar.')
      setMessageType('error')
    }
    setSalvando(false)
  }

  async function handleToggle(fundo: Fundo) {
    setToggling(fundo.id)
    const result = await toggleAtivoFundo(fundo.id, !fundo.ativo)
    if (result?.success) await loadData()
    setMessage(result?.message || '')
    setMessageType(result?.success ? 'success' : 'error')
    setToggling(null)
  }

  return (
    <PageContainer className="space-y-6">
      <PageHeader title="Fundos" description="Gerencie os fundos de investimento." eyebrow="Estrutura financeira" action={<Button onClick={abrirNovo} className="gap-2"><Plus size={16} /> Novo fundo</Button>} />

      {message && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${messageType === 'success' ? 'border-success/25 bg-success/10 text-success-foreground' : 'border-destructive/25 bg-destructive/5 text-destructive'}`}>
          {message}
        </div>
      )}

      <DetailSection title="Fundos cadastrados">
          {loading ? (
            <LoadingState label="Carregando fundos..." />
          ) : fundos.length === 0 ? (
            <EmptyState title="Nenhum fundo cadastrado" description="Cadastre o primeiro fundo para vinculá-lo aos cedentes." action={<Button onClick={abrirNovo}>Novo fundo</Button>} />
          ) : (
            <div className="divide-y">
              {fundos.map(fundo => (
                <div key={fundo.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="space-y-0.5 min-w-0">
                    <p className="font-medium text-sm truncate">{fundo.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCNPJ(fundo.cnpj)}
                      {fundo.administradora_nome && <span className="ml-2">· {fundo.administradora_nome}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <StatusBadge status={fundo.ativo ? 'ativo' : 'inativo'} label={fundo.ativo ? 'Ativo' : 'Inativo'} />
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditar(fundo)}>
                      <Pencil size={13} />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={toggling === fundo.id}
                      onClick={() => handleToggle(fundo)}
                    >
                      {toggling === fundo.id ? <Loader2 size={12} className="animate-spin" /> : (fundo.ativo ? 'Desativar' : 'Ativar')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </DetailSection>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col gap-0 p-0 overflow-hidden">
          <SheetHeader className="border-b px-6 py-4 shrink-0">
            <SheetTitle>{editando ? 'Editar Fundo' : 'Novo Fundo'}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Identificação do Fundo
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Nome" name="nome" value={form.nome} onChange={set('nome')} required placeholder="Ex: HEALTH I FIDC" />
              <Campo label="CNPJ" name="cnpj" value={form.cnpj} onChange={set('cnpj')} required placeholder="00.000.000/0001-00" />
            </div>

            <Secao titulo="Administradora" />
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Nome" name="administradora_nome" value={form.administradora_nome} onChange={set('administradora_nome')} required />
              <Campo label="CNPJ" name="administradora_cnpj" value={form.administradora_cnpj} onChange={set('administradora_cnpj')} required placeholder="00.000.000/0001-00" />
              <Campo label="Endereço" name="administradora_endereco" value={form.administradora_endereco} onChange={set('administradora_endereco')} />
              <Campo label="Ato Declaratório" name="administradora_ato_declaratorio" value={form.administradora_ato_declaratorio} onChange={set('administradora_ato_declaratorio')} />
            </div>

            <Secao titulo="Gestora" />
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Nome" name="gestora_nome" value={form.gestora_nome} onChange={set('gestora_nome')} />
              <Campo label="CNPJ" name="gestora_cnpj" value={form.gestora_cnpj} onChange={set('gestora_cnpj')} placeholder="00.000.000/0001-00" />
            </div>

            <Secao titulo="Custodiante" />
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Nome" name="custodiante_nome" value={form.custodiante_nome} onChange={set('custodiante_nome')} />
              <Campo label="CNPJ" name="custodiante_cnpj" value={form.custodiante_cnpj} onChange={set('custodiante_cnpj')} placeholder="00.000.000/0001-00" />
            </div>

            <Secao titulo="Dados Bancários" />
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Banco" name="banco" value={form.banco} onChange={set('banco')} placeholder="001" half />
              <Campo label="Agência" name="agencia" value={form.agencia} onChange={set('agencia')} placeholder="0000-0" half />
              <Campo label="Conta Vinculada" name="conta_vinculada" value={form.conta_vinculada} onChange={set('conta_vinculada')} placeholder="00000-0" />
            </div>

            <Secao titulo="Contato" />
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Nome" name="contato_nome" value={form.contato_nome} onChange={set('contato_nome')} />
              <Campo label="E-mail" name="contato_email" value={form.contato_email} onChange={set('contato_email')} placeholder="contato@fundo.com.br" />
            </div>
          </div>

          <SheetFooter className="border-t px-6 py-4 shrink-0 flex-row gap-2 mt-0">
            <Button className="flex-1" onClick={handleSalvar} disabled={salvando}>
              {salvando && <Loader2 size={14} className="animate-spin mr-2" />}
              {editando ? 'Salvar alterações' : 'Criar fundo'}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setSheetOpen(false)} disabled={salvando}>
              Cancelar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}
