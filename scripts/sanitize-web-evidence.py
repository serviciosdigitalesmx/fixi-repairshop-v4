"""Copy private Playwright output to shareable evidence, redacting credentials first."""
import argparse
import os
import io
import json
import re
import zipfile
import base64
from pathlib import Path

SENSITIVE = re.compile(r"password|authorization|cookie|(?:access|refresh|invitation|verification)?token|secret|unlockvalue", re.I)
JWT = re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
LINK = re.compile(r"([?&](?:token|code|access_token|refresh_token|sig)=)([^&\s\"<>\\]+)", re.I)
TRACK = re.compile(r"(/(?:t|public/orders)/)([A-Za-z0-9_-]{10,})")
EMBEDDED = re.compile(r"data:application/zip;base64,([A-Za-z0-9+/=]+)")
secrets = {"Admin123456", "Tech123456", "Recepcion123", "Caja123456", "Fixi26", "InvoiceTest12345"}


def decode_embedded(value):
    data = base64.b64decode(value, validate=True)
    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise ValueError('Embedded ZIP evidence is invalid; refusing publication')
    return data


def collect(obj):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if SENSITIVE.search(key) and isinstance(value, str) and len(value) >= 4 and not value.startswith('[REDACTED'):
                secrets.add(value)
            collect(value)
        if SENSITIVE.search(str(obj.get('name', ''))) and isinstance(obj.get('value'), str):
            secrets.add(obj['value'])
        if re.search(r'Contraseña|password', str(obj.get('selector', '')), re.I) and isinstance(obj.get('value'), str):
            secrets.add(obj['value'])
    elif isinstance(obj, list):
        for value in obj:
            collect(value)
    elif isinstance(obj, str):
        for pattern in (JWT, LINK, TRACK):
            for match in pattern.finditer(obj):
                secrets.add(match.group(0) if pattern is JWT else match.group(2))
        if obj.strip().startswith(('{', '[')):
            try:
                collect(json.loads(obj))
            except (ValueError, RecursionError):
                pass


def text_of(data):
    if b'\0' in data[:1024]:
        return None
    try:
        return data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return None


def scan(data):
    if zipfile.is_zipfile(io.BytesIO(data)):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for name in archive.namelist():
                scan(archive.read(name))
        return
    text = text_of(data)
    if text is None:
        return
    for match in EMBEDDED.finditer(text):
        scan(decode_embedded(match.group(1)))
    for line in text.splitlines():
        try:
            collect(json.loads(line))
        except (ValueError, RecursionError):
            pass
    try:
        collect(json.loads(text))
    except (ValueError, RecursionError):
        pass


def redact_plain_text(text):
    for secret in sorted(secrets, key=len, reverse=True):
        if len(secret) >= 4:
            text = text.replace(secret, '[REDACTED]')
    text = JWT.sub('[REDACTED_JWT]', text)
    text = LINK.sub(r'\1[REDACTED]', text)
    return TRACK.sub(r'\1[REDACTED]', text)


def redact(data):
    if zipfile.is_zipfile(io.BytesIO(data)):
        result = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(data)) as archive, zipfile.ZipFile(result, 'w', zipfile.ZIP_DEFLATED) as safe:
            for name in archive.namelist():
                content = archive.read(name)
                if content.startswith(b'%PDF'):
                    content = b'[REDACTED_BINARY_DOCUMENT: validated separately against the real API]'
                safe.writestr(name, redact(content))
        return result.getvalue()
    text = text_of(data)
    if text is None:
        return data
    # Redact decoded archives, never their encoded bytes: a short secret can coincidentally
    # appear in Base64. Replacing that substring corrupts the ZIP and breaks verification.
    parts, position = [], 0
    for match in EMBEDDED.finditer(text):
        parts.append(redact_plain_text(text[position:match.start()]))
        payload = redact(decode_embedded(match.group(1)))
        parts.append('data:application/zip;base64,' + base64.b64encode(payload).decode())
        position = match.end()
    parts.append(redact_plain_text(text[position:]))
    return ''.join(parts).encode('utf-8')


def verify(data, location, findings):
    if zipfile.is_zipfile(io.BytesIO(data)):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for name in archive.namelist():
                verify(archive.read(name), f'{location}:{name}', findings)
        return
    text = text_of(data)
    if text is None:
        return

    def verify_plain(segment):
        if JWT.search(segment) or any(s in segment for s in secrets if len(s) >= 4 and '[REDACTED' not in s):
            findings.append(location)

    position = 0
    for index, match in enumerate(EMBEDDED.finditer(text)):
        verify_plain(text[position:match.start()])
        verify(decode_embedded(match.group(1)), f'{location}:embedded-{index}', findings)
        position = match.end()
    verify_plain(text[position:])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    source, destination = args.source.resolve(), args.destination.resolve()
    if os.name == 'nt':
        if source.drive.upper() != 'D:' or destination.drive.upper() != 'D:':
            raise SystemExit('Evidence must remain on D:')
    else:
        runner_temp = os.environ.get('RUNNER_TEMP')
        if not runner_temp or not all(p.is_relative_to(Path(runner_temp).resolve()) for p in (source, destination)):
            raise SystemExit('CI evidence must remain inside RUNNER_TEMP')
    if destination.exists():
        raise SystemExit('Refusing to overwrite existing evidence')
    files = [p for p in source.rglob('*') if p.is_file()]
    for item in files:
        data = item.read_bytes()
        if zipfile.is_zipfile(io.BytesIO(data)):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                for name in archive.namelist():
                    scan(archive.read(name))
        else:
            scan(data)
    destination.mkdir(parents=True)
    for item in files:
        target = destination / item.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        data = item.read_bytes()
        if zipfile.is_zipfile(io.BytesIO(data)):
            with zipfile.ZipFile(io.BytesIO(data)) as archive, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as safe:
                for name in archive.namelist():
                    content = archive.read(name)
                    if content.startswith(b'%PDF'):
                        content = b'[REDACTED_BINARY_DOCUMENT: validated separately against the real API]'
                    safe.writestr(name, redact(content))
        else:
            target.write_bytes(redact(data))
    findings = []
    for item in destination.rglob('*'):
        if item.is_file():
            verify(item.read_bytes(), str(item.relative_to(destination)), findings)
    manifest = {'files': len(files), 'secretValuesRedacted': len(secrets), 'leakScanFindings': findings,
                'note': 'HTTP logs omit credential headers. Recordings mask invitation/tracking text. Trace bodies and sources are redacted; PDF bodies are withheld.'}
    (destination / 'privacy-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps(manifest))
    if findings:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
