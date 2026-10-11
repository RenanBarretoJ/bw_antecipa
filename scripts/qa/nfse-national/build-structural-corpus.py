"""Synthetic fixtures only. No real fiscal documents, network, credentials or persistence.

Expected facts below are authored independently of the TypeScript adapter.
Rebuilding fixtures does not make them evidence of official fiscal compatibility.
"""
import hashlib
import json
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'tests/fixtures/nfse/nacional'
NS = 'http://www.sped.fazenda.gov.br/nfse'
DS = 'http://www.w3.org/2000/09/xmldsig#'
ET.register_namespace('', NS)
ET.register_namespace('ds', DS)
CNPJ = '12345678000195'
CPF = '12345678909'
KEY = '3550308' + '2' + '2' + CNPJ + '0000000900001' + '2610' + '000000001' + '0'
DPS_ID = 'DPS' + '3550308' + '2' + CNPJ + '00001' + '000000000900001'


def signature(uri):
    # Shape only; deliberately not signed. Never use in authenticated fiscal proof.
    return f'''<ds:Signature xmlns:ds="{DS}"><ds:SignedInfo>
    <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
    <ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>
    <ds:Reference URI="#{uri}"><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><ds:Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>
    <ds:DigestValue>AAAAAAAAAAAAAAAAAAAAAAAAAAA=</ds:DigestValue></ds:Reference>
    </ds:SignedInfo><ds:SignatureValue>AQ==</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>AQ==</ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature>'''


def dps(version):
    return f'''<DPS xmlns="{NS}" versao="{version}"><infDPS Id="{DPS_ID}">
    <tpAmb>2</tpAmb><dhEmi>2026-10-09T09:00:00-03:00</dhEmi><verAplic>QA_E1E2</verAplic>
    <serie>00001</serie><nDPS>900001</nDPS><dCompet>2026-10-09</dCompet><tpEmit>1</tpEmit><cLocEmi>3550308</cLocEmi>
    <prest><CNPJ>{CNPJ}</CNPJ><xNome>PRESTADOR FICTICIO E1 E2</xNome>
    <regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest>
    <toma><CNPJ>{CNPJ}</CNPJ><xNome>TOMADOR FICTICIO E1 E2</xNome>
    <end><endNac><cMun>3550308</cMun><CEP>01001000</CEP></endNac><xLgr>RUA FICTICIA</xLgr><nro>10</nro><xBairro>CENTRO</xBairro></end>
    <fone>11999999999</fone><email>qa@example.invalid</email></toma>
    <serv><locPrest><cLocPrestacao>3550308</cLocPrestacao></locPrest>
    <cServ><cTribNac>010101</cTribNac><xDescServ>SERVICO FICTICIO &amp; TESTE</xDescServ></cServ></serv>
    <valores><vServPrest><vServ>1000.00</vServ></vServPrest>
    <vDescCondIncond><vDescIncond>0.00</vDescIncond><vDescCond>0.00</vDescCond></vDescCondIncond>
    <trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>
    <totTrib><indTotTrib>0</indTotTrib></totTrib></trib></valores>
    </infDPS></DPS>'''


def nfse(version):
    return ET.fromstring(f'''<NFSe xmlns="{NS}" versao="{version}"><infNFSe Id="NFS{KEY}">
    <xLocEmi>SAO PAULO</xLocEmi><xLocPrestacao>SAO PAULO</xLocPrestacao><nNFSe>900001</nNFSe>
    <xTribNac>SERVICOS FICTICIOS</xTribNac><verAplic>QA_E1E2</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis>
    <cStat>100</cStat><dhProc>2026-10-09T09:05:00-03:00</dhProc><nDFSe>1</nDFSe>
    <emit><CNPJ>{CNPJ}</CNPJ><xNome>PRESTADOR FICTICIO E1 E2</xNome>
    <enderNac><xLgr>RUA FICTICIA</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>3550308</cMun><UF>SP</UF><CEP>01001000</CEP></enderNac></emit>
    <valores><vBC>1000.00</vBC><pAliqAplic>2.00</pAliqAplic><vISSQN>20.00</vISSQN><vTotalRet>0.00</vTotalRet><vLiq>1000.00</vLiq></valores>
    {dps(version)}</infNFSe>{signature('NFS'+KEY)}</NFSe>''')


def find(root, path):
    return root.find('/'.join('{' + NS + '}' + part for part in path.split('/')))


def set_text(root, path, text):
    node = find(root, path)
    if node is None:
        raise ValueError(path)
    node.text = text


def present(value):
    return {'estado': 'PRESENTE', 'valor': value}


def absent():
    return {'estado': 'AUSENTE', 'valor': None}


