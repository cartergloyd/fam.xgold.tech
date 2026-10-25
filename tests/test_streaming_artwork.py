import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('artwork', Path(__file__).resolve().parents[1] / 'deploy/streaming-artwork/refresh.py')
artwork = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artwork)


class ArtworkTest(unittest.TestCase):
    def test_new_episodes_use_unique_series_posters_and_missing_artwork_is_skipped(self):
        series = 'a' * 32
        items = [
            {'Type': 'Episode', 'Id': 'b'*32, 'SeriesId': series, 'SeriesPrimaryImageTag': 'poster'},
            {'Type': 'Series', 'Id': series, 'ImageTags': {'Primary': 'poster'}},
            {'Type': 'Movie', 'Id': 'c'*32, 'ImageTags': {}},
            {'Type': 'Movie', 'Id': '../invalid', 'ImageTags': {'Primary': 'poster'}},
        ]
        self.assertEqual(list(artwork.candidates(items)), [(series, 'poster')])

    def test_failure_retains_existing_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'config.json'
            config.write_text(json.dumps({'url': 'http://localhost', 'api_key': 'secret'}))
            manifest = root / 'recent.json'
            manifest.write_text('last-good-feed')
            with patch.object(artwork.urllib.request, 'urlopen', side_effect=OSError('offline')):
                with self.assertRaises(OSError):
                    artwork.refresh(config, root)
            self.assertEqual(manifest.read_text(), 'last-good-feed')


if __name__ == '__main__':
    unittest.main()
