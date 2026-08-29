import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectProductionValues, sanitizeMetadata } from './vercel-production-check.mjs'

test('verificador valida somente propriedades nao sensiveis', () => {
  const result = inspectProductionValues({
    NEXT_PUBLIC_APP_ENV: 'production',
    INTEGRATION_RUNTIME_ENV: 'production',
    APP_BASE_URL: 'https://bw-antecipa.better-with.tech',
    FROMTIS_URL: 'https://integracao.example.com',
    FROMTIS_USERNAME: 'present',
    FROMTIS_PASSWORD: 'present',
    FROMTIS_TIPO_RECEBIVEL: '01',
    SMTP_HOST: 'smtp.ionos.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'present',
    SMTP_PASSWORD: 'present',
    EMAIL_FROM: 'BW Antecipa <noreply@example.com>',
  })

  assert.equal(result.APP_BASE_URL.exact, true)
  assert.equal(result.SINQIA_TERRA.urlHttps, true)
  assert.equal(result.SINQIA_TERRA.tipoValid, true)
  assert.equal(result.SMTP.ionos, true)
  assert.equal(result.SMTP.secureValid, true)
  assert.equal(JSON.stringify(result).includes('noreply@example.com'), false)
})

test('metadata remove valores e preserva somente estado operacional', () => {
  const result = sanitizeMetadata({ envs: [{
    key: 'SMTP_PASSWORD',
    value: 'nao-deve-vazar',
    type: 'sensitive',
    target: ['production'],
  }] })
  assert.deepEqual(result, [{
    key: 'SMTP_PASSWORD',
    type: 'sensitive',
    target: ['production'],
    present: true,
  }])
  assert.equal(JSON.stringify(result).includes('nao-deve-vazar'), false)
})
