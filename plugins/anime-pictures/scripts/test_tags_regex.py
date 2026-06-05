#!/usr/bin/env python3
import html
import json
import re


SAMPLES = [
    {
        "tagsHtml": """
<ul class="tags svelte-1ok3vri" itemprop="keywords"><!--[--><!--[1--><span class="svelte-1ok3vri">
作品名（製品名）
</span><!--]--> <li title="by Weyde" class="svelte-1ok3vri green"><a href="https://anime-pictures.net/posts?page=0&amp;search_tag=%E3%83%A4%E3%83%9E%E3%83%8E%E3%82%B9%E3%82%B9%E3%83%A1&amp;lang=ja" title="
    ヤマノススメ

  " class="svelte-dajkv7 big_tag copyright" target="_blank" rel="noopener noreferrer">ヤマノススメ</a><!----> <!--[--><span class="edit_tag svelte-1ok3vri">56 <!--[!--><!--]--></span><!--]--></li><!--[1--><span class="svelte-1ok3vri">
作品名（他の）
</span><!--]--> <li title="by Weyde" class="svelte-1ok3vri green"><a href="https://anime-pictures.net/posts?page=0&amp;search_tag=%E3%82%A8%E3%82%A4%E3%83%88%E3%83%93%E3%83%83%E3%83%88&amp;lang=ja" title="
    エイトビット

  " class="svelte-dajkv7 big_tag copyright" target="_blank" rel="noopener noreferrer">エイトビット</a><!----> <!--[--><span class="edit_tag svelte-1ok3vri">2K <!--[!--><!--]--></span><!--]--></li><!--[1--><span class="svelte-1ok3vri">
キャラクターの名前
</span><!--]--> <li title="by Weyde" class="svelte-1ok3vri green"><a href="https://anime-pictures.net/posts?page=0&amp;search_tag=%E5%80%89%E4%B8%8A%E3%81%B2%E3%81%AA%E3%81%9F&amp;lang=ja" title="
    倉上ひなた

  " class="svelte-dajkv7 big_tag character" target="_blank" rel="noopener noreferrer">倉上ひなた</a><!----> <!--[--><span class="edit_tag svelte-1ok3vri">24 <!--[!--><!--]--></span><!--]--></li><!--[1--><span class="svelte-1ok3vri">
アーティスト名
</span><!--]--> <li title="by Weyde" class="svelte-1ok3vri green"><a href="https://anime-pictures.net/posts?page=0&amp;search_tag=shiro&amp;lang=ja" title="
    shiro

  " class="svelte-dajkv7 not_my_tag_border big_tag artist" target="_blank" rel="noopener noreferrer">shiro</a><!----> <!--[--><span class="edit_tag svelte-1ok3vri">19 <!--[!--><!--]--></span><!--]--></li></ul>
"""
    },
    {
        "tagsHtml": """
<ul class="tags svelte-1ok3vri" itemprop="keywords"><span class="svelte-1ok3vri">作品名（他の）</span>
<li title="by Cold_Crime" class="svelte-1ok3vri green"><a href="https://anime-pictures.net/posts?page=0&amp;search_tag=nintendo&amp;lang=ja" class="svelte-dajkv7 big_tag copyright" target="_blank" rel="noopener noreferrer">nintendo</a><span class="edit_tag svelte-1ok3vri">9K</span></li>
<li title="by Cold_Crime" class="svelte-1ok3vri green"><a href="https://anime-pictures.net/posts?page=0&amp;search_tag=sony&amp;lang=ja" class="svelte-dajkv7 big_tag copyright" target="_blank" rel="noopener noreferrer">sony</a><span class="edit_tag svelte-1ok3vri">193</span></li>
<span class="svelte-1ok3vri">アーティスト名</span>
<li title="by Cold_Crime" class="svelte-1ok3vri green"><a href="https://anime-pictures.net/posts?page=0&amp;search_tag=qingli+ye&amp;lang=ja" class="svelte-dajkv7 big_tag artist" target="_blank" rel="noopener noreferrer">qingli ye</a><span class="edit_tag svelte-1ok3vri">98</span></li></ul>
"""
    },
]


def clean_text(value: str) -> str:
    value = re.sub(r"<!--.*?-->", "", value, flags=re.S)
    value = re.sub(r"<svg\b.*?</svg>", " ", value, flags=re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def extract_legacy_metadata():
    yield from SAMPLES


def tag_type(class_name: str) -> str:
    for value in ("copyright", "character", "artist", "object", "reference"):
        if re.search(rf"(^|\s){re.escape(value)}(\s|$)", class_name):
            return value
    return ""


def parse_tags(tags_html: str):
    groups = []
    current = None
    token_re = re.compile(
        r"<span\b[^>]*class=\"[^\"]*\bsvelte-1ok3vri\b[^\"]*\"[^>]*>.*?</span>|<li\b.*?</li>",
        flags=re.S,
    )
    anchor_re = re.compile(
        r"<a\b(?=[^>]*\bhref=\"([^\"]+)\")(?=[^>]*\bclass=\"([^\"]*)\")[^>]*>(.*?)</a>",
        flags=re.S,
    )

    for token_match in token_re.finditer(tags_html):
        token = token_match.group(0)
        if token.startswith("<span"):
            name = clean_text(token)
            if not name:
                continue
            current = {"name": name, "tags": []}
            groups.append(current)
            continue

        anchor = anchor_re.search(token)
        if not anchor:
            continue
        if current is None:
            current = {"name": "", "tags": []}
            groups.append(current)

        url, class_name, label_html = anchor.groups()
        tag = {
            "name": clean_text(label_html),
            "url": html.unescape(url),
            "type": tag_type(class_name),
        }
        count_match = re.search(
            r"<span\b[^>]*class=\"[^\"]*\bedit_tag\b[^\"]*\"[^>]*>(.*?)</span>",
            token,
            flags=re.S,
        )
        if count_match:
            count = clean_text(count_match.group(1))
            if count:
                tag["count"] = count
        by_match = re.search(r"\btitle=\"by\s+([^\"]+)\"", token, flags=re.I)
        if by_match:
            tag["by"] = html.unescape(by_match.group(1)).strip()
        if tag["name"] or tag["url"]:
            current["tags"].append(tag)

    return [group for group in groups if group["name"] or group["tags"]]


def main():
    samples = list(extract_legacy_metadata())
    assert samples, "no legacy anime-pictures metadata with tagsHtml found"
    total_tags = 0
    typed_tags = 0
    for sample in samples[:40]:
        groups = parse_tags(sample["tagsHtml"])
        assert groups, "tag groups should be parsed"
        for group in groups:
            assert "tags" in group
            for tag in group["tags"]:
                total_tags += 1
                if tag["type"]:
                    typed_tags += 1
                assert tag["name"], "tag name should be parsed"
                assert tag["url"].startswith("http"), "tag url should be absolute"
                assert "<" not in tag["name"] and ">" not in tag["name"]
    assert total_tags > 0, "tag items should be parsed"
    assert typed_tags > 0, "tag type should be parsed from anchor class"
    first_groups = parse_tags(samples[0]["tagsHtml"])
    print(json.dumps({
        "samples": len(samples),
        "firstGroups": first_groups[:3],
        "checkedTags": total_tags,
        "checkedTypedTags": typed_tags,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
