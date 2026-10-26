import pickle,sys,collections,datetime as dt
D=pickle.load(open(sys.argv[1]+'/recs.pkl','rb'));R=D['recs']
TZ=dt.timezone(dt.timedelta(hours=8));LIFT=dt.datetime(2026,10,24,15,tzinfo=TZ).timestamp()*1000
STD={'甲':lambda r:(r['rain'] or 0)>=1 or (r['ws'] or 0)>=8,'乙':lambda r:(r['rain'] or 0)>=5 or (r['ws'] or 0)>=10.8,'丙':lambda r:(r['rain'] or 0)>=10 or (r['ws'] or 0)>=13.9}
def fl(row,popD,wsD=13.9):
  pop,ws,at,wx=row;l=-1
  if pop is not None:l=max(l,0 if pop<30 else 1 if pop<popD else 2)
  if ws is not None:l=max(l,0 if ws<8 else 1 if ws<wsD else 2)
  if wx and '雷' in wx:l=2
  elif wx and '霧' in wx:l=max(l,1)
  return l
def lamp(f,popD,ar):
  l=fl(f['row'],popD);al=f['al']['site'];ty='颱風警報' in al;rn=[a for a in al if a!='颱風警報']
  if ty:return 2
  if rn:
    pop=f['row'][0] or 0
    if ar=='甲':return 2
    if ar=='乙':return 2 if pop>=30 else max(l,1)
    if ar=='丙':return 2 if '豪雨特報' in rn else max(l,1)
    if ar=='丁':return max(l,1)
  return l
for L in('0h','24h'):
 print('==',L)
 for popD in(60,70,80):
  for ar in('甲','乙','丙','丁'):
   s=f'D{popD} 特報{ar}:'
   for nm,rows in(('期間',[r for r in R if r['s0']<LIFT]),('解除後',[r for r in R if r['s0']>=LIFT]),('全部',R)):
    xs=[(lamp(r['f'][L],popD,ar),r) for r in rows if L in r['f']];xs=[x for x in xs if x[0]>=0];n=len(xs)
    c=collections.Counter(l for l,_ in xs)
    s+=f' |{nm} D{100*c[2]/n:.0f}% C{100*c[1]/n:.0f}% B{100*c[0]/n:.0f}%'
    Dn=[r for l,r in xs if l==2];nb=[r for l,r in xs if l<2];Bn=[r for l,r in xs if l==0]
    s+=f' D準(乙){100*sum(STD["乙"](r) for r in Dn)/max(1,len(Dn)):.0f}% 漏(非D但乙){sum(STD["乙"](r) for r in nb)} 漏(B但乙){sum(STD["乙"](r) for r in Bn)} 漏(非D但丙){sum(STD["丙"](r) for r in nb)}'
   print(s)
# alerts-only D post lift
c=collections.Counter()
for r in R:
  f=r['f'].get('0h')
  if not f:continue
  al=[a for a in f['al']['site'] if a!='颱風警報']
  if al and fl(f['row'],60)<2 and '颱風警報' not in f['al']['site']:
    c[(al[0],'雨≥5' if (r['rain'] or 0)>=5 else '雨1-5' if (r['rain'] or 0)>=1 else '<1')]+=1
print(sorted(c.items()))
# wind 11+ split
b=collections.defaultdict(list)
for r in R:
  f=r['f'].get('0h')
  if f and r['ws'] is not None and f['row'][1] is not None and f['row'][1]>=11: b[min(int(f['row'][1]),20)].append(r['ws'])
for k in sorted(b):x=b[k];print('ws',k,len(x),sum(v>=8 for v in x),sum(v>=13.9 for v in x))
