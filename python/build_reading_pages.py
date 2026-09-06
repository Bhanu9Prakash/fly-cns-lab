"""Build static introduction, guide and articles from authored HTML fragments.

No runtime framework or Markdown dependency. Scientific counts and reference
results are inserted from the same prepared data shipped with the simulator.
Run from any directory. Output lives inside dist for the existing Site.
"""
from pathlib import Path
import html,json,math,re

ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'dist'
meta=json.loads((DIST/'graph.json').read_text())['metadata']
arena=json.loads((DIST/'arena-graph.json').read_text())['metadata']
validation=json.loads((DIST/'arena-validation.json').read_text())
esc=html.escape
PAGES=[
    dict(slug='start',path='start.html',nav='intro',kind='Introduction',title='A fly nervous system you can experiment with',description='Understand what the Fly CNS lab models, what comes from real data, and where to begin.'),
    dict(slug='guide',path='guide.html',nav='guide',kind='User guide',title='How to use Fly CNS Activity Lab',description='A first-flight walkthrough, all the main controls, suggested experiments, exports, and troubleshooting.'),
    dict(slug='the-experiment',path='articles/the-experiment.html',nav='articles',kind='The experiment',title='What can a connectome-driven fly tell us?',description='The scientific question, why looming input is useful, and what this simplified computational twin can establish.'),
    dict(slug='connectome-to-computation',path='articles/connectome-to-computation.html',nav='articles',kind='Data & modeling',title='From a connectome to a computational model',description='How source tables become population units, directed weights, signed activity, and a sparse full-CNS model.'),
    dict(slug='how-the-fly-moves',path='articles/how-the-fly-moves.html',nav='articles',kind='Implementation',title='How neural activity makes the fly move',description='Inside the sensory-feedback loop, motor adapter, body equations, rendering, and executable implementation.'),
    dict(slug='reading-the-results',path='articles/reading-the-results.html',nav='articles',kind='Interpretation',title='How to read an experiment without overclaiming',description='Interpret interventions, compare reference results, understand feedback and cropping, and plan stronger tests.'),
]
TOKENS={
    'CIRCUIT_NODES':meta['nodes'],'CIRCUIT_NEURONS':meta['represented_neurons'],'CIRCUIT_EDGES':meta['edges'],
    'ARENA_NODES':arena['nodes'],'ARENA_NEURONS':arena['represented_neurons'],'ARENA_EDGES':arena['edges'],
    'FULL_NODES':meta['full_units'],'FULL_NEURONS':meta['full_typed_neurons'],'FULL_EDGES':meta['full_type_edges'],
}
TOKENS={key:f'{value:,}' for key,value in TOKENS.items()}
rows=[]
for key,label in [('intact','Intact'),('wing_power_silenced','Wing power silenced'),('giant_silenced','DNp01 silenced'),('motor_disconnected','Motor output disconnected'),('vision_closed','Visual input closed'),('stationary_target','Stationary target')]:
    r=validation['experiments'][key]
    launch='None' if r['first_launch'] is None else f"{r['first_launch']:.2f}"
    rows.append(f'<tr><td>{label}</td><td>{r["max_height_above_floor"]:.3f}</td><td>{r["final_horizontal_displacement"]:.3f}</td><td>{launch}</td></tr>')
TOKENS['ARENA_RESULTS_ROWS']=''.join(rows)

def render_fragment(slug):
    text=(ROOT/'content'/f'{slug}.html').read_text()
    for key,value in TOKENS.items():text=text.replace('{{'+key+'}}',value)
    assert not re.search(r'\{\{\w+\}\}',text),'Unresolved content token'
    return text

def header(prefix,current):
    links=[('intro','start.html','Introduction'),('guide','guide.html','How to use'),('articles','articles/index.html','Articles')]
    nav=''.join(f'<a href="{prefix}{path}"'+(' class="active" aria-current="location"' if key==current else '')+f'>{label}</a>' for key,path,label in links)
    return f'''<a class="skip-link" href="#reading-main">Skip to content</a>
<header class="reading-header"><a class="reading-brand" href="{prefix}"><span class="brand-symbol" aria-hidden="true">⌘</span><span>Fly CNS <span>Activity lab</span></span></a><nav aria-label="Site navigation">{nav}<a class="open-lab" href="{prefix}?view=world">Open lab <span aria-hidden="true">↗</span></a></nav></header>'''

