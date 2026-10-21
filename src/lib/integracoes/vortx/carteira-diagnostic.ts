import { z } from 'zod'
import { branchPreviewVortxPermitida } from './preview-branch'

export const carteiraDiagnosticSchema = z.object({
  fundoId: z.uuid(),
  dataCarteira: z.iso.date(),
  mfaCode: z.string().regex(/^\d{6}$/),
}).strict()

export type CarteiraDiagnosticResponse = {
  statusHttp: number
  endpoint: string
  dataCarteira: string
  consultadoEm: string
  resposta: string
  respostaRedigida: boolean
}

export type CarteiraDiagnosticResult =
  | { success: true; data: CarteiraDiagnosticResponse }
  | { success: false; message: string }

// Excecao temporaria autorizada: nunca habilitar o diagnostico em outro banco/branch.
export function diagnosticoCarteiraPermitido(fundoId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.VERCEL_ENV === 'preview'
    && branchPreviewVortxPermitida(env.VERCEL_GIT_COMMIT_REF)
    && env.NEXT_PUBLIC_SUPABASE_URL === 'https://phdckowbexkkvuwnzeaf.supabase.co'
    && env.VORTX_CARTEIRA_DIAGNOSTIC_ENABLED === 'true'
    && Boolean(env.VORTX_CARTEIRA_DIAGNOSTIC_FUNDO_ID)
    && fundoId === env.VORTX_CARTEIRA_DIAGNOSTIC_FUNDO_ID
}

export function hojeCarteira(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
