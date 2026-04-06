import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
