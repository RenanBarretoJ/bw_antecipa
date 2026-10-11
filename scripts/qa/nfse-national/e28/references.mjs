import { isXml10Character } from '../e27/xml-guards.mjs'

const predefined = new Set(['amp', 'lt', 'gt', 'apos', 'quot'])

/** Validate a source reference, not decoded text. Bounded names; numeric digits
 * accumulate without parseInt, repair, huge substrings or recursive expansion.
 * XML 1.0 productions [66], [68], [69], [2].
 * @param {string} xml @param {number} start
 * @param {import('../e27/xml-guards.mjs').Policy} policy
 * @returns {number} Index immediately after the semicolon.
 */
function referenceEnd(xml, start, { ErrorClass }) {
  let index = start + 1
  if (xml[index] !== '#') {
    let end = index
    while (end < xml.length && end - index <= 4 && xml[end] !== ';') end++
    // Only five names, maximum four characters. Never slice an unbounded name.
    if (xml[end] !== ';' || end - index > 4 || !predefined.has(xml.slice(index, end))) {
      throw new ErrorClass('XML_MALFORMED')
    }
    return end + 1
  }
  index++
  const hex = xml[index] === 'x'
  if (hex) index++
  const begin = index
  let point = 0
  while (index < xml.length && xml[index] !== ';') {
    const code = xml.charCodeAt(index++)
    const digit = code >= 48 && code <= 57 ? code - 48
      : hex && code >= 65 && code <= 70 ? code - 55
      : hex && code >= 97 && code <= 102 ? code - 87 : -1
    if (digit < 0 || digit >= (hex ? 16 : 10)) throw new ErrorClass('XML_MALFORMED')
    point = point * (hex ? 16 : 10) + digit
    if (point > 0x10ffff) throw new ErrorClass('XML_MALFORMED')
  }
  if (index === begin || xml[index] !== ';' || !isXml10Character(point)) {
    throw new ErrorClass('XML_MALFORMED')
  }
  return index + 1
}

/** Context-aware source preflight. Comments, CDATA and PIs contain literal
 * ampersands, not references. In markup only quoted attribute values are scanned;
 * other malformed markup is rejected by SAX. No input mutation or external I/O.
 * Caller enforces the existing size/DTD/character policy before this scan.
 * @param {string} xml @param {import('../e27/xml-guards.mjs').Policy} policy
 */
export function validateReferences(xml, policy) {
  let markup = false
  let quote = ''
  for (let index = 0; index < xml.length;) {
    const character = xml[index]
    if (!markup && character === '<') {
      const terminator = xml.startsWith('<!--', index) ? '-->'
        : xml.startsWith('<![CDATA[', index) ? ']]>' : xml.startsWith('<?', index) ? '?>' : null
      if (terminator) {
        const offset = terminator === '-->' ? 4 : terminator === ']]>' ? 9 : 2
        const end = xml.indexOf(terminator, index + offset)
        if (end < 0) throw new policy.ErrorClass('XML_MALFORMED')
        index = end + terminator.length
        continue
      }
      markup = true
    } else if (markup && quote && character === '<') {
      // AttrValue [10] forbids literal '<'; it cannot start an ignored context.
      throw new policy.ErrorClass('XML_MALFORMED')
    } else if (markup && !quote && (character === '"' || character === "'")) {
      quote = character
    } else if (markup && quote && character === quote) {
      quote = ''
    } else if (markup && !quote && character === '>') {
      markup = false
    } else if (character === '&' && (!markup || quote)) {
      index = referenceEnd(xml, index, policy)
      continue
    }
    index++
  }
  if (markup || quote) throw new policy.ErrorClass('XML_MALFORMED')
}
