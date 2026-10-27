# 颱風紀錄分析：預報燈號 vs 實際觀測
import json, gzip, glob, math, os, sys, collections, datetime as dt, pickle
W, REPO = sys.argv[1], sys.argv[2]
TZ = dt.timezone(dt.timedelta(hours=8)); H = 3600e3
snaps = sorted(glob.glob(W + '/log/*/*/'))
def load(d, n):
    p = d + n + '.json.gz'
    return json.load(gzip.open(p)) if os.path.exists(p) else None
def ms(s): return dt.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000
def fmt(t): return dt.datetime.fromtimestamp(t / 1000, TZ).strftime('%m/%d %H')
st = json.load(open(REPO + '/data/stations.json'))
mts = json.load(open(REPO + '/data/mountains.json'))
pid_m = collections.defaultdict(list)
for m in mts:
    if m.get('pid'): pid_m[m['pid']].append(m)
TM = {m['c']+m['no']: m for m in mts if not m.get('pid') and m.get('tw')}
for k, m in TM.items(): pid_m[k] = [m]
PTS = list(TM)
def km(a, b, c, d):
    r = math.radians; return 6371 * math.hypot((r(d) - r(b)) * math.cos(r((a + c) / 2)), r(c) - r(a))

# ---------- observations ----------
autos, rains = {}, {}
rain_h = collections.defaultdict(dict); wind_h = collections.defaultdict(dict)
def fl(v):
    try: v = float(v); return None if v < -90 else v
    except: return None
def coord(g):
    c = {x['CoordinateName']: x for x in g['Coordinates']}; c = c.get('WGS84', g['Coordinates'][0])
    return float(c['StationLatitude']), float(c['StationLongitude'])
for d in snaps:
    a = load(d, 'obs-auto'); r = load(d, 'obs-rain')
    for s in (a or {}).get('records', {}).get('Station', []):
        k = s['StationId']
        if k not in autos:
            la, lo = coord(s['GeoInfo']); autos[k] = dict(n=s['StationName'], lat=la, lon=lo, h=float(s['GeoInfo']['StationAltitude']), tw=s['GeoInfo'].get('CountyName','')+s['GeoInfo'].get('TownName',''))
        we = s['WeatherElement']
        wind_h[k][ms(s['ObsTime']['DateTime'])] = (fl(we.get('WindSpeed')), fl((we.get('GustInfo') or {}).get('PeakGustSpeed')))
    for s in (r or {}).get('records', {}).get('Station', []):
        k = s['StationId']
        if k not in rains:
            la, lo = coord(s['GeoInfo']); rains[k] = dict(n=s['StationName'], lat=la, lon=lo, h=float(s['GeoInfo']['StationAltitude']), tw=s['GeoInfo'].get('CountyName','')+s['GeoInfo'].get('TownName',''))
        v = fl(s['RainfallElement']['Past1hr']['Precipitation'])
        if v is not None and v >= 0: rain_h[k][ms(s['ObsTime']['DateTime'])] = v
def near(pool, lat, lon, h, maxkm, dh):
    best = None
    for k, v in pool.items():
        d = km(lat, lon, v['lat'], v['lon'])
        if d > maxkm or abs(v['h'] - h) > dh: continue
        sc = d + abs(v['h'] - h) / 200
        if best is None or sc < best[0]: best = (sc, k, d)
    return best
pair = {}
def near_tw(pool, tws, h, dh):
    c = [(abs(v['h'] - h), k) for k, v in pool.items() if v.get('tw') in tws and abs(v['h'] - h) <= dh]
    return min(c) if c else None
for p in PTS:
    m = TM[p]; h = m['h']; tws = set(m['tw'])
    rn = near_tw(rains, tws, h, 700); an = near_tw(autos, tws, h, 700)
    pair[p] = (h, rn[1] if rn else None, an[1] if an else None, rn[0] if rn else None, an[0] if an else None)
def actual(p, s0):
    h, rk, ak, _, _ = pair[p]; rain = ws = g = None
    if rk:
        x = [v for t, v in rain_h[rk].items() if s0 < t <= s0 + 3 * H]
        if len(x) >= 2: rain = sum(x) * 3 / len(x)
    if ak:
        x = [v for t, v in wind_h[ak].items() if s0 < t <= s0 + 3 * H]
        a1 = [v[0] for v in x if v[0] is not None]; g1 = [v[1] for v in x if v[1] is not None]
        if len(a1) >= 2: ws = max(a1)
        if len(g1) >= 2: g = max(g1)
    return rain, ws, g

