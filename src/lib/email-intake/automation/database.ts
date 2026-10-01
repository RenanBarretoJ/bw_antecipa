type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined }

/** RPC contract for the incremental 04 schema; private tables stay off the browser API. */
export type EmailAutomationFunctions = {
  email_automation_webhook_limit: { Args: { p_key_hash: string }; Returns: boolean }
  email_automation_webhook_bindings: { Args: { p_subscription_ids: string[] }; Returns: Json }
  email_automation_signal: { Args: { p_signals: Json }; Returns: undefined }
  email_automation_claim: { Args: { p_kind: string }; Returns: Json }
  email_automation_commit_page: { Args: {
    p_id: string; p_token: string; p_kind: string; p_discovery_token: string; p_revision: number
    p_messages: Json; p_cursor_ciphertext: string | null; p_cursor_key_version: string | null; p_complete: boolean
  }; Returns: number }
  email_automation_fail: { Args: {
    p_id: string; p_token: string; p_code: string; p_retry_ms: number; p_retryable: boolean; p_reset_cursor?: boolean
  }; Returns: undefined }
  email_automation_prepare_subscription: { Args: { p_id: string; p_token: string; p_ciphertext: string; p_key_version: string }; Returns: undefined }
  email_automation_complete_subscription: { Args: { p_id: string; p_token: string; p_subscription_id: string; p_expires_at: string }; Returns: undefined }
  email_automation_health_snapshots: { Args: Record<string, never>; Returns: Json }
  email_automation_apply_health: { Args: { p_id: string; p_status: string; p_alerts: string[] }; Returns: undefined }
  email_automation_operator_health: { Args: { p_fundo_id: string }; Returns: Json }
  email_automation_manual_sync: { Args: { p_id: string }; Returns: boolean }
}
