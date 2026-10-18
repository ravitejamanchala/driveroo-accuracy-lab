import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class ImporterTests(unittest.TestCase):
    def build(self, properties, extras=()):
        features = [{'type': 'Feature', 'properties': {'highway': 'primary', 'name': 'Fixture', **properties},
                     'geometry': {'type': 'LineString', 'coordinates': [[0, 52], [0.001, 52], [0.002, 52]]}}] + list(extras)
        with tempfile.TemporaryDirectory() as tmp:
            src, out = pathlib.Path(tmp) / 'source.json', pathlib.Path(tmp) / 'net.json'
            src.write_text(json.dumps({'features': features}))
            subprocess.run(['python3', '-I', str(ROOT / 'tools/build_net.py'), str(src), str(out)], check=True, capture_output=True)
            return json.loads(out.read_text())

    def test_width_directional_lanes_and_arrows(self):
        d = self.build({'width': '7.8 m', 'lanes': '3', 'lanes:forward': '2', 'lanes:backward': '1', 'turn:lanes:forward': 'left|through'})
        w = d['ways'][0]
        self.assertEqual(w[5], 7.8)
        self.assertEqual(w[11]['widthSource'], 'mapped')
        self.assertEqual(w[11]['lanesForward'], 2)
        self.assertEqual(w[11]['lanesBackward'], 1)
        self.assertEqual(w[11]['turnForward'], ['left', 'through'])

    def test_off_road_lamp_is_retained(self):
        lamp = {'type': 'Feature', 'properties': {'highway': 'street_lamp'}, 'geometry': {'type': 'Point', 'coordinates': [0.001, 52.0001]}}
        self.assertEqual(len(self.build({}, [lamp])['lamps']), 1)

    def test_reverse_oneway_swaps_directional_metadata(self):
        w = self.build({'oneway': '-1', 'lanes': '2', 'lanes:backward': '2', 'turn:lanes:backward': 'left|through', 'cycleway:left': 'lane'})['ways'][0]
        self.assertEqual(w[4], 1)
        self.assertEqual(w[11]['lanesForward'], 2)
        self.assertEqual(w[11]['lanesBackward'], 0)
        self.assertEqual(w[11]['turnForward'], ['left', 'through'])
        self.assertEqual(w[9], 1)

    def test_missing_width_remains_labelled_inferred(self):
        self.assertEqual(self.build({'width': 'unknown'})['ways'][0][11]['widthSource'], 'inferred')

if __name__ == '__main__': unittest.main()
