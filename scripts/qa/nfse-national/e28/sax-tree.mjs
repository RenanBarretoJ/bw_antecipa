import { parseWithSax as parseE27 } from '../e27/sax-tree.mjs'
import { validateInput } from '../e27/xml-guards.mjs'
import { validateReferences } from './references.mjs'

/** E2.8 wrapper; original source is passed unchanged to the frozen E2.7 bridge.
 * The repeated input-policy scan is deliberate; measure its overhead rather than
 * changing earlier evidence or bypassing safeguards. No operational imports here.
 * @param {string} xml @param {import('../e27/xml-guards.mjs').Policy} policy
 */
export function parseWithSax(xml, policy) {
  validateInput(xml, policy)
  validateReferences(xml, policy)
  return parseE27(xml, policy)
}
