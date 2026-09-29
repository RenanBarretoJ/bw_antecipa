// SQL is data: never use it as a String.replace replacement string.
export const normalizeSql = value => value.replace(/\r\n/g, '\n')
export function sqlLiteral(value) {
  let tag = '$guibor_history$'
  while (value.includes(tag)) tag = tag.slice(0, -1) + '_$'
  return `${tag}${value}${tag}`
}
export function replaceSql(template, pattern, sql) {
  return template.replace(pattern, () => sql)
}
