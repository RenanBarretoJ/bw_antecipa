'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2, Building2, User, Landmark, CheckCircle, Clock, XCircle, Pencil, AlertTriangle } from 'lucide-react'
import { cadastrarCedente, solicitarAlteracaoCedente } from '@/lib/actions/cedente'
import { createClient } from '@/lib/supabase/client'
import { formatCNPJ } from '@/lib/utils'
import {
  etapa1Schema, etapa2Schema, etapa3Schema,
  bancosBrasileiros,
  type CedenteFormData, type RepresentanteData,
} from '@/lib/validations/cedente'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const STORAGE_KEY = 'bw_antecipa_cadastro_cedente'

type FormErrors = Record<string, string[]>

interface SolicitacaoPendente {
  id: string
  status: string
  solicitado_em: string
  motivo_reprovacao: string | null
}

interface RepresentanteCadastrado {
  id: string
  nome: string
  cpf: string
  rg: string
  cargo: string
  email: string
  telefone: string
  principal: boolean
}

interface CedenteCadastrado {
  id: string
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  cnae: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  estado: string | null
  telefone_comercial: string | null
  email_comercial: string | null
  banco: string | null
  agencia: string | null
  conta: string | null
  tipo_conta: string | null
  status: string
  created_at: string
  representantes: RepresentanteCadastrado[]
}

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle; className: string }> = {
  pendente:  { label: 'Pendente de Análise', icon: Clock,        className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  ativo:     { label: 'Ativo',               icon: CheckCircle,  className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  reprovado: { label: 'Reprovado',           icon: XCircle,      className: 'bg-destructive/10 text-destructive border-destructive/20' },
  suspenso:  { label: 'Suspenso',            icon: XCircle,      className: 'bg-orange-100 text-orange-700 border-orange-200' },
}

function maskPhone(v: string) {
  const n = (v || '').replace(/\D/g, '')
  if (n.length <= 10) return n.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return n.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2').slice(0, 15)
}

function Campo({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium text-foreground">{value || '—'}</p>
    </div>
  )
}

function CedenteView({
  cedente,
  solicitacao,
  onSolicitarAlteracao,
}: {
  cedente: CedenteCadastrado
  solicitacao: SolicitacaoPendente | null
  onSolicitarAlteracao: () => void
}) {
  const st = statusConfig[cedente.status] || statusConfig.pendente
  const StatusIcon = st.icon

  const endereco = [
    cedente.logradouro,
    cedente.numero,
    cedente.complemento,
    cedente.bairro,
    cedente.cidade,
    cedente.estado,
  ].filter(Boolean).join(', ')

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{cedente.razao_social}</h1>
          <p className="text-muted-foreground font-mono text-sm mt-0.5">{formatCNPJ(cedente.cnpj)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${st.className}`}>
            <StatusIcon size={13} />
            {st.label}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={onSolicitarAlteracao}
            disabled={solicitacao?.status === 'pendente'}
            className="gap-1.5"
          >
            <Pencil size={14} />
            Solicitar Alteração
          </Button>
        </div>
      </div>

      {/* Banner de solicitação pendente */}
      {solicitacao?.status === 'pendente' && (
        <Card className="border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle size={18} className="text-yellow-600 shrink-0" />
            <p className="text-sm text-yellow-700 dark:text-yellow-400">
              Você tem uma solicitação de alteração aguardando aprovação do gestor. Novos pedidos serão liberados após a análise.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Banner de solicitação reprovada */}
      {solicitacao?.status === 'reprovada' && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-4">
            <XCircle size={18} className="text-destructive shrink-0" />
            <div>
              <p className="text-sm font-medium text-destructive">Última solicitação reprovada</p>
              {solicitacao.motivo_reprovacao && (
                <p className="text-xs text-destructive/80 mt-0.5">Motivo: {solicitacao.motivo_reprovacao}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dados da Empresa */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 size={16} className="text-muted-foreground" />
            Dados da Empresa
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo label="Razão Social" value={cedente.razao_social} />
          <Campo label="Nome Fantasia" value={cedente.nome_fantasia} />
          <Campo label="CNPJ" value={formatCNPJ(cedente.cnpj)} />
          <Campo label="CNAE" value={cedente.cnae} />
          <Campo label="Telefone Comercial" value={maskPhone(cedente.telefone_comercial || '')} />
          <Campo label="E-mail Comercial" value={cedente.email_comercial} />
          {cedente.cep && (
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground mb-0.5">Endereço</p>
              <p className="text-sm font-medium text-foreground">
                {endereco}{cedente.cep ? ` — CEP ${cedente.cep}` : ''}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Representantes */}
      {cedente.representantes.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <User size={14} />
            Representantes Legais
          </h2>
          {cedente.representantes.map((rep, i) => (
            <Card key={rep.id}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  {rep.nome}
                  {rep.principal && (
                    <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">principal</span>
                  )}
                  {!rep.principal && (
                    <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{i + 1}º</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Campo label="CPF" value={rep.cpf} />
                <Campo label="RG" value={rep.rg} />
                <Campo label="Cargo" value={rep.cargo} />
                <Campo label="E-mail" value={rep.email} />
                <Campo label="Telefone" value={maskPhone(rep.telefone)} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dados Bancários */}
      {(cedente.banco || cedente.agencia || cedente.conta) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark size={16} className="text-muted-foreground" />
              Dados Bancários
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-3">
              <Campo label="Banco" value={cedente.banco} />
            </div>
            <Campo label="Agência" value={cedente.agencia} />
            <Campo label="Conta" value={cedente.conta} />
            <Campo label="Tipo" value={cedente.tipo_conta === 'corrente' ? 'Corrente' : cedente.tipo_conta === 'poupanca' ? 'Poupança' : cedente.tipo_conta} />
          </CardContent>
        </Card>
      )}

      {cedente.status === 'pendente' && (
        <p className="text-sm text-muted-foreground text-center">
          Seu cadastro está em análise. Em breve você receberá uma notificação com o resultado.
        </p>
      )}
    </div>
  )
}

// ─── Formulário de cadastro (inalterado) ────────────────────────────────────

function maskCNPJ(v: string) {
  return v.replace(/\D/g, '').replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2').slice(0, 18)
}
function maskCPF(v: string) {
  return v.replace(/\D/g, '').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2').slice(0, 14)
}
function maskCEP(v: string) {
  return v.replace(/\D/g, '').replace(/(\d{5})(\d)/, '$1-$2').slice(0, 9)
}

function CadastroForm() {
  const router = useRouter()
  const [etapa, setEtapa] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [message, setMessage] = useState('')
  const [buscandoCep, setBuscandoCep] = useState(false)
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)

  const [form, setForm] = useState<Partial<CedenteFormData>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    }
    return {
      representantes: [{ nome: '', cpf: '', rg: '', cargo: '', email: '', telefone: '' }],
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form))
  }, [form])

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  const emptyRep: RepresentanteData = { nome: '', cpf: '', rg: '', cargo: '', email: '', telefone: '' }

  const addRepresentante = () =>
    setForm((prev) => ({
      ...prev,
      representantes: [...(prev.representantes || []), { ...emptyRep }],
    }))

  const removeRepresentante = (idx: number) =>
    setForm((prev) => ({
      ...prev,
      representantes: (prev.representantes || []).filter((_, i) => i !== idx),
    }))

  const updateRepresentante = (idx: number, field: keyof RepresentanteData, value: string) =>
    setForm((prev) => {
      const updated = [...(prev.representantes || [])]
      updated[idx] = { ...updated[idx], [field]: value }
      return { ...prev, representantes: updated }
    })

  const buscarCNPJ = async (cnpj: string) => {
    const clean = cnpj.replace(/\D/g, '')
    if (clean.length !== 14) return
    setBuscandoCnpj(true)
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`)
      if (!res.ok) return
      const data = await res.json()
      const telefone = (data.ddd_telefone_1 || '').replace(/\D/g, '')
      const cepLimpo = (data.cep || '').replace(/\D/g, '')
      setForm((prev) => ({
        ...prev,
        razao_social:       data.razao_social   || prev?.razao_social   || '',
        nome_fantasia:      data.nome_fantasia   || prev?.nome_fantasia  || '',
        cnae:               data.cnae_fiscal     ? String(data.cnae_fiscal) : prev?.cnae || '',
        logradouro:         data.logradouro      || prev?.logradouro     || '',
        numero:             data.numero          || prev?.numero         || '',
        complemento:        data.complemento     || prev?.complemento    || '',
        bairro:             data.bairro          || prev?.bairro         || '',
        cidade:             data.municipio       || prev?.cidade         || '',
        estado:             data.uf              || prev?.estado         || '',
        cep:                cepLimpo             || prev?.cep            || '',
        email_comercial:    data.email           || prev?.email_comercial || '',
        telefone_comercial: telefone             || prev?.telefone_comercial || '',
      }))
    } catch { /* ignore */ }
    setBuscandoCnpj(false)
  }

  const buscarCEP = async (cep: string) => {
    const clean = cep.replace(/\D/g, '')
    if (clean.length !== 8) return
    setBuscandoCep(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`)
      const data = await res.json()
      if (!data.erro) {
        setForm((prev) => ({
          ...prev,
          logradouro: data.logradouro || prev?.logradouro || '',
          bairro: data.bairro || prev?.bairro || '',
          cidade: data.localidade || prev?.cidade || '',
          estado: data.uf || prev?.estado || '',
        }))
      }
    } catch { /* ignore */ }
    setBuscandoCep(false)
  }

  const validarEtapa = () => {
    const schemas = { 1: etapa1Schema, 2: etapa2Schema, 3: etapa3Schema }
    const schema = schemas[etapa as keyof typeof schemas]
    const result = schema.safeParse(form)
    if (!result.success) {
      const errosMapeados: FormErrors = {}
      for (const issue of result.error.issues) {
        const chave = issue.path.join('.')
        if (!errosMapeados[chave]) errosMapeados[chave] = []
        errosMapeados[chave].push(issue.message)
      }
      setErrors(errosMapeados)
      return false
    }
    setErrors({})
    return true
  }

  const avancar = () => {
    if (validarEtapa()) setEtapa((e) => e + 1)
  }

  const voltar = () => setEtapa((e) => e - 1)

  const submeter = async () => {
    if (!validarEtapa()) return
    setLoading(true)
    setMessage('')
    const result = await cadastrarCedente(form as CedenteFormData)
    if (result?.success) {
      localStorage.removeItem(STORAGE_KEY)
      router.push('/cedente/documentos')
    } else {
      setMessage(result?.message || 'Erro ao cadastrar.')
      if (result?.errors) setErrors(result.errors)
    }
    setLoading(false)
  }

  const inputClass = (field: string) =>
    errors[field] ? 'border-destructive focus-visible:ring-destructive' : ''

  const ErrorMsg = ({ field }: { field: string }) =>
    errors[field] ? <p className="text-destructive text-sm mt-1">{errors[field][0]}</p> : null

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-2">Cadastro do Cedente</h1>
      <p className="text-muted-foreground mb-6">Preencha os dados para solicitar habilitacao na plataforma.</p>

      {/* Stepper */}
      <div className="flex items-center mb-8">
        {['Dados da Empresa', 'Representante Legal', 'Dados Bancarios'].map((label, i) => (
          <div key={label} className="flex items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              etapa > i + 1
                ? 'bg-emerald-500 text-white'
                : etapa === i + 1
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}>
              {etapa > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`ml-2 text-sm font-medium ${
              etapa === i + 1 ? 'text-primary' : 'text-muted-foreground'
            }`}>
              {label}
            </span>
            {i < 2 && (
              <div className={`flex-1 h-0.5 mx-3 ${
                etapa > i + 1 ? 'bg-emerald-500' : 'bg-border'
              }`} />
            )}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {/* Etapa 1 */}
          {etapa === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1">CNPJ *</Label>
                  <Input className={`h-11 ${inputClass('cnpj')}`} value={maskCNPJ(form.cnpj || '')}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '')
                      updateField('cnpj', v)
                      if (v.length === 14) buscarCNPJ(v)
                    }} placeholder="00.000.000/0000-00" />
                  {buscandoCnpj && <p className="text-primary text-xs mt-1">Buscando dados da empresa...</p>}
                  <ErrorMsg field="cnpj" />
                </div>
                <div>
                  <Label className="mb-1">Razao Social *</Label>
                  <Input className={`h-11 ${inputClass('razao_social')}`} value={form.razao_social || ''}
                    onChange={(e) => updateField('razao_social', e.target.value)} />
                  <ErrorMsg field="razao_social" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1">Nome Fantasia</Label>
                  <Input className={`h-11 ${inputClass('nome_fantasia')}`} value={form.nome_fantasia || ''}
                    onChange={(e) => updateField('nome_fantasia', e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1">CNAE</Label>
                  <Input className={`h-11 ${inputClass('cnae')}`} value={form.cnae || ''}
                    onChange={(e) => updateField('cnae', e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="mb-1">CEP *</Label>
                  <Input className={`h-11 ${inputClass('cep')}`} value={maskCEP(form.cep || '')}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '')
                      updateField('cep', v)
                      if (v.length === 8) buscarCEP(v)
                    }} placeholder="00000-000" />
                  {buscandoCep && <p className="text-primary text-xs mt-1">Buscando endereco...</p>}
                  <ErrorMsg field="cep" />
                </div>
                <div className="md:col-span-2">
                  <Label className="mb-1">Logradouro *</Label>
                  <Input className={`h-11 ${inputClass('logradouro')}`} value={form.logradouro || ''}
                    onChange={(e) => updateField('logradouro', e.target.value)} />
                  <ErrorMsg field="logradouro" />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label className="mb-1">Numero *</Label>
                  <Input className={`h-11 ${inputClass('numero')}`} value={form.numero || ''}
                    onChange={(e) => updateField('numero', e.target.value)} />
                  <ErrorMsg field="numero" />
                </div>
                <div>
                  <Label className="mb-1">Complemento</Label>
                  <Input className={`h-11 ${inputClass('complemento')}`} value={form.complemento || ''}
                    onChange={(e) => updateField('complemento', e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1">Bairro *</Label>
                  <Input className={`h-11 ${inputClass('bairro')}`} value={form.bairro || ''}
                    onChange={(e) => updateField('bairro', e.target.value)} />
                  <ErrorMsg field="bairro" />
                </div>
                <div>
                  <Label className="mb-1">Cidade *</Label>
                  <Input className={`h-11 ${inputClass('cidade')}`} value={form.cidade || ''}
                    onChange={(e) => updateField('cidade', e.target.value)} />
                  <ErrorMsg field="cidade" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="mb-1">Estado *</Label>
                  <Input className={`h-11 ${inputClass('estado')}`} value={form.estado || ''} maxLength={2}
                    onChange={(e) => updateField('estado', e.target.value.toUpperCase())} placeholder="UF" />
                  <ErrorMsg field="estado" />
                </div>
                <div>
                  <Label className="mb-1">Telefone Comercial *</Label>
                  <Input className={`h-11 ${inputClass('telefone_comercial')}`} value={maskPhone(form.telefone_comercial || '')}
                    onChange={(e) => updateField('telefone_comercial', e.target.value.replace(/\D/g, ''))} placeholder="(00) 00000-0000" />
                  <ErrorMsg field="telefone_comercial" />
                </div>
                <div>
                  <Label className="mb-1">E-mail Comercial *</Label>
                  <Input className={`h-11 ${inputClass('email_comercial')}`} type="email" value={form.email_comercial || ''}
                    onChange={(e) => updateField('email_comercial', e.target.value)} />
                  <ErrorMsg field="email_comercial" />
                </div>
              </div>
            </div>
          )}

          {/* Etapa 2 */}
          {etapa === 2 && (
            <div className="space-y-6">
              {(form.representantes || []).map((rep, idx) => (
                <Card key={idx} className="border border-border">
                  <CardHeader className="pb-3 pt-4 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        Representante {idx + 1}
                        {idx === 0 && (
                          <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">(principal)</span>
                        )}
                      </CardTitle>
                      {idx > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRepresentante(idx)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                        >
                          <Trash2 size={16} />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-1">Nome Completo *</Label>
                        <Input
                          className={`h-11 ${errors[`representantes.${idx}.nome`] ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                          value={rep.nome || ''}
                          onChange={(e) => updateRepresentante(idx, 'nome', e.target.value)}
                        />
                        {errors[`representantes.${idx}.nome`] && (
                          <p className="text-destructive text-sm mt-1">{errors[`representantes.${idx}.nome`][0]}</p>
                        )}
                      </div>
                      <div>
                        <Label className="mb-1">CPF *</Label>
                        <Input
                          className={`h-11 ${errors[`representantes.${idx}.cpf`] ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                          value={maskCPF(rep.cpf || '')}
                          onChange={(e) => updateRepresentante(idx, 'cpf', e.target.value.replace(/\D/g, ''))}
                          placeholder="000.000.000-00"
                        />
                        {errors[`representantes.${idx}.cpf`] && (
                          <p className="text-destructive text-sm mt-1">{errors[`representantes.${idx}.cpf`][0]}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-1">RG *</Label>
                        <Input
                          className={`h-11 ${errors[`representantes.${idx}.rg`] ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                          value={rep.rg || ''}
                          onChange={(e) => updateRepresentante(idx, 'rg', e.target.value)}
                        />
                        {errors[`representantes.${idx}.rg`] && (
                          <p className="text-destructive text-sm mt-1">{errors[`representantes.${idx}.rg`][0]}</p>
                        )}
                      </div>
                      <div>
                        <Label className="mb-1">Cargo na Empresa *</Label>
                        <Input
                          className={`h-11 ${errors[`representantes.${idx}.cargo`] ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                          value={rep.cargo || ''}
                          onChange={(e) => updateRepresentante(idx, 'cargo', e.target.value)}
                        />
                        {errors[`representantes.${idx}.cargo`] && (
                          <p className="text-destructive text-sm mt-1">{errors[`representantes.${idx}.cargo`][0]}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-1">E-mail *</Label>
                        <Input
                          type="email"
                          className={`h-11 ${errors[`representantes.${idx}.email`] ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                          value={rep.email || ''}
                          onChange={(e) => updateRepresentante(idx, 'email', e.target.value)}
                        />
                        {errors[`representantes.${idx}.email`] && (
                          <p className="text-destructive text-sm mt-1">{errors[`representantes.${idx}.email`][0]}</p>
                        )}
                      </div>
                      <div>
                        <Label className="mb-1">Telefone Celular *</Label>
                        <Input
                          className={`h-11 ${errors[`representantes.${idx}.telefone`] ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                          value={maskPhone(rep.telefone || '')}
                          onChange={(e) => updateRepresentante(idx, 'telefone', e.target.value.replace(/\D/g, ''))}
                          placeholder="(00) 00000-0000"
                        />
                        {errors[`representantes.${idx}.telefone`] && (
                          <p className="text-destructive text-sm mt-1">{errors[`representantes.${idx}.telefone`][0]}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {errors['representantes'] && (
                <p className="text-destructive text-sm">{errors['representantes'][0]}</p>
              )}

              <Button variant="outline" onClick={addRepresentante} className="w-full">
                <Plus size={16} className="mr-2" />
                Adicionar Representante
              </Button>
            </div>
          )}

          {/* Etapa 3 */}
          {etapa === 3 && (
            <div className="space-y-4">
              <div>
                <Label className="mb-1">Banco *</Label>
                <select
                  className={`h-11 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    errors['banco'] ? 'border-destructive' : 'border-input'
                  }`}
                  value={form.banco || ''}
                  onChange={(e) => updateField('banco', e.target.value)}
                >
                  <option value="">Selecione o banco</option>
                  {bancosBrasileiros.map((b) => (
                    <option key={b.codigo} value={`${b.codigo} - ${b.nome}`}>{b.codigo} - {b.nome}</option>
                  ))}
                </select>
                <ErrorMsg field="banco" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="mb-1">Agencia *</Label>
                  <Input className={`h-11 ${inputClass('agencia')}`} value={form.agencia || ''}
                    onChange={(e) => updateField('agencia', e.target.value.replace(/\D/g, ''))} placeholder="0000" />
                  <ErrorMsg field="agencia" />
                </div>
                <div>
                  <Label className="mb-1">Conta *</Label>
                  <Input className={`h-11 ${inputClass('conta')}`} value={form.conta || ''}
                    onChange={(e) => updateField('conta', e.target.value)} placeholder="00000-0" />
                  <ErrorMsg field="conta" />
                </div>
                <div>
                  <Label className="mb-1">Tipo de Conta *</Label>
                  <select
                    className={`h-11 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      errors['tipo_conta'] ? 'border-destructive' : 'border-input'
                    }`}
                    value={form.tipo_conta || ''}
                    onChange={(e) => updateField('tipo_conta', e.target.value)}
                  >
                    <option value="">Selecione</option>
                    <option value="corrente">Corrente</option>
                    <option value="poupanca">Poupanca</option>
                  </select>
                  <ErrorMsg field="tipo_conta" />
                </div>
              </div>
            </div>
          )}

          {message && (
            <div className={`mt-4 p-3 rounded-lg text-sm border ${
              message.includes('sucesso')
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-destructive/10 text-destructive border-destructive/20'
            }`}>{message}</div>
          )}

          <div className="flex justify-between mt-6 pt-4 border-t border-border">
            {etapa > 1 ? (
              <Button variant="outline" onClick={voltar}>Voltar</Button>
            ) : <div />}

            {etapa < 3 ? (
              <Button variant="default" onClick={avancar}>Proximo</Button>
            ) : (
              <Button onClick={submeter} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando...</> : 'Finalizar Cadastro'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Formulário de alteração (pré-preenchido, chama action diferente) ───────

function AlteracaoForm({ cedente, onCancelar }: { cedente: CedenteCadastrado; onCancelar: () => void }) {
  const [etapa, setEtapa] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [message, setMessage] = useState('')
  const [buscandoCep, setBuscandoCep] = useState(false)

  const [form, setForm] = useState<Partial<CedenteFormData>>({
    nome_fantasia: cedente.nome_fantasia || '',
    cnae: cedente.cnae || '',
    cep: cedente.cep || '',
    logradouro: cedente.logradouro || '',
    numero: cedente.numero || '',
    complemento: cedente.complemento || '',
    bairro: cedente.bairro || '',
    cidade: cedente.cidade || '',
    estado: cedente.estado || '',
    telefone_comercial: cedente.telefone_comercial || '',
    email_comercial: cedente.email_comercial || '',
    banco: cedente.banco || '',
    agencia: cedente.agencia || '',
    conta: cedente.conta || '',
    tipo_conta: (cedente.tipo_conta as 'corrente' | 'poupanca') || undefined,
    representantes: cedente.representantes.length > 0
      ? cedente.representantes.map((r) => ({ nome: r.nome, cpf: r.cpf, rg: r.rg, cargo: r.cargo, email: r.email, telefone: r.telefone }))
      : [{ nome: '', cpf: '', rg: '', cargo: '', email: '', telefone: '' }],
  })

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => { const n = { ...prev }; delete n[field]; return n })
  }

  const updateRepresentante = (idx: number, field: keyof RepresentanteData, value: string) =>
    setForm((prev) => {
      const updated = [...(prev.representantes || [])]
      updated[idx] = { ...updated[idx], [field]: value }
      return { ...prev, representantes: updated }
    })

  const addRepresentante = () =>
    setForm((prev) => ({ ...prev, representantes: [...(prev.representantes || []), { nome: '', cpf: '', rg: '', cargo: '', email: '', telefone: '' }] }))

  const removeRepresentante = (idx: number) =>
    setForm((prev) => ({ ...prev, representantes: (prev.representantes || []).filter((_, i) => i !== idx) }))

  const buscarCEP = async (cep: string) => {
    const clean = cep.replace(/\D/g, '')
    if (clean.length !== 8) return
    setBuscandoCep(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`)
      const data = await res.json()
      if (!data.erro) {
        setForm((prev) => ({ ...prev, logradouro: data.logradouro || prev?.logradouro || '', bairro: data.bairro || prev?.bairro || '', cidade: data.localidade || prev?.cidade || '', estado: data.uf || prev?.estado || '' }))
      }
    } catch { /* ignore */ }
    setBuscandoCep(false)
  }

  const validarEtapa = () => {
    const schemas = { 1: etapa1Schema, 2: etapa2Schema, 3: etapa3Schema }
    const schema = schemas[etapa as keyof typeof schemas]
    const result = schema.safeParse(etapa === 1 ? { ...form, cnpj: cedente.cnpj, razao_social: cedente.razao_social } : form)
    if (!result.success) {
      const erros: FormErrors = {}
      for (const issue of result.error.issues) {
        const chave = issue.path.join('.')
        if (!erros[chave]) erros[chave] = []
        erros[chave].push(issue.message)
      }
      setErrors(erros)
      return false
    }
    setErrors({})
    return true
  }

  const submeter = async () => {
    setLoading(true)
    setMessage('')
    const result = await solicitarAlteracaoCedente(form)
    if (result?.success) {
      setMessage(result.message || 'Solicitacao enviada!')
      setTimeout(() => onCancelar(), 1500)
    } else {
      setMessage(result?.message || 'Erro ao enviar solicitacao.')
      if (result?.errors) setErrors(result.errors)
    }
    setLoading(false)
  }

  const maskCPF = (v: string) => v.replace(/\D/g, '').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2').slice(0, 14)
  const maskCEP = (v: string) => v.replace(/\D/g, '').replace(/(\d{5})(\d)/, '$1-$2').slice(0, 9)
  const inputClass = (field: string) => errors[field] ? 'border-destructive focus-visible:ring-destructive' : ''
  const ErrorMsg = ({ field }: { field: string }) => errors[field] ? <p className="text-destructive text-sm mt-1">{errors[field][0]}</p> : null

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-foreground">Solicitar Alteração Cadastral</h1>
        <Button variant="ghost" size="sm" onClick={onCancelar}>Cancelar</Button>
      </div>
      <p className="text-muted-foreground mb-6">As alterações serão aplicadas após aprovação do gestor.</p>

      <div className="flex items-center mb-8">
        {['Dados da Empresa', 'Representantes', 'Dados Bancários'].map((label, i) => (
          <div key={label} className="flex items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${etapa > i + 1 ? 'bg-emerald-500 text-white' : etapa === i + 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
              {etapa > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`ml-2 text-sm font-medium ${etapa === i + 1 ? 'text-primary' : 'text-muted-foreground'}`}>{label}</span>
            {i < 2 && <div className={`flex-1 h-0.5 mx-3 ${etapa > i + 1 ? 'bg-emerald-500' : 'bg-border'}`} />}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {/* Etapa 1 — Dados da empresa (sem CNPJ e Razão Social) */}
          {etapa === 1 && (
            <div className="space-y-4">
              <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{cedente.razao_social}</span> · {formatCNPJ(cedente.cnpj)}
                <span className="ml-2 text-xs">(não editável)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1">Nome Fantasia</Label>
                  <Input className="h-11" value={form.nome_fantasia || ''} onChange={(e) => updateField('nome_fantasia', e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1">CNAE</Label>
                  <Input className="h-11" value={form.cnae || ''} onChange={(e) => updateField('cnae', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="mb-1">CEP</Label>
                  <Input className="h-11" value={maskCEP(form.cep || '')} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); updateField('cep', v); if (v.length === 8) buscarCEP(v) }} placeholder="00000-000" />
                  {buscandoCep && <p className="text-primary text-xs mt-1">Buscando endereço...</p>}
                </div>
                <div className="md:col-span-2">
                  <Label className="mb-1">Logradouro</Label>
                  <Input className="h-11" value={form.logradouro || ''} onChange={(e) => updateField('logradouro', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div><Label className="mb-1">Número</Label><Input className="h-11" value={form.numero || ''} onChange={(e) => updateField('numero', e.target.value)} /></div>
                <div><Label className="mb-1">Complemento</Label><Input className="h-11" value={form.complemento || ''} onChange={(e) => updateField('complemento', e.target.value)} /></div>
                <div><Label className="mb-1">Bairro</Label><Input className="h-11" value={form.bairro || ''} onChange={(e) => updateField('bairro', e.target.value)} /></div>
                <div><Label className="mb-1">Cidade</Label><Input className="h-11" value={form.cidade || ''} onChange={(e) => updateField('cidade', e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><Label className="mb-1">Estado</Label><Input className="h-11" value={form.estado || ''} maxLength={2} onChange={(e) => updateField('estado', e.target.value.toUpperCase())} placeholder="UF" /></div>
                <div>
                  <Label className="mb-1">Telefone Comercial</Label>
                  <Input className={`h-11 ${inputClass('telefone_comercial')}`} value={maskPhone(form.telefone_comercial || '')} onChange={(e) => updateField('telefone_comercial', e.target.value.replace(/\D/g, ''))} placeholder="(00) 00000-0000" />
                  <ErrorMsg field="telefone_comercial" />
                </div>
                <div>
                  <Label className="mb-1">E-mail Comercial</Label>
                  <Input className={`h-11 ${inputClass('email_comercial')}`} type="email" value={form.email_comercial || ''} onChange={(e) => updateField('email_comercial', e.target.value)} />
                  <ErrorMsg field="email_comercial" />
                </div>
              </div>
            </div>
          )}

          {/* Etapa 2 — Representantes */}
          {etapa === 2 && (
            <div className="space-y-6">
              {(form.representantes || []).map((rep, idx) => (
                <Card key={idx} className="border border-border">
                  <CardHeader className="pb-3 pt-4 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        Representante {idx + 1}
                        {idx === 0 && <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">(principal)</span>}
                      </CardTitle>
                      {idx > 0 && (
                        <Button variant="ghost" size="icon" onClick={() => removeRepresentante(idx)} className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8">
                          <Trash2 size={16} />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-1">Nome Completo *</Label>
                        <Input className={`h-11 ${errors[`representantes.${idx}.nome`] ? 'border-destructive' : ''}`} value={rep.nome || ''} onChange={(e) => updateRepresentante(idx, 'nome', e.target.value)} />
                        {errors[`representantes.${idx}.nome`] && <p className="text-destructive text-sm mt-1">{errors[`representantes.${idx}.nome`][0]}</p>}
                      </div>
                      <div>
                        <Label className="mb-1">CPF *</Label>
                        <Input className={`h-11 ${errors[`representantes.${idx}.cpf`] ? 'border-destructive' : ''}`} value={maskCPF(rep.cpf || '')} onChange={(e) => updateRepresentante(idx, 'cpf', e.target.value.replace(/\D/g, ''))} placeholder="000.000.000-00" />
                        {errors[`representantes.${idx}.cpf`] && <p className="text-destructive text-sm mt-1">{errors[`representantes.${idx}.cpf`][0]}</p>}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-1">RG *</Label>
                        <Input className="h-11" value={rep.rg || ''} onChange={(e) => updateRepresentante(idx, 'rg', e.target.value)} />
                      </div>
                      <div>
                        <Label className="mb-1">Cargo *</Label>
                        <Input className="h-11" value={rep.cargo || ''} onChange={(e) => updateRepresentante(idx, 'cargo', e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-1">E-mail *</Label>
                        <Input type="email" className="h-11" value={rep.email || ''} onChange={(e) => updateRepresentante(idx, 'email', e.target.value)} />
                      </div>
                      <div>
                        <Label className="mb-1">Telefone *</Label>
                        <Input className="h-11" value={maskPhone(rep.telefone || '')} onChange={(e) => updateRepresentante(idx, 'telefone', e.target.value.replace(/\D/g, ''))} placeholder="(00) 00000-0000" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Button variant="outline" onClick={addRepresentante} className="w-full">
                <Plus size={16} className="mr-2" /> Adicionar Representante
              </Button>
            </div>
          )}

          {/* Etapa 3 — Dados bancários */}
          {etapa === 3 && (
            <div className="space-y-4">
              <div>
                <Label className="mb-1">Banco</Label>
                <select className={`h-11 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${errors['banco'] ? 'border-destructive' : 'border-input'}`} value={form.banco || ''} onChange={(e) => updateField('banco', e.target.value)}>
                  <option value="">Selecione o banco</option>
                  {bancosBrasileiros.map((b) => <option key={b.codigo} value={`${b.codigo} - ${b.nome}`}>{b.codigo} - {b.nome}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><Label className="mb-1">Agência</Label><Input className="h-11" value={form.agencia || ''} onChange={(e) => updateField('agencia', e.target.value.replace(/\D/g, ''))} placeholder="0000" /></div>
                <div><Label className="mb-1">Conta</Label><Input className="h-11" value={form.conta || ''} onChange={(e) => updateField('conta', e.target.value)} placeholder="00000-0" /></div>
                <div>
                  <Label className="mb-1">Tipo de Conta</Label>
                  <select className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" value={form.tipo_conta || ''} onChange={(e) => updateField('tipo_conta', e.target.value)}>
                    <option value="">Selecione</option>
                    <option value="corrente">Corrente</option>
                    <option value="poupanca">Poupança</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {message && (
            <div className={`mt-4 p-3 rounded-lg text-sm border ${message.includes('enviada') || message.includes('sucesso') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>{message}</div>
          )}

          <div className="flex justify-between mt-6 pt-4 border-t border-border">
            {etapa > 1 ? <Button variant="outline" onClick={() => setEtapa((e) => e - 1)}>Voltar</Button> : <div />}
            {etapa < 3 ? (
              <Button onClick={() => { if (validarEtapa()) setEtapa((e) => e + 1) }}>Próximo</Button>
            ) : (
              <Button onClick={submeter} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</> : 'Enviar Solicitação'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function CadastroCedentePage() {
  const [cedente, setCedente] = useState<CedenteCadastrado | null | 'loading'>('loading')
  const [solicitacao, setSolicitacao] = useState<SolicitacaoPendente | null>(null)
  const [modoEdicao, setModoEdicao] = useState(false)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setCedente(null); return }

      const { data } = await supabase
        .from('cedentes')
        .select('id, cnpj, razao_social, nome_fantasia, cnae, cep, logradouro, numero, complemento, bairro, cidade, estado, telefone_comercial, email_comercial, banco, agencia, conta, tipo_conta, status, created_at')
        .single()

      if (!data) { setCedente(null); return }

      const { data: reps } = await supabase
        .from('representantes')
        .select('id, nome, cpf, rg, cargo, email, telefone, principal')
        .eq('cedente_id', data.id)
        .order('principal', { ascending: false })

      // Buscar solicitação mais recente
      const { data: sol } = await supabase
        .from('solicitacoes_alteracao_cedente')
        .select('id, status, solicitado_em, motivo_reprovacao')
        .eq('cedente_id', data.id)
        .order('solicitado_em', { ascending: false })
        .limit(1)
        .single()

      setCedente({ ...(data as Omit<CedenteCadastrado, 'representantes'>), representantes: (reps || []) as RepresentanteCadastrado[] })
      if (sol) setSolicitacao(sol as SolicitacaoPendente)
    }
    load()
  }, [])

  if (cedente === 'loading') {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    )
  }

  if (cedente && modoEdicao) {
    return <AlteracaoForm cedente={cedente} onCancelar={() => setModoEdicao(false)} />
  }

  if (cedente) {
    return (
      <CedenteView
        cedente={cedente}
        solicitacao={solicitacao}
        onSolicitarAlteracao={() => setModoEdicao(true)}
      />
    )
  }

  return <CadastroForm />
}
