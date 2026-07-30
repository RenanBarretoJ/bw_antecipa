export interface SelectorOption {
  value: string
  label: string
  description?: string
}

export function preservarOpcaoSelecionada(
  options: SelectorOption[],
  selected: SelectorOption | null,
): SelectorOption[] {
  if (!selected || options.some((option) => option.value === selected.value)) return options
  return [selected, ...options].slice(0, 20)
}
