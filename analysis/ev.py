import pickle, sys, collections, datetime as dt, json
W = sys.argv[1]
D = pickle.load(open(W + '/recs.pkl', 'rb')); R = D['recs']
TZ = dt.timezone(dt.timedelta(hours=8)); H = 3600e3
fmt = lambda t: dt.datetime.fromtimestamp(t / 1000, TZ).strftime('%m/%d %H')
out = []
def P(*a): out.append(' '.join(str(x) for x in a))
pct = lambda a, b: f'{100*a/b:.0f}%' if b else '-'
LIFT = dt.datetime(2026, 10, 24, 15, tzinfo=TZ).timestamp() * 1000   # 陸上警報解除（約 15:00）
def lvl_pop(pop, c, d): return None if pop is None else 0 if pop < c else 1 if pop < d else 2
def lvl_ws(ws, c, d): return None if ws is None else 0 if ws < c else 1 if ws < d else 2

P('== 樣本 ==')
P('筆數', len(R), '有雨量', sum(r['rain'] is not None for r in R), '有風', sum(r['ws'] is not None for r in R))
P('時段', fmt(D['SLOTS'][0]), '~', fmt(D['SLOTS'][-1]))

# 1. 降雨機率 vs 實際雨量
for L in ('0h', '24h'):
    P(f'\n== 1. 降雨機率（{L} 前預報）對實際 3 小時雨量 ==')
    b = collections.defaultdict(list)
    for r in R:
        f = r['f'].get(L)
        if not f or r['rain'] is None or f['row'][0] is None: continue
        b[f['row'][0] // 10 * 10].append(r['rain'])
    for k in sorted(b):
        x = b[k]; n = len(x)
        P(f'{k:>3}%  n={n:4}  ≥1mm {pct(sum(v>=1 for v in x),n):>4}  ≥5 {pct(sum(v>=5 for v in x),n):>4}  ≥10 {pct(sum(v>=10 for v in x),n):>4}  ≥20 {pct(sum(v>=20 for v in x),n):>4}  中位 {sorted(x)[n//2]:.1f}')

# 2. 降雨門檻方案（只看降雨機率）
for L in ('0h', '24h'):
    P(f'\n== 2. 降雨機率門檻方案（{L} 前預報，只看雨）==')
    xs = [(r['f'][L]['row'][0], r['rain']) for r in R if L in r['f'] and r['rain'] is not None and r['f'][L]['row'][0] is not None]
    for c, d in ((30, 60), (20, 50), (30, 70), (40, 70), (40, 80), (50, 80)):
        line = f'C{c}/D{d}:'
        cnt = collections.Counter(lvl_pop(p, c, d) for p, _ in xs)
        line += f' B{pct(cnt[0],len(xs))} C{pct(cnt[1],len(xs))} D{pct(cnt[2],len(xs))} |'
        for th in (1, 5, 10):
            Dn = [v for p, v in xs if lvl_pop(p, c, d) == 2]; Bn = [v for p, v in xs if lvl_pop(p, c, d) == 0]; bad = [p for p, v in xs if v >= th]
            line += f' ≥{th}mm: D中真的下 {pct(sum(v>=th for v in Dn),len(Dn))}、下了有給D {pct(sum(lvl_pop(p,c,d)==2 for p in bad),len(bad))}、B中其實下 {pct(sum(v>=th for v in Bn),len(Bn))} |'
        P(line)

# 3. 風
P('\n== 3. 預報風速 vs 測站（0h）==')
for hb, lab in ((0, '全部測站'), (1500, '測站 1500 m 以上')):
    b = collections.defaultdict(list)
    for r in R:
        f = r['f'].get('0h')
        if not f or r['ws'] is None or f['row'][1] is None: continue
        if D['autos'][D['pair'][r['p']][2]]['h'] < hb: continue
        b[min(int(f['row'][1]), 16)].append((r['ws'], r['g']))
    P(lab)
    for k in sorted(b):
        x = b[k]; n = len(x); a = [v[0] for v in x]; g = [v[1] for v in x if v[1] is not None]
        P(f'  預報 {k:>2} m/s n={n:4}  實測平均中位 {sorted(a)[n//2]:.1f}  平均≥8 {pct(sum(v>=8 for v in a),n)}  ≥13.9 {pct(sum(v>=13.9 for v in a),n)}  陣風中位 {sorted(g)[len(g)//2] if g else "-"}  陣風≥17.2 {pct(sum(v>=17.2 for v in g),len(g))}  ≥24.5 {pct(sum(v>=24.5 for v in g),len(g))}')
P('高山測站配對：', sorted({(D['autos'][v[2]]['n'], int(D['autos'][v[2]]['h'])) for v in D['pair'].values() if v[2] and D['autos'][v[2]]['h'] >= 2000}))

# 4. 燈號 vs 實際（不同「天氣不好」標準）
STD = {'甲 雨≥1mm或風≥8': lambda r: (r['rain'] or 0) >= 1 or (r['ws'] or 0) >= 8,
       '乙 雨≥5mm或風≥10.8': lambda r: (r['rain'] or 0) >= 5 or (r['ws'] or 0) >= 10.8,
       '丙 雨≥10mm或風≥13.9': lambda r: (r['rain'] or 0) >= 10 or (r['ws'] or 0) >= 13.9,
       '丁 雨≥10mm或陣風≥24.5': lambda r: (r['rain'] or 0) >= 10 or (r['g'] or 0) >= 24.5}
def site_lv(f, rule='site'):
    a = f['al'][rule]; return 2 if a else f['fl']
def evalset(rows, L, rule, label):
    xs = [(site_lv(r['f'][L], rule), r) for r in rows if L in r['f'] and site_lv(r['f'][L], rule) >= 0]
    cnt = collections.Counter(l for l, _ in xs); n = len(xs)
    s = f'{label}: n={n} B{pct(cnt[0],n)} C{pct(cnt[1],n)} D{pct(cnt[2],n)}'
    for k, fn in STD.items():
        Dn = [r for l, r in xs if l == 2]; Bn = [r for l, r in xs if l == 0]; bad = [l for l, r in xs if fn(r)]
        s += f'\n     {k}: 實際不好 {pct(len(bad),n)}；D 中真的不好 {pct(sum(fn(r) for r in Dn),len(Dn))}；不好時有給 D {pct(sum(l==2 for l in bad),len(bad))}；B 中其實不好 {pct(sum(fn(r) for r in Bn),len(Bn))}（{sum(fn(r) for r in Bn)} 筆）'
    P(s)
P('\n== 4. 網站燈號 vs 實際（0h 前）==')
during = [r for r in R if r['s0'] < LIFT]; after = [r for r in R if r['s0'] >= LIFT]
evalset(during, '0h', 'site', '陸上警報期間（～10/24 15 時）')
evalset(after, '0h', 'site', '警報解除後（10/24 15 時～）')
P('\n-- 同上，但不看任何特報（只看預報本身）--')
for nm, rows in (('警報期間', during), ('解除後', after)):
    xs = [r for r in rows if '0h' in r['f']]
    for r in xs: r['f']['0h']['al']['nil'] = []
    evalset(xs, '0h', 'nil', nm)

# 5. 颱風規則比較
P('\n== 5. 颱風陸上警報規則比較（陸上警報期間的時段；出發前 0／12／24 小時看）==')
for L in ('0h', '12h', '24h'):
    for rule, lab in (('none', '不看颱風警報'), (3, '3 小時'), (6, '6 小時'), (12, '12 小時（現行）'), (24, '24 小時'), ('all', '全部時段 D')):
        rows = [r for r in R if L in r['f'] and r['f'][L]['land']]
        xs = [(site_lv(r['f'][L], rule), r) for r in rows]
        n = len(xs); fn = STD['乙 雨≥5mm或風≥10.8']; fn2 = STD['甲 雨≥1mm或風≥8']
        Dn = [r for l, r in xs if l == 2]; nonD = [r for l, r in xs if l < 2]
        P(f'{L} {lab:12} n={n} D{pct(len(Dn),n)}  D但其實沒事(甲標準) {sum(not fn2(r) for r in Dn)}  非D但其實不好(乙標準) {sum(fn(r) for r in nonD)}  非D但不好(丙) {sum(STD["丙 雨≥10mm或風≥13.9"](r) for r in nonD)}')

# 6. 預報提前多久
P('\n== 6. 提前多久看：燈號穩定度與準度（乙標準）==')
for L in ('0h', '12h', '24h', '48h'):
    xs = [(site_lv(r['f'][L]), r) for r in R if L in r['f']]
    xs = [(l, r) for l, r in xs if l >= 0]; n = len(xs); fn = STD['乙 雨≥5mm或風≥10.8']
    Dn = [r for l, r in xs if l == 2]; Bn = [r for l, r in xs if l == 0]; bad = [l for l, r in xs if fn(r)]
    P(f'{L}: n={n} D中真的不好 {pct(sum(fn(r) for r in Dn),len(Dn))}  不好時有給D {pct(sum(l==2 for l in bad),len(bad))}  B中其實不好 {pct(sum(fn(r) for r in Bn),len(Bn))}')
chg = collections.Counter()
for r in R:
    if '24h' in r['f'] and '0h' in r['f']:
        chg[('BCD'[site_lv(r['f']['24h'])] if site_lv(r['f']['24h']) >= 0 else '-') + '→' + ('BCD'[site_lv(r['f']['0h'])] if site_lv(r['f']['0h']) >= 0 else '-')] += 1
P('24h 前 → 0h 燈號變化', chg.most_common())

# 7. 時間序列：每時段全體平均
P('\n== 7. 每個時段：D 比例 vs 實際不好比例（乙），0h ==')
for s0 in D['SLOTS']:
    xs = [r for r in R if r['s0'] == s0 and '0h' in r['f']]
    if not xs: continue
    l = [site_lv(r['f']['0h']) for r in xs]; fn = STD['乙 雨≥5mm或風≥10.8']
    rn = [r['rain'] for r in xs if r['rain'] is not None]
    land = sum(r['f']['0h']['land'] for r in xs)
    P(f'{fmt(s0)}  D {pct(l.count(2),len(xs)):>4} C {pct(l.count(1),len(xs)):>4} B {pct(l.count(0),len(xs)):>4} | 不好(乙) {pct(sum(fn(r) for r in xs),len(xs)):>4} | 雨≥1mm {pct(sum(v>=1 for v in rn),len(rn)):>4} 平均雨 {sum(rn)/max(1,len(rn)):.1f}mm | 陸上警戒點 {land}')

# 8. 解除後錯得最兇的例子
P('\n== 8. 例子 ==')
def name(p): return D['pair'][p][0]
ex = []
for r in after:
    f = r['f'].get('0h')
    if not f: continue
    l = site_lv(f)
    if l == 0 and ((r['rain'] or 0) >= 10 or (r['ws'] or 0) >= 13.9): ex.append(('B但不好', r))
    if l == 2 and (r['rain'] or 0) < 0.5 and (r['ws'] or 0) < 5: ex.append(('D但沒事', r))
c = collections.Counter(k for k, _ in ex); P(c)
import itertools
st_names = {}
for k, grp in itertools.groupby(sorted(ex, key=lambda x: x[0]), key=lambda x: x[0]):
    g = list(grp); P(k)
    for _, r in sorted(g, key=lambda x: -((x[1]['rain'] or 0) + (x[1]['ws'] or 0)))[:8]:
        f = r['f']['0h']; P('  ', r['p'], fmt(r['s0']), 'pop', f['row'][0], 'ws', f['row'][1], f['row'][3], 'alerts', f['al']['site'], '| 實際 雨', None if r['rain'] is None else round(r['rain'], 1), '風', r['ws'], '陣風', r['g'])
P('\n== 9. 天氣描述用語 ==')
known = set('晴、晴時多雲、多雲時晴、多雲、多雲時陰、陰時多雲、陰天、陰、短暫陣雨、短暫雨、午後短暫陣雨、多雲短暫陣雨、多雲短暫雨、陰短暫陣雨、陰時多雲短暫陣雨、多雲時陰短暫陣雨、晴午後短暫陣雨、多雲午後短暫陣雨、陣雨、陰陣雨、陰時多雲陣雨、多雲時陰陣雨'.split('、'))
P('新出現：', [(k, v) for k, v in D['wxall'].most_common() if k not in known])
P('\n== 10. 特報時間軸 ==')
prev = None
for F in D['FC']:
    k = (F['tyw'], len(F['land']), tuple(sorted({a for a, _ in F['alerts']})))
    if k != prev: P(fmt(F['t']), F['tyw'], '陸上警戒', len(F['land']), '縣市', k[2]); prev = k
open(W + '/report.txt', 'w').write('\n'.join(out)); print('\n'.join(out))
