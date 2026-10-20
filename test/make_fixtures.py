# 依氣象署官方文件的欄位，產生測試用資料（新舊兩種 JSON 格式都測）
import json, random, datetime as dt, os
random.seed(1)
TW = dt.timezone(dt.timedelta(hours=8))
now = dt.datetime.now(TW)
mid = now.replace(hour=0, minute=0, second=0, microsecond=0)
iso = lambda d: d.isoformat(timespec='seconds')
M = json.load(open('data/mountains.json', encoding='utf-8'))
names = [m['cn'] for m in M if m.get('pid')]
names.remove('鹿山')                                     # 故意缺一個，測試警告
towns = sorted({t for m in M for t in m['tw']})
issue = mid + dt.timedelta(hours=5, minutes=30)
def wx(p): return '短暫雷陣雨' if p >= 80 else '陰短暫雨' if p >= 60 else '多雲短暫陣雨' if p >= 30 else '晴' if p < 15 else '多雲時晴'
out = 'test/fixtures/'; os.makedirs(out, exist_ok=True)

# 登山 3 天逐 3 小時：舊格式（代碼 + value/measures）
locs = []
for n in names:
    els = {'T': [], 'AT': [], 'PoP3h': [], 'WS': [], 'Wx': []}
    for i in range(24):
        s = mid + dt.timedelta(hours=6 + 3*i); e = s + dt.timedelta(hours=3)
        p = random.choice([0, 10, 20, 30, 40, 60, 80]); ws = round(random.uniform(1, 16), 1); t = random.randint(-2, 24)
        els['T'].append({'dataTime': iso(s), 'elementValue': [{'value': str(t), 'measures': '攝氏度'}]})
        els['AT'].append({'dataTime': iso(s), 'elementValue': [{'value': str(t-2), 'measures': '攝氏度'}]})
        els['PoP3h'].append({'startTime': iso(s), 'endTime': iso(e), 'elementValue': [{'value': str(p), 'measures': '百分比'}]})
        els['WS'].append({'startTime': iso(s), 'endTime': iso(e), 'elementValue': [{'value': str(ws), 'measures': '公尺/秒'}, {'value': '5', 'measures': '蒲福風級'}]})
        els['Wx'].append({'startTime': iso(s), 'endTime': iso(e), 'elementValue': [{'value': wx(p), 'measures': '自定義 Wx 文字'}, {'value': '07', 'measures': '自定義 Wx 單位'}]})
    locs.append({'locationName': n, 'geocode': '0', 'lat': '24.1', 'lon': '121.2', 'weatherElement': [{'elementName': k, 'time': v} for k, v in els.items()]})
json.dump({'success': 'true', 'records': {'locations': [{'datasetDescription': '臺灣各育樂區未來3天天氣預報', 'locationsName': '臺灣', 'location': locs}]}}, open(out+'F-B0053-035.json', 'w'), ensure_ascii=False)

# 新格式工具
def new_fmt(desc, groups):
    return {'success': 'true', 'records': {'Locations': [{'DatasetDescription': desc, 'LocationsName': g, 'Location': L} for g, L in groups.items()]}}
def week_elements(start):
    els = {'天氣現象': [], '12小時降雨機率': [], '最高溫度': [], '最高體感溫度': [], '風速': []}
    for i in range(15):
        s = start + dt.timedelta(hours=12*i); e = s + dt.timedelta(hours=12)
        p = random.choice([0, 20, 40, 70]) if i < 6 else ' '
        tt = lambda k, v: {'StartTime': iso(s), 'EndTime': iso(e), 'ElementValue': [v]}
        w = wx(p) if p != ' ' else random.choice(['陰陣雨', '陰短暫陣雨', '晴時多雲'])   # 第 4 天起沒有降雨機率，用真實資料常見的描述
        els['天氣現象'].append(tt('', {'Weather': w, 'WeatherCode': '04'}))
        els['12小時降雨機率'].append(tt('', {'ProbabilityOfPrecipitation': str(p)}))
        els['最高溫度'].append(tt('', {'MaxTemperature': str(random.randint(5, 30))}))
        els['最高體感溫度'].append(tt('', {'MaxApparentTemperature': str(random.choice([20, 30, 37]))}))
        els['風速'].append(tt('', {'WindSpeed': str(round(random.uniform(1, 15), 1)), 'BeaufortScale': '4'}))
    return [{'ElementName': k, 'Time': v} for k, v in els.items()]

# 登山一週日夜：新格式
start = mid + dt.timedelta(hours=6) if now.hour < 18 else mid + dt.timedelta(hours=18)
json.dump(new_fmt('臺灣各育樂區未來1週逐12小時天氣預報', {'臺灣': [{'LocationName': n, 'Latitude': '24.1', 'Longitude': '121.2', 'WeatherElement': week_elements(start)} for n in names]}), open(out+'F-B0053-041.json', 'w'), ensure_ascii=False)

