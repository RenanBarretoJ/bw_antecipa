import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse usa require() interno e acessa o filesystem — não pode ser bundlado pelo Webpack.
  // Com esta flag Next.js usa o require nativo do Node.js, eliminando o workaround do lazy require.
  serverExternalPackages: ['pdf-parse', 'jszip'],
  reactCompiler: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
    // Limite do corpo da requisição no proxy interno (middleware incluído).
    // Deve ser >= serverActions.bodySizeLimit para não cortar uploads de PDFs em lote.
    proxyClientMaxBodySize: '50mb',
  },
};

export default nextConfig;
