export function shouldOfferTemplateConfiguration({
  hasTemplate,
  hasVersion,
}: {
  hasTemplate: boolean
  hasVersion: boolean
}) {
  return !hasTemplate || !hasVersion
}
