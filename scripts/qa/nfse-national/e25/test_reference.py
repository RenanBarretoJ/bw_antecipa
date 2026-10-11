"""Meaningful negative controls for the independent evidence calculation."""
import unittest
from unittest.mock import patch
from lxml import etree
from certify import convert, field_metrics, independent_reference, valid_tax_id


class IndependentReferenceTests(unittest.TestCase):
    def test_zero_is_explicit_and_negative_or_locale_decimal_is_rejected(self):
        self.assertEqual(convert('0', 'money'), '0.00')
        self.assertEqual(convert('0.00', 'money'), '0.00')
        for value in ['', '-1.00', '1,00', '00.00', '1.001']:
            with self.assertRaises(ValueError):
                convert(value, 'money')

    def test_check_digits_are_not_just_lengths(self):
        self.assertTrue(valid_tax_id('12345678000195', 'cnpj'))
        self.assertTrue(valid_tax_id('12345678909', 'cpf'))
        for value, kind in [('12345678000194', 'cnpj'), ('12345678908', 'cpf'),
                            ('00000000000000', 'cnpj'), ('11111111111', 'cpf')]:
            self.assertFalse(valid_tax_id(value, kind))

    def test_temporal_reference_requires_valid_date_and_offset(self):
        self.assertEqual(convert('2026-10-09T09:00:00-03:00', 'timestamp'), '2026-10-09T09:00:00-03:00')
        for value, kind in [('2026-02-30', 'date'), ('2026-10-09T09:00:00', 'timestamp')]:
            with self.assertRaises(ValueError):
                convert(value, kind)

    def test_incorrect_value_counts_as_both_fp_and_fn_without_absence_padding(self):
        rows = [
            {'matched': True, 'expected_state': 'PRESENTE', 'actual_state': 'PRESENTE', 'trace_preserved': True},
            {'matched': False, 'expected_state': 'PRESENTE', 'actual_state': 'PRESENTE', 'trace_preserved': True},
            {'matched': False, 'expected_state': 'PRESENTE', 'actual_state': 'AUSENTE', 'trace_preserved': False},
            {'matched': True, 'expected_state': 'AUSENTE', 'actual_state': 'AUSENTE', 'trace_preserved': True},
            {'matched': True, 'expected_state': 'INVALIDO', 'actual_state': 'INVALIDO', 'trace_preserved': True},
        ]
        actual = field_metrics(rows)
        self.assertEqual((actual['tp'], actual['fp'], actual['fn']), (1, 1, 2))
        self.assertEqual(actual['exact_value_precision'], 0.5)
        self.assertEqual(actual['exact_value_recall'], 1/3)

    def test_empty_corpus_has_no_accuracy_claim(self):
        actual = field_metrics([])
        self.assertIsNone(actual['exact_value_precision'])
        self.assertIsNone(actual['exact_value_recall'])

    def test_normative_provider_reference_does_not_fallback_to_emitter(self):
        xml = etree.fromstring(b'''<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
          <infNFSe><emit><xNome>EMITTER</xNome></emit><DPS><infDPS>
            <prest><xNome>PROVIDER</xNome></prest></infDPS></DPS></infNFSe></NFSe>''')
        with patch('certify.safe_xml', return_value=xml):
            actual = independent_reference('unused')
        self.assertEqual(actual['prestador.razao_social']['valor'], 'PROVIDER')
        self.assertIn('/n:DPS/n:infDPS/n:prest/', actual['prestador.razao_social']['xpath'])

    def test_documentary_issuance_reference_is_not_the_dps_timestamp(self):
        xml = etree.fromstring(b'''<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
          <infNFSe><dhProc>2026-10-09T09:05:00-03:00</dhProc><DPS><infDPS>
          <dhEmi>2026-10-09T09:00:00-03:00</dhEmi></infDPS></DPS></infNFSe></NFSe>''')
        with patch('certify.safe_xml', return_value=xml):
            actual = independent_reference('unused')
        self.assertEqual(actual['identificacao.emissao']['valor'], '2026-10-09T09:05:00-03:00')
        self.assertNotEqual(actual['identificacao.emissao']['valor'], actual['identificacao.dps.emissao']['valor'])


if __name__ == '__main__':
    unittest.main()
