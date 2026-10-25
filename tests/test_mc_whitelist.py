import asyncio
import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('worker',pathlib.Path(__file__).parents[1]/'deploy/family-hub/whitelist-worker.py')
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class WhitelistTests(unittest.TestCase):
    def test_verified_java_uuid_and_provider_failure(self):
        profile=worker.resolve_account('java','TestUser',lambda url:{'id':'12345678123456781234567812345678','name':'TestUser'})
        self.assertEqual(profile['id'],'12345678-1234-5678-1234-567812345678')
        for data in [{},{'id':'bad','name':'TestUser'},{'id':'12345678123456781234567812345678','name':'bad\nstop'}]:
            with self.assertRaises(worker.AccountError):worker.resolve_account('java','TestUser',lambda url:data)
    def test_bedrock_floodgate_uuid_spaces_and_encoded_url(self):
        urls=[]
        def fetch(url):
            urls.append(url)
            return {'xuid':'2533274790395904'}
        p=worker.resolve_account('bedrock','Player One',fetch)
        self.assertEqual(p['name'],'.Player_One')
        self.assertTrue(p['id'].startswith('00000000-0000-0000-'))
        self.assertIn('Player%20One',urls[0])
        for xuid in ['0','abc',str(2**64)]:
            with self.assertRaises(worker.AccountError):worker.resolve_account('bedrock','Test',lambda url:{'xuid':xuid})
    def test_commands_and_untrusted_names_never_reach_provider(self):
        for edition,name in [('java','Name\nstop'),('bedrock','.Player'),('bedrock','A;op B'),('other','Test')]:
            with self.assertRaises(worker.AccountError):worker.resolve_account(edition,name,lambda url:self.fail('provider must not run'))
    def test_add_confirms_server_state_and_is_idempotent(self):
        profile={'id':'12345678-1234-5678-1234-567812345678','name':'TestUser'}
        state=[];calls=[]
        async def rpc(method,params=None):
            calls.append(method)
            if method=='minecraft:allowlist/add':
                self.assertEqual(params,[[profile]])
                state.extend(params[0])
            return list(state)
        asyncio.run(worker.add_verified_profile(profile,rpc))
        asyncio.run(worker.add_verified_profile(profile,rpc))
        self.assertEqual(calls.count('minecraft:allowlist/add'),1)
        async def no_change(method,params=None):return []
        with self.assertRaises(RuntimeError):asyncio.run(worker.add_verified_profile(profile,no_change))
    def test_database_values_are_hex_encoded(self):
        value="name'; DROP TABLE family_users; --"
        literal=worker.literal(value)
        self.assertNotIn(value,literal)
        self.assertIn(value.encode().hex(),literal)