# ---------- forecasts ----------
FC = []   # distinct forecasts
seen = set(); wxall = collections.Counter()
for d in snaps:
    f = load(d, 'site-forecast')
    if not f or f['fetchedAt'] in seen: continue
    seen.add(f['fetchedAt'])
    land = set(); tyw = None
    for t in f.get('typhoons', []):
        w = t.get('warn')
        if w: tyw = w.get('headline'); land |= set(w.get('land', []))
    rows = {}
    for p in PTS:
        tws = TM[p]['tw']; per = []
        for tw in tws:
            pt = f['points'].get(tw)
            if not pt: per = None; break
            d = {}
            for r in pt['h3']:
                r = r + [None] * (8 - len(r))
                wx = f['wx'][r[5]] if r[5] is not None else None
                if wx: wxall[wx] += 1
                d[f['t0'] + r[0] * 3 * H] = (r[1], r[2], r[4], wx)
            per.append(d)
        if not per: continue
        for t in set.intersection(*[set(d) for d in per]):
            rs = [d[t] for d in per]
            mx = lambda i: max((x[i] for x in rs if x[i] is not None), default=None)
            rows[(p, t)] = (mx(0), mx(1), mx(2), '／'.join(x[3] for x in rs if x[3]) or None)
    FC.append(dict(t=ms(f['fetchedAt']), alerts=[a for a in f['alerts'] if a.get('lv', 0) > 0], land=land, tyw=tyw, rows=rows))
FC.sort(key=lambda x: x['t'])
def counties(p):
    s = set()
    for m in pid_m[p]: s |= set(m['co'].split('、'))
    return s
CO = {p: counties(p) for p in PTS}
H1000 = {p: max(m['h'] for m in pid_m[p]) for p in PTS}

def lamp_fc(row, p, popC=30, popD=60, wsC=8, wsD=13.9):
    pop, ws, at, wx = row; lv = -1; why = []
    if pop is not None:
        l = 0 if pop < popC else 1 if pop < popD else 2; lv = max(lv, l)
    if ws is not None:
        l = 0 if ws < wsC else 1 if ws < wsD else 2; lv = max(lv, l)
    if wx:
        if '雷' in wx: lv = 2
        elif '霧' in wx: lv = max(lv, 1)
        if any(x in wx for x in ('下雪', '積冰', '暴風雪')): lv = 2
        elif '雪' in wx: lv = max(lv, 1)
    if at is not None and at >= 36 and H1000[p] < 1000: lv = max(lv, 1)
    return lv
def alert_hit(F, p, s0, typhoon_rule='site'):
    cs = CO[p]; hits = []
    for a in F['alerts']:
        if a['county'] not in cs: continue
        if a['type'] == '颱風警報' and typhoon_rule != 'site': continue
        if (a['start'] is None or a['start'] < s0 + 3 * H) and (a['end'] is None or a['end'] > s0): hits.append(a['type'])
    if typhoon_rule not in ('site', 'none') and F['land'] & cs:
        if typhoon_rule == 'all' or s0 < F['t'] + typhoon_rule * H: hits.append('颱風警報')
    return hits
def fc_at(T):
    c = None
    for F in FC:
        if F['t'] <= T: c = F
        else: break
    return c

first = dt.datetime(2026, 10, 23, 0, tzinfo=TZ).timestamp() * 1000
lastobs = max(max(v) for v in wind_h.values() if v)
SLOTS = [first + i * 3 * H for i in range(40) if first + (i + 1) * 3 * H <= lastobs]
LEADS = {'0h': 0, '12h': 12, '24h': 24, '48h': 48}
recs = []
for p in PTS:
    for s0 in SLOTS:
        rain, ws, g = actual(p, s0)
        if rain is None and ws is None: continue
        rec = dict(p=p, s0=s0, rain=rain, ws=ws, g=g, f={})
        for L, lh in LEADS.items():
            F = fc_at(s0 - lh * H)
            if not F or (p, s0) not in F['rows']: continue
            row = F['rows'][(p, s0)]
            rec['f'][L] = dict(row=row, fl=lamp_fc(row, p), al={k: alert_hit(F, p, s0, k) for k in ('site', 'none', 'all', 24, 12, 6, 3)}, land=bool(F['land'] & CO[p]), tyw=F['tyw'], ft=F['t'])
        recs.append(rec)
pickle.dump(dict(recs=recs, pair=pair, autos=autos, rains=rains, SLOTS=SLOTS, wxall=wxall, FC=[dict(t=F['t'], land=sorted(F['land']), tyw=F['tyw'], alerts=sorted(set((a['type'], a['county']) for a in F['alerts']))) for F in FC], H1000=H1000), open(W + '/recs.pkl', 'wb'))
print(len(recs), 'records', len(SLOTS), 'slots', fmt(SLOTS[0]), '-', fmt(SLOTS[-1]), len(FC), 'forecasts')
print('paired rain', sum(1 for v in pair.values() if v[1]), 'wind', sum(1 for v in pair.values() if v[2]), 'of', len(PTS))
