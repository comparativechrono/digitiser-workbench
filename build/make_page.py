#!/usr/bin/env python3
"""Build index.html from build/template.html and the help pages in build/help/.

- <!--ICON:name--> placeholders (in the template and the help pages) become the SVG icons of
  assets/js/icons.js, so that the page shows them before any script has run;
- each help page (build/help/*.html, in file-name order) becomes an <article class="help-page">;
  its first line is a comment with its id, title, group, summary, keywords and icon:
    <!-- id: h-terminal | title: The terminal | group: Terminal and programs | summary: … | keys: bash shell | icon: terminal -->
- the first page (h-home) gets the index of all topics, grouped (<!--TOPICS-->);
- a page with "index: yes" in its header introduces its group: <!--GROUP--> becomes the list of the group's other
  pages, and the breadcrumbs of those pages lead to it (else to the first page of the group);
- <!--VERSIONS--> becomes the table of the versions of what runs in the page, from assets/py/digitiser-tools.json
  and python/vendor/SOURCES.json, with Pyodide's and Tesseract's from assets/js/config.js and
  assets/vendor/tesseract/README.txt;
- the list of example files (data/examples) and of the starter notebooks (data/starter) is written into the page
  (window.WB_EXAMPLES, window.WB_STARTERS), with what assets/py/digitiser-tools.json says of the archive of Python
  packages (window.WB_BUNDLE).

Run:  python3 build/make_page.py   (after python3 python/build_bundle.py, if the packages changed)
"""
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
# build/ is either inside the site (as it is handed over) or next to a folder site/ (as it was developed)
SITE = ROOT if os.path.isdir(os.path.join(ROOT, 'assets')) else os.path.join(ROOT, 'site')

# the groups of the help, in order, with the page that introduces each (for the breadcrumbs)
GROUPS = [
    ('Start here', 'book2'),
    ('Walkthroughs: the examples', 'route'),
    ('The Digitise tab', 'digitise'),
    ('Kinds of figure', 'chart'),
    ('Notebook and terminal', 'terminal'),
    ('The AI assistant', 'sparkle'),
    ('Reference', 'info'),
]


def icons():
    src = open(os.path.join(SITE, 'assets/js/icons.js'), encoding='utf-8').read()
    out = {}
    for m in re.finditer(r"^\s{4}(\w+):\s*'((?:[^'\\]|\\.)*)',?\s*$", src, re.M):
        out[m.group(1)] = m.group(2).replace("\\'", "'")
    return out


ICONS = icons()


def icon(name, cls=''):
    body = ICONS.get(name) or ICONS.get('info')
    return (f'<svg class="ic{(" " + cls) if cls else ""}" viewBox="0 0 24 24" width="18" height="18" fill="none" '
            f'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" '
            f'focusable="false">{body}</svg>')


def with_icons(text):
    def rep(m):
        if m.group(1) not in ICONS:
            print(f'warning: no icon called {m.group(1)}', file=sys.stderr)
        return icon(m.group(1))
    return re.sub(r'<!--ICON:(\w+)-->', rep, text)


def read_pages():
    d = os.path.join(HERE, 'help')
    pages = []
    for name in sorted(os.listdir(d)):
        if not name.endswith('.html'):
            continue
        text = open(os.path.join(d, name), encoding='utf-8').read()
        m = re.match(r'\s*<!--(.*?)-->', text, re.S)
        if not m:
            raise SystemExit(f'{name}: the first line must be <!-- id: … | title: … | group: … -->')
        meta = {}
        for part in m.group(1).split('|'):
            if ':' in part:
                k, v = part.split(':', 1)
                meta[k.strip()] = v.strip()
        for k in ('id', 'title', 'group'):
            if k not in meta:
                raise SystemExit(f'{name}: the header has no {k}')
        if meta['group'] not in [g for g, _ in GROUPS]:
            raise SystemExit(f"{name}: unknown group {meta['group']!r}")
        meta['body'] = text[m.end():].strip()
        meta['file'] = name
        pages.append(meta)
    ids = [p['id'] for p in pages]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise SystemExit(f'pages with the same id: {dup}')
    return pages


def topics(pages):
    out = ['<div class="help-topics">']
    for g, ic in GROUPS:
        if g == 'Start here':
            continue
        ps = [p for p in pages if p['group'] == g and p['id'] != 'h-home' and p.get('index') != 'yes']
        if not ps:
            continue
        # (a group with a page of its own: its heading leads there)
        idx = next((p for p in pages if p['group'] == g and p.get('index') == 'yes'), None)
        head = f'<a href="#{idx["id"]}">{html.escape(g)}</a>' if idx else html.escape(g)
        out.append(f'<section><h2>{icon(ic)}{head}</h2><ul>')
        for p in ps:
            summ = f'<small>{html.escape(p["summary"])}</small>' if p.get('summary') else ''
            out.append(f'<li><a href="#{p["id"]}">{html.escape(p["title"])}{summ}</a></li>')
        out.append('</ul></section>')
    out.append('</div>')
    return '\n'.join(out)


def group_list(pages, group, self_id):
    """the pages of a group, for its index page (<!--GROUP-->): a page with "index: yes" in its header introduces the
    group, and the breadcrumbs of the group's pages lead to it"""
    out = ['<ul class="help-grouplist">']
    for p in pages:
        if p['group'] != group or p['id'] == self_id or p.get('index') == 'yes':
            continue
        summ = f'<small>{html.escape(p["summary"])}</small>' if p.get('summary') else ''
        out.append(f'<li><a href="#{p["id"]}">{html.escape(p["title"])}{summ}</a></li>')
    out.append('</ul>')
    return '\n'.join(out)