BASE = {
    'identificacao.numero_nfse': present('900001'), 'identificacao.chave_acesso': present(KEY),
    'identificacao.processamento': present('2026-10-09T09:05:00-03:00'), 'identificacao.emissao': absent(),
    'identificacao.competencia': present('2026-10-09'), 'identificacao.codigo_status_geracao': present('100'),
    'identificacao.situacao': {'estado': 'DERIVADO', 'valor': 'DESCONHECIDA'},
    'identificacao.dps.id': present(DPS_ID), 'identificacao.dps.serie': present('00001'),
    'identificacao.dps.numero': present('900001'), 'identificacao.dps.emissao': present('2026-10-09T09:00:00-03:00'),
    'prestador.cnpj': present(CNPJ), 'prestador.cpf': absent(), 'prestador.razao_social': present('PRESTADOR FICTICIO E1 E2'),
    'prestador.endereco.uf': present('SP'), 'prestador.endereco.cep': present('01001000'),
    'tomador.cnpj': present(CNPJ), 'tomador.email': present('qa@example.invalid'),
    'tomador.endereco.codigo_municipio': present('3550308'), 'tomador.endereco.uf': absent(),
    'servicos.0.descricao': present('SERVICO FICTICIO & TESTE'), 'servicos.0.codigo_tributacao_nacional': present('010101'),
    'totais.valor_servicos': present('1000.00'), 'totais.valor_operacao': absent(),
    'totais.desconto_condicionado': present('0.00'), 'totais.desconto_incondicionado': present('0.00'),
    'totais.liquido_documental': present('1000.00'), 'totais.liquido_derivado': {'estado': 'DERIVADO', 'valor': '1000.00'},
    'totais.total_retencoes': present('0.00'), 'totais.iss_retido': present(False),
    'totais.valor_pis': absent(), 'vencimento': absent(),
}
entries = []


