// Adaptador legado mantido para compatibilidade de imports.
// A nomenclatura de produto e a implementacao atual ficam em src/lib/portal-fidc.
export {
  enviarRemessaPortalFidc as enviarRemessaFromtis,
  consultarStatusPortalFidc,
  testarConexaoPortalFidc,
} from '@/lib/portal-fidc/integracao'
