import importlib.util
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'deploy/media-security'
sys.path.insert(0, str(SOURCE))
from gate import snapshot, publish, Rejected, Held, safe_relative, MAX_FILE, open_raw, retry_rejected, clam_verdict

class GateTests(unittest.TestCase):
    def test_scanner_limits_hold_without_malware_blocklisting(self):
        limit='/candidate/movie.mkv: Heuristics.Limits.Exceeded.MaxScanTime FOUND\n'
        with self.assertRaises(Held):clam_verdict(subprocess.CompletedProcess([],1,limit,''))
        with self.assertRaises(Rejected):clam_verdict(subprocess.CompletedProcess([],1,limit+'/candidate/extra: Eicar-Test-Signature FOUND\n',''))
        with self.assertRaises(Held):clam_verdict(subprocess.CompletedProcess([],2,'','ERROR scanner failed'))
        with self.assertRaises(Held):clam_verdict(subprocess.CompletedProcess([],0,'','WARNING scan skipped'))
        with self.assertRaises(Held):clam_verdict(subprocess.CompletedProcess([],1,'',''))
        self.assertIsNone(clam_verdict(subprocess.CompletedProcess([],0,'/candidate/movie.mp4: OK\n','')))

    def test_path_traversal_and_control_characters(self):
        for value in ['/etc/passwd', '../escape', 'a/../../b', 'evil\nname']:
            with self.assertRaises(Rejected): safe_relative(value)

    def test_bypass_links_and_special_files(self):
        for kind in ['symlink', 'hardlink', 'fifo']:
            with tempfile.TemporaryDirectory() as base:
                p = Path(base); (p/'raw').mkdir(); (p/'outside').write_bytes(b'secret')
                target = p/'raw/movie.mp4'
                if kind == 'symlink': target.symlink_to(p/'outside')
                elif kind == 'hardlink': os.link(p/'outside', target)
                else: os.mkfifo(target)
                with self.assertRaises(Rejected): snapshot(p/'raw', p/'candidate')
                self.assertFalse((p/'verified').exists())

    def test_qbit_cannot_mutate_published_bytes_through_raw(self):
        with tempfile.TemporaryDirectory() as base:
            p = Path(base); (p/'raw').mkdir(); (p/'raw/movie.mp4').write_bytes(b'scanned bytes')
            snapshot(p/'raw', p/'candidate')
            publish(p/'candidate', ['movie.mp4'], p/'verified')
            (p/'raw/movie.mp4').write_bytes(b'changed after scan')
            self.assertEqual((p/'verified/movie.mp4').read_bytes(), b'scanned bytes')
            self.assertNotEqual((p/'raw/movie.mp4').stat().st_ino, (p/'verified/movie.mp4').stat().st_ino)
            self.assertEqual((p/'candidate/movie.mp4').stat().st_ino, (p/'verified/movie.mp4').stat().st_ino)
            with self.assertRaises(Held): publish(p/'candidate', ['movie.mp4'], p/'verified')

    def test_oversize_is_held_before_copy(self):
        with tempfile.TemporaryDirectory() as base:
            p = Path(base); (p/'raw').mkdir()
            with (p/'raw/movie.mp4').open('wb') as f: f.truncate(MAX_FILE+1)
            with self.assertRaises(Held): snapshot(p/'raw', p/'candidate')

    def test_ancestor_symlink_cannot_escape_raw(self):
        with tempfile.TemporaryDirectory() as base:
            p=Path(base);(p/'raw').mkdir();(p/'outside').mkdir();(p/'outside/file').write_bytes(b'secret')
            (p/'raw/link').symlink_to(p/'outside')
            with self.assertRaises(OSError): open_raw(p/'raw','link/file')

    def test_rejected_release_blocklists_only_matching_queue_and_keeps_raw(self):
        calls=[]
        def fake_arr(app,method,path,body=None):
            calls.append((app,method,path))
            return {'records':[{'id':1,'downloadId':'other'},{'id':2,'downloadId':'ABC'}]} if method=='GET' else None
        with patch('gate.arr',side_effect=fake_arr):
            retry_rejected({'category':'radarr','hash':'abc'},None)
        self.assertEqual(calls[-1],('radarr','DELETE','/queue/2?removeFromClient=false&blocklist=true&skipRedownload=false'))
        self.assertEqual(len(calls),2)

if __name__ == '__main__': unittest.main()
