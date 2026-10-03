#!/usr/bin/env python3
"""Merge an existing web graph.json with Graph_RAG_Drones communities/reports.
Usage:
  python scripts/export_community_kg_for_web.py \
    --base-graph docs/data/base_graph.json \
    --communities RUN/graph/communities.jsonl \
    --reports RUN/graph/community_reports.jsonl \
    --output docs/data/graph.json
"""
import argparse, json, collections

def read_jsonl(path):
    with open(path,encoding="utf-8") as f:
        return [json.loads(x) for x in f if x.strip()]

def fix(name):
    if name == '$\x08ETA$': return '$\\BETA$'
    if name == '$\tHETA$': return '$\\THETA$'
    return name

ap=argparse.ArgumentParser()
ap.add_argument('--base-graph',required=True)
ap.add_argument('--communities',required=True)
ap.add_argument('--reports',required=True)
ap.add_argument('--output',required=True)
a=ap.parse_args()
with open(a.base_graph,encoding='utf-8') as f: g=json.load(f)
cs=read_jsonl(a.communities); rs=read_jsonl(a.reports)
ids={n['id'] for n in g['nodes']}; cb={c['community_id']:c for c in cs}; rb={r['community_id']:r for r in rs}
cache={}
def root(cid):
    if cid in cache:return cache[cid]
    c=cb.get(cid); seen=set()
    while c and c.get('parent_id') and c['community_id'] not in seen:
        seen.add(c['community_id']); c=cb.get(c['parent_id'])
    cache[cid]=c['community_id'] if c else cid; return cache[cid]
mem=collections.defaultdict(list); out=[]
for c in cs:
    cid=c['community_id']; rep=(rb.get(cid) or {}).get('report') or {}
    ns=[]; seen=set()
    for raw in c.get('nodes',[]):
        n=fix(raw)
        if n in ids and n not in seen: ns.append(n); seen.add(n)
    x={'community_id':cid,'level':int(c.get('level',0)),'parent_id':c.get('parent_id'),'children':c.get('children',[]) or [],'root_id':root(cid),'nodes':ns,'size':len(ns),'title':rep.get('title') or f'Community {cid}','summary':rep.get('summary') or ''}
    out.append(x)
    for n in ns: mem[n].append({'id':cid,'level':x['level'],'title':x['title'],'root_id':x['root_id']})
for n in g['nodes']: n['communities']=sorted(mem.get(n['id'],[]),key=lambda x:(x['level'],x['id']))
g['communities']=out; g['meta']['community_count']=len(out); g['meta']['has_communities']=True
with open(a.output,'w',encoding='utf-8') as f: json.dump(g,f,ensure_ascii=False,separators=(',',':'))
print(f'Wrote {a.output}: {len(g["nodes"]):,} nodes, {len(g["edges"]):,} edges, {len(out):,} communities')
