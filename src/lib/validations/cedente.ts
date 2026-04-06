import { z } from 'zod'

function validarCNPJ(cnpj: string): boolean {
  const nums = cnpj.replace(/\D/g, '')
  if (nums.length !== 14 || /^(\d)\1+$/.test(nums)) return false
  const calc = (slice: string, weights: number[]) =>
    weights.reduce((sum, w, i) => sum + Number(slice[i]) * w, 0)
  const d1Weights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const d2Weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const r1 = calc(nums, d1Weights) % 11
  const d1 = r1 < 2 ? 0 : 11 - r1
  if (Number(nums[12]) !== d1) return false
  const r2 = calc(nums, d2Weights) % 11
  const d2 = r2 < 2 ? 0 : 11 - r2
  return Number(nums[13]) === d2
}

function validarCPF(cpf: string): boolean {
  const nums = cpf.replace(/\D/g, '')
  if (nums.length !== 11 || /^(\d)\1+$/.test(nums)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(nums[i]) * (10 - i)
  let d1 = 11 - (sum % 11)
  if (d1 >= 10) d1 = 0
  if (Number(nums[9]) !== d1) return false
  sum = 0
  for (let i = 0; i < 10; i++) sum += Number(nums[i]) * (11 - i)
  let d2 = 11 - (sum % 11)
  if (d2 >= 10) d2 = 0
  return Number(nums[10]) === d2
}

// Etapa 1 — Dados da Empresa
export const etapa1Schema = z.object({
  cnpj: z.string()
    .min(14, { message: 'CNPJ e obrigatorio.' })
    .refine((v) => validarCNPJ(v), { message: 'CNPJ invalido.' })
    .transform((v) => v.replace(/\D/g, '')),
  razao_social: z.string().min(3, { message: 'Razao social e obrigatoria.' }),
  nome_fantasia: z.string().optional().default(''),
  cep: z.string().min(8, { message: 'CEP e obrigatorio.' }),
  logradouro: z.string().min(1, { message: 'Logradouro e obrigatorio.' }),
  numero: z.string().min(1, { message: 'Numero e obrigatorio.' }),
  complemento: z.string().optional().default(''),
  bairro: z.string().min(1, { message: 'Bairro e obrigatorio.' }),
  cidade: z.string().min(1, { message: 'Cidade e obrigatoria.' }),
  estado: z.string().min(2, { message: 'Estado e obrigatorio.' }),
  telefone_comercial: z.string().min(10, { message: 'Telefone comercial e obrigatorio.' }),
  email_comercial: z.string().email({ message: 'E-mail comercial invalido.' }),
  cnae: z.string().optional().default(''),
})

// Schema de um representante legal individual
export const representanteSchema = z.object({
  nome: z.string().min(3, { message: 'Nome do representante e obrigatorio.' }),
  cpf: z.string()
    .min(11, { message: 'CPF e obrigatorio.' })
    .refine((v) => validarCPF(v), { message: 'CPF invalido.' })
    .transform((v) => v.replace(/\D/g, '')),
  rg: z.string().min(1, { message: 'RG e obrigatorio.' }),
  cargo: z.string().min(1, { message: 'Cargo e obrigatorio.' }),
  email: z.string().email({ message: 'E-mail invalido.' }),
  telefone: z.string().min(10, { message: 'Telefone e obrigatorio.' }),
  principal: z.boolean().optional(),
})

export type RepresentanteData = z.infer<typeof representanteSchema>

// Etapa 2 — Representantes Legais
export const etapa2Schema = z.object({
  representantes: z.array(representanteSchema)
    .min(1, { message: 'Informe pelo menos um representante legal.' }),
})

// Etapa 3 — Dados Bancarios
export const etapa3Schema = z.object({
  banco: z.string().min(1, { message: 'Banco e obrigatorio.' }),
  agencia: z.string().min(1, { message: 'Agencia e obrigatoria.' }),
  conta: z.string().min(1, { message: 'Conta e obrigatoria.' }),
  tipo_conta: z.enum(['corrente', 'poupanca'], { message: 'Selecione o tipo de conta.' }),
})

// Schema completo
export const cedenteSchema = etapa1Schema
  .merge(etapa3Schema)
  .extend({ representantes: z.array(representanteSchema).min(1, { message: 'Informe pelo menos um representante legal.' }) })

export type CedenteFormData = z.infer<typeof cedenteSchema>
export type Etapa1Data = z.infer<typeof etapa1Schema>
export type Etapa2Data = z.infer<typeof etapa2Schema>
export type Etapa3Data = z.infer<typeof etapa3Schema>

// Lista de bancos brasileiros
export const bancosBrasileiros = [
  { codigo: '001', nome: 'Banco do Brasil' },
  { codigo: '033', nome: 'Santander' },
  { codigo: '104', nome: 'Caixa Economica Federal' },
  { codigo: '237', nome: 'Bradesco' },
  { codigo: '341', nome: 'Itau Unibanco' },
  { codigo: '077', nome: 'Banco Inter' },
  { codigo: '260', nome: 'Nu Pagamentos (Nubank)' },
  { codigo: '336', nome: 'C6 Bank' },
  { codigo: '212', nome: 'Banco Original' },
  { codigo: '756', nome: 'Sicoob' },
  { codigo: '748', nome: 'Sicredi' },
  { codigo: '422', nome: 'Safra' },
  { codigo: '070', nome: 'BRB' },
  { codigo: '655', nome: 'Votorantim' },
  { codigo: '745', nome: 'Citibank' },
  { codigo: '399', nome: 'HSBC' },
  { codigo: '389', nome: 'Mercantil do Brasil' },
  { codigo: '634', nome: 'Triangulo' },
  { codigo: '041', nome: 'Banrisul' },
  { codigo: '208', nome: 'BTG Pactual' },
]
