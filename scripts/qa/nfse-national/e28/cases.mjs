import { securityCases } from '../e27/cases.mjs'

/** @typedef {{id: string, family: string, xml: string, accepted: boolean, code?: string, text?: string, attribute?: string}} Vector */
/** Fixed normative expectations, independent of either parser.
 * @returns {Vector[]}
 */
export function referenceCases() {
  /** @type {Vector[]} */
  const rows = []
  /** @param {string} id @param {string} reference @param {boolean} accepted @param {string} [decoded] */
  function both(id, reference, accepted, decoded) {
    rows.push({ id: `e28-${id}-text`, family: 'reference-text', xml: `<a>${reference}</a>`, accepted,
      ...(accepted && decoded !== undefined ? { text: decoded } : {}) })
    for (const quote of ['"', "'"]) rows.push({ id: `e28-${id}-attr-${quote === '"' ? 'double' : 'single'}`,
      family: 'reference-attribute', xml: `<a x=${quote}${reference}${quote}/>`, accepted,
      ...(accepted && decoded !== undefined ? { attribute: decoded } : {}) })
  }
  for (const [name, decoded] of Object.entries({ amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' })) {
    both(name, `&${name};`, true, decoded)
    for (let mask = 1; mask < 2 ** name.length; mask++) {
      const variation = [...name].map((c, i) => mask & 2 ** i ? c.toUpperCase() : c).join('')
      both(`case-${variation}`, `&${variation};`, false)
    }
  }
  const valid = [9, 10, 13, 32, 38, 60, 65, 0xd7ff, 0xe000, 0xfffd, 0x10000, 0x10ffff]
  for (const point of valid) {
    const decoded = String.fromCodePoint(point)
    both(`decimal-${point}`, `&#${point};`, true, decoded)
    both(`hex-${point}`, `&#x${point.toString(16)};`, true, decoded)
    both(`hex-upper-digit-${point}`, `&#x${point.toString(16).toUpperCase()};`, true, decoded)
  }
  both('leading-zeros-decimal', '&#000065;', true, 'A')
  both('leading-zeros-hex', '&#x000041;', true, 'A')
  both('single-expansion', '&amp;AMP;&amp;unknown;&amp;#0;', true, '&AMP;&unknown;&#0;')
  both('combined', '&amp;&lt;&gt;&apos;&quot;&#65;&#x42;', true, '&<>\'"AB')
  for (const point of [0, 1, 8, 11, 12, 14, 31, 0xd800, 0xdfff, 0xfffe, 0xffff, 0x110000]) {
    both(`forbidden-decimal-${point}`, `&#${point};`, false)
    both(`forbidden-hex-${point}`, `&#x${point.toString(16)};`, false)
  }
  for (const [id, token] of Object.entries({ unknown: '&unknown;', html: '&nbsp;', unicode: '&á;',
    missing: '&amp', naked: '&', doubled: '&&amp;', empty: '&;', numberEmpty: '&#;', hexEmpty: '&#x;',
    uppercaseX: '&#X41;', sign: '&#+65;', negative: '&#-1;', decimalHex: '&#0x41;',
    decimalSuffix: '&#65a;', hexSuffix: '&#x41g;', space: '&# 65;', decimalPoint: '&#65.0;',
    missingNumericEnd: '&#65', missingHexEnd: '&#x41', nested: '&amp&amp;',
    overflow: '&#999999999999999999999999999999999999999;',
    overflowHex: '&#xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;' })) both(id, token, false)
  const literal = '&AMP; &unknown; &#0; &amp &#X41; &'
  for (const [id, xml, text] of [
    ['comment', `<a><!--${literal}--></a>`, ''],
    ['cdata', `<a><![CDATA[${literal}]]></a>`, literal],
    ['pi', `<a><?test ${literal}?></a>`, ''],
    ['mixed-literal', `<a><!--&AMP;--><![CDATA[&unknown;]]><?test &#0;?>&amp;</a>`, '&unknown;&'],
  ]) rows.push({ id: `e28-${id}`, family: 'literal-context', xml, accepted: true, text })
  for (const [id, xml] of Object.entries({
    'after-comment': '<a><!--&AMP;-->&AMP;</a>', 'after-cdata': '<a><![CDATA[&AMP;]]>&unknown;</a>',
    'after-pi': '<a><?test &AMP;?>&#X41;</a>', 'comment-in-attr': '<a x="<!--&AMP;-->"/>',
    'cdata-in-attr': '<a x="<![CDATA[&AMP;]]>"/>', 'pi-in-attr': '<a x="<?test &AMP;?>"/>',
    'literal-lt-valid-ref': '<a x="<!--&amp;-->"/>', 'literal-lt-no-ref': '<a x="<"/>',
    'unclosed-comment': '<a><!--&AMP;</a>', 'unclosed-cdata': '<a><![CDATA[&AMP;</a>',
    'unclosed-pi': '<a><?test &AMP;</a>', 'unclosed-quote': '<a x="&amp;/>',
    'unclosed-text': '<a>&amp;', 'wrong-end-tag': '<a>&amp;</b>',
    'dtd-internal': '<!DOCTYPE a [<!ENTITY known "ok">]><a>&known;</a>',
    'dtd-external': '<!DOCTYPE a SYSTEM "https://example.invalid/no-request"><a/>',
    'xxe': '<!DOCTYPE a [<!ENTITY leak SYSTEM "file:///no-access">]><a>&leak;</a>',
    'entity-declaration': '<!ENTITY leak SYSTEM "file:///no-access"><a/>',
    'namespace-ref': '<a xmlns="&AMP;"/>',
    'quote-escape': '<a x="&quot;&AMP;"/>',
  })) rows.push({ id: `e28-${id}`, family: 'malformed-or-forbidden', xml, accepted: false })
  return rows
}

/** @param {typeof import('../../../../src/lib/nfse/xml-nacional/xml-tree').XML_LIMITS} limits */
export function allCases(limits) { return [...securityCases(limits), ...referenceCases()] }
