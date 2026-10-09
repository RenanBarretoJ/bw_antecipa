type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined }

export type EmailOperatorFunctions = {
  email_operator_dashboard: { Args: { p_fundo: string; p_id?: string }; Returns: Json }
  email_operator_cedentes: { Args: { p_fundo: string; p_search?: string; p_page?: number }; Returns: Json }
  email_operator_inbox: { Args: { p_fundo: string; p_filter?: Json }; Returns: Json }
  email_operator_message: { Args: { p_fundo: string; p_message: string; p_page?: number }; Returns: Json }
  email_operator_save: { Args: { p_fundo: string; p_id: string | null; p_revision: number | null; p_config: Json }; Returns: string }
  email_operator_create_credential: { Args: { p_fundo: string; p_name: string; p_environment: string; p_identity_cipher: string; p_secret_cipher: string; p_key_version: string; p_request: string }; Returns: string }
  email_operator_begin_test: { Args: { p_id: string; p_revision: number }; Returns: string }
  email_operator_complete_test: { Args: { p_id: string; p_token: string; p_tenant: string | null; p_error: string | null }; Returns: undefined }
  email_operator_set_enabled: { Args: { p_id: string; p_revision: number; p_enabled: boolean; p_scope_confirmed: boolean }; Returns: undefined }
  email_credential_material: { Args: { p_id: string }; Returns: Json }
  email_operator_begin_metadata: { Args: { p_fundo: string; p_ids: string[] }; Returns: string }
  email_operator_metadata_source: { Args: { p_fundo: string; p_token: string }; Returns: Json }
  email_operator_complete_metadata: { Args: { p_token: string; p_rows: Json }; Returns: number }
}
