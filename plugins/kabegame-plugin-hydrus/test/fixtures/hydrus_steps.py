"""用 hydrus 本体的 StringProcessor 跑 StringSplitter / StringSlicer / StringSorter，作为移植的对照答案。
用法（在 hydrus 源码目录，用它的 venv）：
  venv/bin/python -I hydrus_steps.py "$PWD" > steps.expected.json
每项输出 [步骤序列化元组列表, 输入列表, 结果列表]。步骤用升级后的当前版本元组。"""
import json, sys
sys.path.insert(0, sys.argv[1])
from hydrus.core import HydrusSerialisable
from hydrus.client import ClientStrings as S

def splitter(sep, n=None): return S.StringSplitter(separator=sep, max_splits=n)
def slicer(a, b): return S.StringSlicer(index_start=a, index_end=b)
def sorter(t, asc, regex=None): return S.StringSorter(sort_type=t, asc=asc, regex=regex)
LEX, HUMAN, REV = S.CONTENT_PARSER_SORT_TYPE_LEXICOGRAPHIC, S.CONTENT_PARSER_SORT_TYPE_HUMAN_SORT, S.CONTENT_PARSER_SORT_TYPE_REVERSE
FILES = ["Page 21.jpg", "page 3.jpg", "Page 200.jpg", "page 19.jpg", "b", "B", "a10", "a9", "", "Ä1", "z"]

CASES = [
    ([splitter(",")], ["a,b,,c", ",lead", "trail,", ""]),
    ([splitter(", ")], ["tag one, tag two, tag three"]),
    ([splitter(",", 1)], ["a,b,c,d"]),
    ([splitter(",", 0)], ["a,b"]),
    ([splitter(",", -1)], ["a,b,c"]),
    ([splitter("\\n")], ["line1\nline2\n\nline3"]),
    ([splitter("\\t")], ["a\tb"]),
    ([splitter("\\\\")], ["a\\b\\c"]),
    ([splitter("\\x2c")], ["a,b"]),
    ([splitter("\\u3001")], ["一、二、三"]),
    ([splitter("、")], ["一、二、三"]),
    ([splitter("\\d")], ["a\\db\\dc", "a1b"]),
    ([splitter("\\")], ["a\\b"]),
    ([splitter("")], ["abc"]),
    ([splitter("é")], ["aébéc"]),
    ([splitter("/")], ["https://example.com/a/b/c"]),
    ([slicer(0, 1)], ["a", "b", "c"]),
    ([slicer(-1, None)], ["a", "b", "c"]),
    ([slicer(None, -1)], ["a", "b", "c"]),
    ([slicer(1, None)], ["a", "b", "c"]),
    ([slicer(5, 10)], ["a", "b", "c"]),
    ([slicer(-10, 2)], ["a", "b", "c"]),
    ([slicer(2, 1)], ["a", "b", "c"]),
    ([slicer(-2, -1)], ["a", "b", "c"]),
    ([slicer(None, None)], ["a", "b"]),
    ([slicer(0, 1)], []),
    ([splitter("/"), slicer(-1, None)], ["https://example.com/a/b/file.jpg", "x/y"]),
    ([splitter(" "), slicer(1, 3), S.StringConverter(conversions=[(S.STRING_CONVERSION_APPEND_TEXT, "!")])], ["a b c d e"]),
    ([S.StringMatch(match_type=S.STRING_MATCH_REGEX, match_value="^h"), splitter(":"), slicer(0, 1)], ["http:x", "ftp:y", "https:z"]),
    ([sorter(LEX, True)], FILES),
    ([sorter(LEX, False)], FILES),
    ([sorter(HUMAN, True)], FILES),
    ([sorter(HUMAN, False)], FILES),
    ([sorter(REV, True)], FILES),
    ([sorter(HUMAN, True, r"\d+")], FILES),
    ([sorter(LEX, False, r"[a-z]+")], FILES),
    ([sorter(HUMAN, False, r"(?P<n>\d+)\.jpg")], ["x 10.jpg", "x 2.jpg", "nojpg 5", "y 2.jpg", "zz"]),
    ([sorter(HUMAN, True, "(")], ["b", "a"]),
    ([splitter(","), sorter(HUMAN, False), slicer(0, 1)], ["v1.2,v1.10,v1.9"]),
]

out = []
for steps, inputs in CASES:
    p = S.StringProcessor()
    p.SetProcessingSteps(steps)
    out.append([p.GetSerialisableTuple(), inputs, p.ProcessStrings(inputs)])
print(json.dumps(out, ensure_ascii=False, indent=1))
