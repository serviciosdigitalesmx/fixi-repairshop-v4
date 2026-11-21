"""Binary-format and leak-detection regressions; no backend or HTTP mocks."""
import base64
import importlib.util
import io
import json
from pathlib import Path
import secrets
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('sanitize-web-evidence.py'))
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.original = evidence.secrets.copy()

    def tearDown(self):
        evidence.secrets.clear()
        evidence.secrets.update(self.original)

    def report(self):
        credential = secrets.token_urlsafe(24)
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('report.json', json.dumps({'password': credential, 'tests': 3}))
        payload = base64.b64encode(output.getvalue()).decode()
        html = f'<p>{credential}</p><script>"data:application/zip;base64,{payload}"</script>'.encode()
        return credential, payload, html

    def test_base64_collision_does_not_corrupt_or_hide_archive_redaction(self):
        credential, payload, html = self.report()
        collision = payload[:4]  # ZIP's Base64 prefix also happens to be a sensitive plaintext value.
        evidence.secrets.add(collision)
        evidence.scan(html)
        safe = evidence.redact(html)
        encoded = evidence.EMBEDDED.search(safe.decode()).group(1)
        self.assertTrue(encoded.startswith(collision))
        with zipfile.ZipFile(io.BytesIO(evidence.decode_embedded(encoded))) as archive:
            record = json.loads(archive.read('report.json'))
        self.assertEqual(record['password'], '[REDACTED]')
        self.assertEqual(record['tests'], 3)
        self.assertNotIn(credential.encode(), safe)
        findings = []
        evidence.verify(safe, 'index.html', findings)
        self.assertEqual(findings, [])

    def test_unredacted_embedded_credentials_are_still_detected(self):
        _, _, html = self.report()
        evidence.scan(html)
        findings = []
        evidence.verify(html, 'index.html', findings)
        self.assertTrue(any('embedded-0:report.json' in value for value in findings))

    def test_invalid_payloads_fail_closed(self):
        for payload in ['A', base64.b64encode(b'not a zip archive').decode()]:
            data = f'"data:application/zip;base64,{payload}"'.encode()
            for action in [lambda: evidence.scan(data), lambda: evidence.redact(data), lambda: evidence.verify(data, 'report', [])]:
                with self.assertRaises(ValueError):
                    action()


if __name__ == '__main__':
    unittest.main()