def shell(title,description,prefix,current,body):
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(title)} | Fly CNS Activity Lab</title><meta name="description" content="{esc(description,quote=True)}"><meta name="theme-color" content="#101b1e"><link rel="stylesheet" href="{prefix}reading.css"></head>
<body class="reading-page">{header(prefix,current)}{body}
<footer class="reading-footer"><span>Fly CNS Activity Lab · Independent computational prototype</span><a href="{prefix}?view=method">Model, sources &amp; downloads</a></footer></body></html>'''

for i,page in enumerate(PAGES):
    prefix='../' if '/' in page['path'] else './'
    content=render_fragment(page['slug'])
    headings=re.findall(r'<h2 id="([^"]+)">(.*?)</h2>',content)
    toc=''.join(f'<a href="#{anchor}">{label}</a>' for anchor,label in headings)
    words=len(re.findall(r'\b\w+\b',re.sub('<[^>]+>',' ',content)))
    minutes=max(2,math.ceil(words/220))
    following=PAGES[i+1] if i<len(PAGES)-1 else PAGES[1]
    back=PAGES[i-1] if i>0 else None
    previous=f'<a href="{prefix}{back["path"]}"><span>Previous</span><strong>{esc(back["title"])}</strong></a>' if back else f'<a href="{prefix}?view=world"><span>Ready to try it?</span><strong>Open the fly arena</strong></a>'
    nextlink=f'<a href="{prefix}{following["path"]}"><span>Continue reading</span><strong>{esc(following["title"])}</strong></a>'
    overview=f'<a class="article-back" href="{prefix}articles/index.html">All articles</a>' if page['nav']=='articles' else '<span class="article-back">Start here</span>'
    body=f'''<main class="reading-main" id="reading-main"><div class="reading-title">{overview}<p class="reading-meta">{esc(page['kind'])} <span>·</span> About {minutes} min <span>·</span> Updated 6 September 2026</p><h1>{esc(page['title'])}</h1></div>
<div class="reading-layout"><aside class="reading-toc"><details open><summary>On this page</summary><nav aria-label="Article contents">{toc}</nav></details><a class="toc-lab" href="{prefix}?view=world">Try it in the lab ↗</a></aside><article class="reading-body">{content}<nav class="reading-next" aria-label="Continue learning">{previous}{nextlink}</nav></article></div></main>'''
    target=DIST/page['path'];target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(shell(page['title'],page['description'],prefix,page['nav'],body))
    print(f'{page["path"]}: {words} words')

entries=[]
for page in PAGES[2:]:
    path=Path(page['path']).name
    entries.append(f'''<li><div class="article-category">{esc(page['kind'])}</div><div><h2><a href="./{path}">{esc(page['title'])}</a></h2><p>{esc(page['description'])}</p></div><a class="article-read" aria-label="Read {esc(page['title'],quote=True)}" href="./{path}">Read <span aria-hidden="true">→</span></a></li>''')
body=f'''<main class="reading-main articles-main" id="reading-main"><div class="reading-title"><p class="reading-meta">Experiment notes</p><h1>Understand the experiment.<br>Then question the model.</h1><p class="lead">A reading path from the scientific question to the code and the results. Each article links back to the experiments it explains.</p><div class="reader-actions"><a class="action-primary" href="../guide.html">First time? Follow the guide</a><a class="action-secondary" href="../?view=world">Open the lab</a></div></div><ol class="article-list">{''.join(entries)}</ol><section class="article-downloads"><h2>Go straight to the details</h2><p>The GitHub repository includes the prepared graphs, source code, reproduction instructions, and recorded numerical checks.</p><div class="reader-actions"><a href="https://github.com/Bhanu9Prakash/fly-cns-lab">View code &amp; data on GitHub ↗</a><a href="../?view=method">Model &amp; source notes</a><a href="../EMBODIMENT.md">Complete body equations</a></div></section></main>'''
(DIST/'articles/index.html').write_text(shell('Articles','Read how the fly CNS experiment works, how it was implemented, and how to interpret its results.','../','articles',body))
