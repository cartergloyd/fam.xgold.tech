import importlib.util
import json
import pathlib
import struct
import subprocess
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('worker',pathlib.Path(__file__).parents[1]/'deploy/family-hub/whitelist-worker.py')
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

JAVA={'id':'12345678-1234-5678-1234-567812345678','name':'TestUser'}

class WhitelistTests(unittest.TestCase):
    def test_verified_java_uuid_and_provider_failure(self):
        profile=worker.resolve_account('java','TestUser',lambda url:{'id':'12345678123456781234567812345678','name':'TestUser'})
        self.assertEqual(profile,JAVA)
        for data in [{},{'id':'bad','name':'TestUser'},{'id':'12345678123456781234567812345678','name':'bad\nstop'}]:
            with self.assertRaises(worker.AccountError):worker.resolve_account('java','TestUser',lambda url:data)
    def test_bedrock_floodgate_uuid_spaces_and_encoded_url(self):
        urls=[]
        def fetch(url):
            urls.append(url)
            return {'xuid':2535465128704053}
        p=worker.resolve_account('bedrock','Player One',fetch)
        self.assertEqual(p['name'],'.Player_One')
        # Floodgate's UUID is the XUID in the low bits; this one is a real entry on the server.
        self.assertEqual(p['id'],'00000000-0000-0000-0009-01fdfa563835')
        self.assertIn('Player%20One',urls[0])
        for xuid in ['0','abc',str(2**64)]:
            with self.assertRaises(worker.AccountError):worker.resolve_account('bedrock','Test',lambda url:{'xuid':xuid})
    def test_commands_and_untrusted_names_never_reach_provider(self):
        for edition,name in [('java','Name\nstop'),('bedrock','.Player'),('bedrock','A;op B'),('other','Test')]:
            with self.assertRaises(worker.AccountError):worker.resolve_account(edition,name,lambda url:self.fail('provider must not run'))
    def test_merge_adds_and_renames_by_uuid_without_removing(self):
        existing=[{'uuid':'3b7a2a82-fb39-43b1-8f88-2d41f8a025ee','name':'sevnak'},{'uuid':'00000000-0000-0000-0009-01fdfa563835','name':'.BedrockXUID_2535465128704053'}]
        desired=[JAVA|{'uuid':JAVA['id']},{'uuid':'00000000-0000-0000-0009-01FDFA563835','name':'.TurnedVeil10184'}]
        merged,changed=worker.merge_whitelist(existing,[{'uuid':d['uuid'],'name':d['name']} for d in desired])
        self.assertTrue(changed)
        self.assertEqual([e['name'] for e in merged],['sevnak','.TurnedVeil10184','TestUser'])
        self.assertEqual(len(merged),3)
        again,changed=worker.merge_whitelist(merged,[{'uuid':JAVA['id'],'name':'TestUser'}])
        self.assertFalse(changed);self.assertEqual(again,merged)
        # Nothing the directory does not know about is ever dropped.
        kept,_=worker.merge_whitelist(existing,[])
        self.assertEqual(kept,existing)
    def test_desired_entries_and_names_skip_disabled_and_unverified(self):
        rows=[{'id':'u1','name':'Carter Gloyd','first_name':'Carter','status':'ready','mc_java_username':'Wolfgang12','mc_java_uuid':'0b8959cd-9329-40d3-bc0e-1cc93d641a13','mc_bedrock_username':'Player One','mc_bedrock_uuid':'00000000-0000-0000-0009-01fdfa563835'},
              {'id':'u2','name':'Alex','first_name':None,'status':'invited','mc_java_username':'Pending1','mc_java_uuid':None,'mc_bedrock_username':None,'mc_bedrock_uuid':None},
              {'id':'u3','name':'Sam','first_name':'Sam','status':'disabled','mc_java_username':'Gone','mc_java_uuid':'3b7a2a82-fb39-43b1-8f88-2d41f8a025ee','mc_bedrock_username':None,'mc_bedrock_uuid':None}]
        self.assertEqual(worker.desired_entries(rows),[{'uuid':'0b8959cd-9329-40d3-bc0e-1cc93d641a13','name':'Wolfgang12'},{'uuid':'00000000-0000-0000-0009-01fdfa563835','name':'.Player_One'}])
        self.assertEqual(worker.names_payload(rows),{'00000000-0000-0000-0009-01fdfa563835':'Carter','0b8959cd-9329-40d3-bc0e-1cc93d641a13':'Carter'})
    def test_sync_writes_files_reloads_once_and_reports_uuids(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            (root/'whitelist.json').write_text(json.dumps([{'uuid':'3b7a2a82-fb39-43b1-8f88-2d41f8a025ee','name':'sevnak'}]))
            rows=[{'id':'u1','name':'Carter','first_name':'Carter','status':'ready','mc_java_username':'Wolfgang12','mc_java_uuid':'0b8959cd-9329-40d3-bc0e-1cc93d641a13','mc_bedrock_username':None,'mc_bedrock_uuid':None}]
            commands=[]
            with mock.patch.multiple(worker,WHITELIST=root/'whitelist.json',NAMES=root/'plugins/FamilyNames/names.json',directory=lambda:rows,rcon=lambda c:commands.append(c) or 'Reloaded the whitelist'):
                uuids=worker.sync()
                self.assertEqual(uuids,{'3b7a2a82-fb39-43b1-8f88-2d41f8a025ee','0b8959cd-9329-40d3-bc0e-1cc93d641a13'})
                self.assertEqual(commands,['whitelist reload'])
                self.assertEqual(json.loads((root/'plugins/FamilyNames/names.json').read_text()),{'0b8959cd-9329-40d3-bc0e-1cc93d641a13':'Carter'})
                self.assertEqual([e['name'] for e in json.loads((root/'whitelist.json').read_text())],['sevnak','Wolfgang12'])
                worker.sync()
                self.assertEqual(commands,['whitelist reload'],'an unchanged whitelist is not reloaded again')
    def test_rcon_framing_and_command_allowlist(self):
        packet=worker.rcon_packet(7,2,'whitelist reload')
        (length,)=struct.unpack('<i',packet[:4])
        self.assertEqual(length,len(packet)-4)
        self.assertEqual(worker.rcon_parse(packet[4:]),(7,2,'whitelist reload'))
        with self.assertRaises(ValueError):worker.rcon('whitelist add TestUser')
        with self.assertRaises(ValueError):worker.rcon('op TestUser')
    def test_duplicate_account_link_becomes_member_message(self):
        failure=subprocess.CalledProcessError(1,'psql',stderr='ERROR:  duplicate key value violates unique constraint "family_users_mc_java_uuid"')
        with mock.patch.object(worker,'sql',side_effect=failure):
            with self.assertRaises(worker.AccountError):worker.store_account('u1','java',JAVA,'testuser')
        statements=[]
        with mock.patch.object(worker,'sql',side_effect=lambda text:statements.append(text) or ''):
            worker.store_account('u1','bedrock',{'id':'00000000-0000-0000-0009-01fdfa563835','name':'.Player_One'},'Player One')
        self.assertIn('mc_bedrock_username=',statements[0])
        self.assertIn('Player One'.encode().hex(),statements[0],'the stored gamertag has no prefix and keeps its spaces')
    def test_database_values_are_hex_encoded(self):
        value="name'; DROP TABLE family_users; --"
        literal=worker.literal(value)
        self.assertNotIn(value,literal)
        self.assertIn(value.encode().hex(),literal)

if __name__=='__main__':
    unittest.main()