def versions_table():
    b = bundle()
    src = json.load(open(os.path.join(SITE, 'python/vendor/SOURCES.json'), encoding='utf-8'))['trace-digitiser']
    cfg = open(os.path.join(SITE, 'assets/js/config.js'), encoding='utf-8').read()
    pyodide = re.search(r'pyodide/v([\d.]+)/', cfg)
    e = html.escape
    rows = ['<table>', '<tr><th>What</th><th>Version</th><th>Where it comes from</th></tr>']
    where = src.get('from', '')
    url = where.split(' (')[0]  # a URL, then perhaps a note in brackets
    link = (f'<a href="{e(url, quote=True)}" target="_blank" rel="noopener">{e(url.split("://", 1)[-1])}</a>'
            f'{e(where[len(url):])}' if where.startswith('http') else e(where))
    rows.append(f'<tr><td>trace-digitiser</td><td>{e(src["version"])}</td><td>{link}</td></tr>')
    rows.append(f'<tr><td>dwb (the workbench\'s own glue)</td><td>{e(b["packages"].get("dwb", ""))}</td><td>python/dwb in this '
                'site\'s repository</td></tr>')
    rows.append('<tr><td>Python (Pyodide), with NumPy, OpenCV, pandas, Pillow and Matplotlib</td>'
                f'<td>Pyodide {e(pyodide.group(1) if pyodide else "?")}</td><td>cdn.jsdelivr.net (Pyodide\'s own builds); '
                'the versions of the packages are in the Terminal: <code>pip list</code></td></tr>')
    rows.append('<tr><td>Tesseract (OCR), compiled to WebAssembly</td><td>5.1.0 (tesseract.js-core 6.1.2), with the English '
                'model of tessdata_fast 4.1.0</td><td>assets/vendor/tesseract in this site</td></tr>')
    rows.append('</table>')
    return '\n'.join(rows)


def with_tables(body):
    if '<!--VERSIONS-->' in body:
        body = body.replace('<!--VERSIONS-->', versions_table())
    return body


def check_links(pages):
    ids = {p['id'] for p in pages}
    bad = []
    for p in pages:
        for m in re.finditer(r'(?:href="#|data-goto=")(h-[\w-]+)', p['body']):
            if m.group(1) not in ids:
                bad.append((p['file'], m.group(1)))
    for f, i in bad:
        print(f'warning: {f} links to a page that does not exist: {i}', file=sys.stderr)
    return bad


def examples():
    base = os.path.join(SITE, 'data/examples')
    out = []
    for dp, dn, fn in os.walk(base):
        dn.sort()
        for f in sorted(fn):
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, base).replace(os.sep, '/')
            out.append({'p': rel, 's': os.path.getsize(full)})
    return out


def starters():
    base = os.path.join(SITE, 'data/starter')
    if not os.path.isdir(base):
        return []
    return [{'p': 'notebooks/' + f} for f in sorted(os.listdir(base)) if f.endswith('.ipynb')]


def bundle():
    """the archive of the Python packages: its name, checksum and the packages' versions"""
    p = os.path.join(SITE, 'assets/py/digitiser-tools.json')
    if not os.path.exists(p):
        raise SystemExit('assets/py/digitiser-tools.json is missing: run  python3 python/build_bundle.py  first')
    return json.load(open(p, encoding='utf-8'))


def main():
    tpl = open(os.path.join(HERE, 'template.html'), encoding='utf-8').read()
    pages = read_pages()
    # the page that introduces a group: its index page if it has one, else its first page
    first_of = {}
    for p in pages:
        if p.get('index') == 'yes':
            first_of[p['group']] = p['id']
    for p in pages:
        first_of.setdefault(p['group'], p['id'])
    parts = []
    for p in pages:
        body = with_tables(p['body'].replace('<!--TOPICS-->', topics(pages)).replace('<!--GROUP-->', group_list(pages, p['group'], p['id'])))
        attrs = {
            'class': 'help-page',
            'id': p['id'],
            'data-title': p['title'],
            'data-group': p['group'],
            'data-group-page': first_of.get(p['group'], ''),
            'data-keys': p.get('keys', ''),
        }
        a = ' '.join(f'{k}="{html.escape(v, quote=True)}"' for k, v in attrs.items() if v)
        parts.append(f'<article {a} hidden>\n{body}\n</article>')
    check_links(pages)
    out = tpl.replace('<!--HELP-->', '\n'.join(parts))
    data = (f'<script>window.WB_EXAMPLES = {json.dumps(examples(), separators=(",", ":"))};\n'
            f'window.WB_STARTERS = {json.dumps(starters(), separators=(",", ":"))};\n'
            f'window.WB_BUNDLE = {json.dumps(bundle(), separators=(",", ":"))};</script>')
    out = out.replace('<!--DATA-->', data)
    out = with_icons(out)
    left = re.findall(r'<!--ICON:\w+-->|<!--HELP-->|<!--DATA-->|<!--TOPICS-->|<!--GROUP-->|<!--VERSIONS-->', out)
    if left:
        raise SystemExit(f'placeholders left: {left[:5]}')
    open(os.path.join(SITE, 'index.html'), 'w', encoding='utf-8').write(out)
    print(f'index.html: {len(pages)} help pages, {len(examples())} example files, {len(starters())} starter notebooks, {len(out) // 1024} KB')


if __name__ == '__main__':
    main()