# 鄉鎮 3 天逐 3 小時：新格式（中文 ElementName）
groups = {}
for t in towns:
    c, n = t[:3], t[3:]
    els = {'溫度': [], '體感溫度': [], '3小時降雨機率': [], '風速': [], '天氣現象': []}
    for i in range(24):
        s = mid + dt.timedelta(hours=6 + 3*i); e = s + dt.timedelta(hours=3)
        p = random.choice([0, 10, 30, 60]); tv = random.randint(18, 37)
        els['溫度'].append({'DataTime': iso(s), 'ElementValue': [{'Temperature': str(tv)}]})
        els['體感溫度'].append({'DataTime': iso(s), 'ElementValue': [{'ApparentTemperature': str(tv+1)}]})
        els['3小時降雨機率'].append({'StartTime': iso(s), 'EndTime': iso(e), 'ElementValue': [{'ProbabilityOfPrecipitation': str(p)}]})
        els['風速'].append({'DataTime': iso(s), 'ElementValue': [{'WindSpeed': str(round(random.uniform(0.5, 9), 1)), 'BeaufortScale': '3'}]})
        els['天氣現象'].append({'StartTime': iso(s), 'EndTime': iso(e), 'ElementValue': [{'Weather': wx(p), 'WeatherCode': '02'}]})
    groups.setdefault(c, []).append({'LocationName': n, 'Latitude': '23.0', 'Longitude': '120.5', 'WeatherElement': [{'ElementName': k, 'Time': v} for k, v in els.items()]})
# 各縣市一個檔案（與 fetch.mjs 的 TOWN_COUNTY 相同編號）；縣市名稱故意用「台」測試正規化
CN = {'宜蘭縣':1,'桃園市':5,'新竹縣':9,'苗栗縣':13,'彰化縣':17,'南投縣':21,'雲林縣':25,'嘉義縣':29,'屏東縣':33,'臺東縣':37,'花蓮縣':41,'澎湖縣':45,'基隆市':49,'新竹市':53,'嘉義市':57,'臺北市':61,'高雄市':65,'新北市':69,'臺中市':73,'臺南市':77,'連江縣':81,'金門縣':85}
for c, L in groups.items():
    n = CN[c]; label = c.replace('臺', '台')
    json.dump(new_fmt(c + '未來3天天氣預報', {label: L}), open(out+f'F-D0047-{n:03d}.json', 'w'), ensure_ascii=False)
    json.dump(new_fmt(c + '未來1週天氣預報', {label: [{'LocationName': l['LocationName'], 'Latitude': '23', 'Longitude': '120.5', 'WeatherElement': week_elements(start)} for l in L]}), open(out+f'F-D0047-{n+2:03d}.json', 'w'), ensure_ascii=False)

# 警特報：舊格式
hz = lambda ph, sig, h0, h1: {'info': {'language': 'zh-TW', 'phenomena': ph, 'significance': sig}, 'validTime': {'startTime': iso(mid+dt.timedelta(hours=h0)), 'endTime': iso(mid+dt.timedelta(hours=h1))}}
json.dump({'success': 'true', 'records': {'location': [
    {'locationName': '宜蘭縣', 'geocode': 10002, 'hazardConditions': {'hazards': [hz('陸上強風', '特報', 0, 30)]}},
    {'locationName': '南投縣', 'geocode': 10008, 'hazardConditions': {'hazards': [hz('低溫', '特報', 24, 40)]}},
    {'locationName': '臺北市', 'geocode': 63, 'hazardConditions': {'hazards': [hz('高溫', '資訊', 0, 12)]}},
    {'locationName': '高雄市', 'geocode': 64, 'hazardConditions': {'hazards': []}},
    {'locationName': '屏東縣', 'geocode': 10013, 'hazardConditions': {'hazards': [hz('豪雨', '特報', 0, 30)]}}]}}, open(out+'W-C0033-001.json', 'w'), ensure_ascii=False)
# 颱風路徑（新格式）：一個會在 2 天後接近臺灣東方（約 300 公里），一個遠在南海外（不顯示）
fx = lambda h, la, lo, ws: {'InitialTime': iso(mid), 'ForecastHour': str(h), 'CoordinateLatitude': str(la), 'CoordinateLongitude': str(lo), 'MaxWindSpeed': str(ws)}
json.dump({'success': 'true', 'records': {'TropicalCyclones': {'TropicalCyclone': [
    {'CwaTyphoonName': '測試', 'TyphoonName': 'TEST', 'AnalysisData': {'Fix': [{'DateTime': iso(mid), 'CoordinateLatitude': '18.0', 'CoordinateLongitude': '130.0', 'MaxWindSpeed': '55'}]}, 'ForecastData': {'Fix': [fx(24, 21, 127, 52), fx(48, 24, 124.6, 45), fx(72, 28, 125, 30)]}},
    {'CwaTyphoonName': '遠方', 'TyphoonName': 'FAR', 'AnalysisData': {'Fix': [{'DateTime': iso(mid), 'CoordinateLatitude': '12.0', 'CoordinateLongitude': '150.0', 'MaxWindSpeed': '20'}]}, 'ForecastData': {'Fix': [fx(48, 15, 145, 25)]}}]}}}, open(out+'W-C0034-005.json', 'w'), ensure_ascii=False)
json.dump({'success': 'true', 'records': {'info': []}}, open(out+'W-C0034-001.json', 'w'), ensure_ascii=False)
print('fixtures ok', len(names), len(towns), sorted(os.listdir(out)))