def save(name, root, version, nature='NFSE', expected=None, xsd=True, alerts=None):
    OUT.mkdir(parents=True, exist_ok=True)
    data = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    (OUT / f'{name}.xml').write_bytes(data)
    fields = dict(BASE) if nature == 'NFSE' else {'identificacao.situacao': {'estado': 'DERIVADO', 'valor': 'DESCONHECIDA'}, 'vencimento': absent()}
    fields.update(expected or {})
    expectation = {'resultado': 'RECONHECIDO', 'natureza_documento': nature, 'campos': fields, 'alertas': alerts or []}
    (OUT / f'{name}.expected.json').write_text(json.dumps(expectation, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    entries.append({'id': name, 'arquivo': f'{name}.xml', 'esperado': f'{name}.expected.json',
                    'origem': 'SINTETICO_ESTRUTURAL', 'evidencia_compatibilidade_oficial': False,
                    'sha256': hashlib.sha256(data).hexdigest(), 'versao': version,
                    'xsd_esperado': xsd and not (version == '1.01' and nature in ['NFSE', 'DPS']),
                    'limitacao_xsd': 'TSSerieDPS usa ancoras literais ^ e $ em regex XSD; serie 00001 rejeitada pelo schema oficial intacto.' if version == '1.01' and nature in ['NFSE', 'DPS'] else None,
                    'raiz_xsd': root.tag.split('}')[-1],
                    'xsd_erros_esperados': ([{'campo':'serie','tipo':'SCHEMAV_CVC_PATTERN_VALID'}] if version == '1.01' and nature in ['NFSE','DPS'] else []) +
                        ([{'campo':'vLiq','tipo':'SCHEMAV_CVC_PATTERN_VALID'}] if not xsd else []),
                    'baseline_esperado': {'resultado': 'ERRO', 'codigo': 'MISSING_IDENTITY'}})


for version in ['1.00', '1.01']:
    save('nfse-'+version.replace('.', '-'), nfse(version), version)
root = nfse('1.01')
for path in ['infNFSe/emit/CNPJ', 'infNFSe/DPS/infDPS/prest/CNPJ', 'infNFSe/DPS/infDPS/toma/CNPJ']:
    node = find(root, path); node.tag = '{'+NS+'}CPF'; node.text = CPF
cpf_key = '3550308'+'2'+'1'+CPF.zfill(14)+'0000000900001'+'2610'+'000000001'+'0'
find(root,'infNFSe').set('Id','NFS'+cpf_key)
cpf_dps_id = 'DPS'+'3550308'+'1'+CPF.zfill(14)+'00001'+'000000000900001'
find(root,'infNFSe/DPS/infDPS').set('Id',cpf_dps_id)
set_text(root, 'infNFSe/valores/vLiq', '0.00')
set_text(root, 'infNFSe/DPS/infDPS/valores/vServPrest/vServ', '0.00')
save('cpf-liquido-zero', root, '1.01', expected={'prestador.cnpj': absent(), 'prestador.cpf': present(CPF),
     'identificacao.chave_acesso':present(cpf_key),'identificacao.dps.id':present(cpf_dps_id),
     'tomador.cnpj': absent(), 'totais.valor_servicos': present('0.00'), 'totais.liquido_documental': present('0.00'),
     'totais.liquido_derivado': {'estado': 'DERIVADO', 'valor': '0.00'}})
root = nfse('1.01')
info = find(root, 'infNFSe/DPS/infDPS'); info.remove(find(root, 'infNFSe/DPS/infDPS/toma'))
save('tomador-ausente', root, '1.01', expected={key: absent() for key in BASE if key.startswith('tomador.')})
root = nfse('1.01')
values = find(root, 'infNFSe/DPS/infDPS/valores'); values.remove(find(root, 'infNFSe/DPS/infDPS/valores/vDescCondIncond'))
find(root, 'infNFSe/valores').remove(find(root, 'infNFSe/valores/vTotalRet'))
save('opcionais-ausentes', root, '1.01', expected={key: absent() for key in ['totais.desconto_condicionado','totais.desconto_incondicionado','totais.total_retencoes','totais.liquido_derivado']})
root = nfse('1.01')
for path, value in {'infNFSe/DPS/infDPS/valores/vDescCondIncond/vDescCond':'10.00',
     'infNFSe/DPS/infDPS/valores/vDescCondIncond/vDescIncond':'20.00', 'infNFSe/valores/vTotalRet':'50.00',
     'infNFSe/valores/vLiq':'920.00','infNFSe/DPS/infDPS/valores/trib/tribMun/tpRetISSQN':'2'}.items(): set_text(root,path,value)
trib = find(root,'infNFSe/DPS/infDPS/valores/trib')
trib.insert(1, ET.fromstring(f'<tribFed xmlns="{NS}"><piscofins><CST>01</CST><vBCPisCofins>1000.00</vBCPisCofins><pAliqPis>1.65</pAliqPis><pAliqCofins>7.60</pAliqCofins><vPis>16.50</vPis><vCofins>76.00</vCofins><tpRetPisCofins>2</tpRetPisCofins></piscofins><vRetCP>10.00</vRetCP><vRetIRRF>15.00</vRetIRRF><vRetCSLL>5.00</vRetCSLL></tribFed>'))
save('descontos-retencoes',root,'1.01',expected={
    'totais.desconto_condicionado':present('10.00'),'totais.desconto_incondicionado':present('20.00'),
    'totais.total_retencoes':present('50.00'),'totais.liquido_documental':present('920.00'),
    'totais.liquido_derivado':{'estado':'DERIVADO','valor':'920.00'},'totais.iss_retido':present(True),
    'totais.valor_pis':present('16.50'),'totais.valor_cofins':present('76.00'),'totais.pis_retido':present(False),
    'totais.csll_retido':absent(),'totais.retencao_irrf':present('15.00'),'totais.retencao_previdenciaria':present('10.00')})
root = nfse('1.01')
set_text(root,'infNFSe/valores/vLiq','999.00')
save('divergencia-liquido',root,'1.01',expected={'totais.liquido_documental':present('999.00')},alerts=['LIQUIDO_DOCUMENTAL_DIVERGE_DA_FORMULA'])
root = nfse('1.01')
toma = find(root,'infNFSe/DPS/infDPS/toma')
toma.remove(find(root,'infNFSe/DPS/infDPS/toma/CNPJ'))
toma.insert(0,ET.fromstring(f'<NIF xmlns="{NS}">FOREIGN-QA-001</NIF>'))
end = find(root,'infNFSe/DPS/infDPS/toma/end')
end.remove(find(root,'infNFSe/DPS/infDPS/toma/end/endNac'))
end.insert(0,ET.fromstring(f'<endExt xmlns="{NS}"><cPais>US</cPais><cEndPost>99999</cEndPost><xCidade>CIDADE FICTICIA</xCidade><xEstProvReg>ESTADO FICTICIO</xEstProvReg></endExt>'))
save('tomador-exterior',root,'1.01',expected={'tomador.cnpj':absent(),'tomador.nif':present('FOREIGN-QA-001'),
     'tomador.endereco.codigo_municipio':absent(),'tomador.endereco.codigo_pais':present('US'),'tomador.endereco.codigo_postal_exterior':present('99999')})
root = nfse('1.00')
set_text(root,'infNFSe/cStat','101')
info=find(root,'infNFSe/DPS/infDPS')
info.insert(list(info).index(find(root,'infNFSe/DPS/infDPS/prest')),ET.fromstring(f'<subst xmlns="{NS}"><chSubstda>{KEY[:-1]}2</chSubstda><cMotivo>01</cMotivo></subst>'))
save('nfse-substituinte',root,'1.00',expected={'identificacao.codigo_status_geracao':present('101'),'identificacao.nota_substituida':present(KEY[:-1]+'2')})
root = nfse('1.01')
rtc = ET.fromstring(f'''<IBSCBS xmlns="{NS}"><cLocalidadeIncid>3550308</cLocalidadeIncid><xLocalidadeIncid>SAO PAULO</xLocalidadeIncid>
    <valores><vBC>1000.00</vBC><uf><pIBSUF>1.00</pIBSUF><pAliqEfetUF>1.00</pAliqEfetUF></uf><mun><pIBSMun>1.00</pIBSMun><pAliqEfetMun>1.00</pAliqEfetMun></mun><fed><pCBS>8.00</pCBS><pAliqEfetCBS>8.00</pAliqEfetCBS></fed></valores>
    <totCIBS><vTotNF>1100.00</vTotNF><gIBS><vIBSTot>20.00</vIBSTot><gIBSUFTot><vIBSUF>10.00</vIBSUF></gIBSUFTot><gIBSMunTot><vIBSMun>10.00</vIBSMun></gIBSMunTot></gIBS><gCBS><vCBS>80.00</vCBS></gCBS></totCIBS></IBSCBS>''')
find(root,'infNFSe').insert(len(find(root,'infNFSe'))-1,rtc)
save('ibscbs-sem-projecao-financeira',root,'1.01',expected={'totais.valor_ibs':present('20.00'),'totais.valor_cbs':present('80.00'),
     'totais.total_nf_com_ibscbs':present('1100.00'),'totais.liquido_com_ibscbs':absent()})
root = nfse('1.01')
set_text(root,'infNFSe/valores/vLiq','INVALIDO')
save('campo-invalido',root,'1.01',expected={'totais.liquido_documental':{'estado':'INVALIDO','valor':None}},xsd=False)
save('dps-nao-emitida', ET.fromstring(dps('1.01')), '1.01', 'DPS', expected={
     'identificacao.numero_nfse':absent(),'identificacao.chave_acesso':absent(),'totais.valor_servicos':present('1000.00')},alerts=['DPS_NAO_E_NFSE_EMITIDA'])
for name, code, registered in [('evento-cancelamento','e101101',True),('evento-substituicao','e105102',True),('pedido-cancelamento','e101101',False)]:
    description = 'Cancelamento de NFS-e' if code == 'e101101' else 'Cancelamento de NFS-e por Substituição'
    suffix = '' if code == 'e101101' else f'<chSubstituta>{KEY[:-1]}1</chSubstituta>'
    request_id = 'PRE'+KEY+code[1:]
    motive = '1' if code == 'e101101' else '01'
    request = f'<pedRegEvento xmlns="{NS}" versao="1.01"><infPedReg Id="{request_id}"><tpAmb>2</tpAmb><verAplic>QA_E1E2</verAplic><dhEvento>2026-10-09T10:00:00-03:00</dhEvento><CNPJAutor>{CNPJ}</CNPJAutor><chNFSe>{KEY}</chNFSe><{code}><xDesc>{description}</xDesc><cMotivo>{motive}</cMotivo><xMotivo>MOTIVO FICTICIO PARA TESTES ESTRUTURAIS</xMotivo>{suffix}</{code}></infPedReg></pedRegEvento>'
    event_id = 'EVT'+KEY+code[1:]+'001'
    root = ET.fromstring(f'<evento xmlns="{NS}" versao="1.01"><infEvento Id="{event_id}"><verAplic>QA_E1E2</verAplic><ambGer>2</ambGer><nSeqEvento>001</nSeqEvento><dhProc>2026-10-09T10:01:00-03:00</dhProc><nDFSe>2</nDFSe>{request}</infEvento>{signature(event_id)}</evento>' if registered else request)
    save(name,root,'1.01','EVENTO',expected={'evento.tipo':present(code),'identificacao.chave_acesso':present(KEY),
         'identificacao.situacao_declarada':present('CANCELADA') if registered else absent()},
         alerts=['CANCELAMENTO_DECLARADO_ASSINATURA_E_ORIGEM_NAO_VERIFICADAS'] if registered else ['PEDIDO_DE_EVENTO_NAO_COMPROVA_EFEITO_FISCAL'])
(OUT/'manifest.json').write_text(json.dumps({'versao':1,'descricao':'Somente estrutura; identidades e assinaturas ficticias, sem validade fiscal.',
    'origem_schemas':'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/nfse-esquemas_xsd-v1-01-20260209.zip',
    'casos':entries},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'{len(entries)} fixtures estruturais geradas.')
