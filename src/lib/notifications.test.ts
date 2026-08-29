import { describe, expect, it } from 'vitest'

import { getNotificationDuration, notificationFromActionResult, shouldMergeNotifications } from './notifications'

describe('notifications', () => {
  it('converte resultado de action bem-sucedida em toast success', () => {
    expect(notificationFromActionResult({ success: true, message: 'Operação criada.' })).toMatchObject({
      type: 'success',
      message: 'Operação criada.',
      dedupeKey: 'success:Operação criada.',
    })
  })

  it('converte resultado de action com falha em toast error', () => {
    expect(notificationFromActionResult({ success: false, message: 'Erro ao criar operação.' })).toMatchObject({
      type: 'error',
      message: 'Erro ao criar operação.',
    })
  })

  it('respeita notificacao explicita da action', () => {
    expect(notificationFromActionResult({
      success: false,
      message: 'Erro tecnico bruto',
      notification: {
        type: 'warning',
        title: 'Atenção',
        message: 'Revise os dados informados.',
        details: 'Detalhe opcional.',
      },
    })).toMatchObject({
      type: 'warning',
      title: 'Atenção',
      message: 'Revise os dados informados.',
      details: 'Detalhe opcional.',
    })
  })

  it('usa duracoes padrao por tipo', () => {
    expect(getNotificationDuration('success')).toBe(3000)
    expect(getNotificationDuration('info')).toBe(4000)
    expect(getNotificationDuration('warning')).toBe(6000)
    expect(getNotificationDuration('error')).toBe(10000)
  })

  it('identifica mensagens semelhantes para agrupamento', () => {
    expect(shouldMergeNotifications({ type: 'error', message: 'Falhou.' }, { type: 'error', message: 'Falhou.' })).toBe(true)
    expect(shouldMergeNotifications({ type: 'error', message: 'Falhou.' }, { type: 'success', message: 'Falhou.' })).toBe(false)
  })
})
