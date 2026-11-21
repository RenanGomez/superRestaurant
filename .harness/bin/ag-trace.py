"""Resume qué hizo una conversación de Antigravity (para diagnosticar runs fallidos de gemini).

Uso: python -I ag-trace.py <conversation_id> [--tail N] [--summary]
  --summary : una sola línea (pasos, último paso, errores) para el log en vivo.
Lee ~/.gemini/antigravity/conversations/<id>.db en solo lectura. Los pasos son protobuf; se extrae lo legible:
herramienta + argumentos, texto mostrado y errores.
"""
import os, re, sqlite3, sys

TOOL = re.compile(rb'call_\d+\s*.?\s*([a-z_]{3,40})\s*.?\s*(\{.{0,400}?\})', re.S)
TEXT = re.compile(rb'[\x20-\x7e\xc2-\xf4][\x20-\x7e\x80-\xbf\xc2-\xf4]{6,}')


def clean(b, n=200):
    if not b:
        return ''
    parts = [m.group(0).decode('utf-8', 'replace') for m in TEXT.finditer(b)]
    s = ' '.join(p for p in parts if not re.fullmatch(r'[\w-]{20,}', p))
    return re.sub(r'\s+', ' ', s).strip()[:n]


KIND = {15: 'respuesta del modelo', 101: 'mensaje recibido', 132: 'herramienta'}


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return 2
    cid = a[0]
    tail = int(a[a.index('--tail') + 1]) if '--tail' in a else 40
    db = os.path.join(os.path.expanduser('~'), '.gemini', 'antigravity', 'conversations', cid + '.db')
    if not os.path.exists(db):
        print(f'sin base de la conversación {cid}')
        return 1
    con = sqlite3.connect(f'file:{db}?mode=ro', uri=True, timeout=5)
    rows = con.execute('select idx, step_type, status, metadata, error_details, render_info, step_payload '
                       'from steps order by idx').fetchall()
    steps, errors = [], 0
    for idx, typ, st, meta, err, rend, pay in rows:
        blob = (meta or b'') + b' ' + (pay or b'')
        m = TOOL.search(blob)
        what = f'{m.group(1).decode()} {clean(m.group(2), 160)}' if m else clean(rend, 160) or KIND.get(typ, f'paso tipo {typ}')
        e = clean(err, 200)
        errors += bool(e)
        steps.append((idx, typ, st, what, e))
    if '--summary' in a:
        last = steps[-1] if steps else None
        lt = f'último #{last[0]}: {last[3][:120]}' if last else 'sin pasos'
        print(f'pasos={len(steps)} errores={errors} {lt}')
        return 0
    print(f'conversación {cid}: {len(steps)} pasos, {errors} con error (últimos {tail})')
    for idx, typ, st, what, e in steps[-tail:]:
        print(f'#{idx:<4} t{typ:<4} s{st} {what}' + (f'\n       ERROR: {e}' if e else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
