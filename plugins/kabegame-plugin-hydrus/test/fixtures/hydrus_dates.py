"""用 hydrus 本体的 StringConverter 跑 conversion 10（DATE_DECODE），作为 strptime 移植的对照答案。
样例取自 Hydrus-Presets-and-Scripts 仓库里 downloader 实际用到的格式串。
用法（在 hydrus 源码目录，用它的 venv）：
  TZ=UTC venv/bin/python -I hydrus_dates.py "$PWD" > dates.expected.json
每项输出 [格式串, 时区类型, 偏移秒, 输入, 结果]；转换失败时结果为 null。"""
import json, sys
sys.path.insert(0, sys.argv[1])
from hydrus.client import ClientStrings

SAMPLES = [
    ("%Y-%m-%dT%H:%M:%S", 0, 0, "2021-03-09T15:00:57"),
    ("%Y-%m-%dT%H:%M:%S.%f%z", 0, 0, "2021-03-09T15:00:57.123456+09:00"),
    ("%Y-%m-%dT%H:%M:%S.%f%z", 1, 0, "2021-03-09T15:00:57.5-0130"),
    ("%Y-%m-%dT%H:%M:%S%z", 0, 0, "2021-03-09T15:00:57+00:00"),
    ("%Y-%m-%dT%H:%M:%S%z", 1, 0, "2021-03-09T15:00:57+09:00"),
    ("%Y-%m-%dT%H:%M:%S%z", 1, 0, "2021-03-09T15:00:57Z"),
    ("%Y-%m-%d", 0, 0, "1999-12-31"),
    ("%Y-%m-%d", 1, 0, "1969-07-20"),
    ("%Y-%m-%d %H:%M", 0, 0, "2020-02-29 23:59"),
    ("%Y-%m-%d %H:%M", 0, 0, "2021-02-29 23:59"),
    ("Posted: %Y-%m-%d %H:%M:%S ", 0, 0, "Posted: 2019-06-18 08:05:09 "),
    ("Posted: %Y-%m-%d %H:%M:%S ", 0, 0, "posted:   2019-06-18 08:05:09\t"),
    ("%Y-%m-%dT%H:%M:%SZ", 0, 0, "2023-01-29T12:34:56Z"),
    ("%b %d, %Y %I:%M %p", 1, 0, "Aug 19, 2018 12:05 AM"),
    ("%b %d, %Y %I:%M %p", 0, 0, "aug 9, 2018 12:05 pm"),
    ("%b %d, %Y %I:%M %p", 0, 0, "Sep 30, 2018 1:05 PM"),
    ("%a %b %d %H:%M:%S %Y", 0, 0, "Tue Mar 09 15:00:57 2021"),
    ("%a %b %d %H:%M:%S %z %Y", 0, 0, "Tue Mar 09 15:00:57 +0000 2021"),
    ("%a %b %d %H:%M:%S %z %Y", 1, 0, "Tue Mar 09 15:00:57 -0500 2021"),
    ("%a, %d %b %Y %H:%M:%S GMT", 0, 0, "Tue, 09 Mar 2021 15:00:57 GMT"),
    ("%a, %d %b %Y %H:%M:%S %z", 0, 0, "Tue, 09 Mar 2021 15:00:57 +0100"),
    ("%B %d, %Y", 0, 0, "September 5, 2022"),
    ("on %B %d, %Y", 1, 0, "on May 05, 2022"),
    ("%d %b %Y, %I:%M:%S %p", 2, 32400, "05 May 2022, 09:15:00 PM"),
    ("%Y-%m-%d %H:%M:%S", 2, -18000, "2022-05-05 10:00:00"),
    ("%d/%m/%Y %H:%M:%S", 1, 0, "31/12/2022 23:59:59"),
    ("%d-%m-%Y, %H:%M", 0, 0, "01-02-2003, 04:05"),
    ("%d.%m.%Y", 1, 0, "1.2.2003"),
    ("%Y-%m-%dT%X", 1, 0, "2003-02-01T04:05:06"),
    ("%Y-%m-%d %H:%M:%S %Z", 0, 0, "2003-02-01 04:05:06 UTC"),
    ("%Y年%m月%d日 %H:%M", 0, 0, "2023年4月24日 09:30"),
    ("%B %dnd, %Y %I:%M %p", 1, 0, "June 22nd, 2019 10:00 AM"),
    (" %Y %B %d ", 1, 0, "  2019 june 22 "),
    ("%b %d, %Y at %I:%M%p", 1, 0, "Jun 22, 2019 at 10:00PM"),
    ("%Y-%m-%dT%H:%M:%S.000Z", 0, 0, "2019-06-22T10:00:00.000Z"),
    ("%Y-%m-%d", 0, 0, "2019-06-22 extra"),
    ("%Y-%m-%d", 0, 0, "not a date"),
    ("%y-%m-%d", 0, 0, "68-01-01"),
    ("%y-%m-%d", 0, 0, "69-01-01"),
    ("%Y %j", 0, 0, "2020 366"),
    ("%H:%M", 0, 0, "12:30"),
]

out = []
for phrase, tz, offset, text in SAMPLES:
    conv = ClientStrings.StringConverter(conversions=[(ClientStrings.STRING_CONVERSION_DATE_DECODE, (phrase, tz, offset))])
    try:
        result = conv.Convert(text)
    except Exception:
        result = None
    out.append([phrase, tz, offset, text, result])
print(json.dumps(out, ensure_ascii=False, indent=1))
