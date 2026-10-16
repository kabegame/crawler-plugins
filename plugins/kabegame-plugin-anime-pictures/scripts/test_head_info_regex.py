#!/usr/bin/env python3
import html
import json
import re


SAMPLES = [
    {
        "headInfoHtml": """
<div class="post_content head-info svelte-ki47ee"><h1 class="svelte-ki47ee"><!--[!-->イラスト<!--]--> <!--[--><span class="desktop_only svelte-ki47ee"><a href="https://anime-pictures.net/posts?page=0&amp;search_tag=%E3%83%A4%E3%83%9E%E3%83%8E%E3%82%B9%E3%82%B9%E3%83%A1&amp;lang=ja" title="タグ別アニメ絵
    ヤマノススメ

  " class="svelte-dajkv7 copyright" target="_blank" rel="noopener noreferrer">ヤマノススメ</a><!----></span><!--]--> №914073 <!--[!--><!--]--></h1>
<div class="info-grid svelte-ki47ee"><div class="author-section svelte-ki47ee"><a href="https://anime-pictures.net/profile/4273?lang=ja"><img src="https://oavatars.anime-pictures.net/4/4273.png?v=2" alt="Weyde avatar"></a> <a href="https://anime-pictures.net/profile/4273?lang=ja" class="user_link">Weyde</a></div>
<div class="details-section svelte-ki47ee">
  <div class="info-line svelte-ki47ee"><span class="info-item svelte-ki47ee"><span class="light">最終編集者:</span> <a href="https://anime-pictures.net/profile/4273">Weyde</a></span></div>
  <div class="info-line svelte-ki47ee"><span class="info-item svelte-ki47ee"><span class="light">アップロード日:</span> 2026/03/31 18:36</span> <span class="info-item svelte-ki47ee"><span class="light">投稿年月日:</span> 2026/03/31 18:55</span></div>
  <div class="info-line svelte-ki47ee"><span class="info-item svelte-ki47ee"><a href="https://anime-pictures.net/posts/?page=0&amp;res_x=1450&amp;res_y=2048&amp;lang=ja">1450x2048</a> 0.71</span> <span class="info-item svelte-ki47ee"><span class="color-sample" style="background-color: #f4d9c7"></span> #f4d9c7</span></div>
  <button class="metrics-toggle svelte-ki47ee">Show metrics</button>
</div></div></div>
"""
    },
    {
        "headInfoHtml": """
<div class="post_content head-info svelte-ki47ee"><h1 class="svelte-ki47ee"><!--[!-->イラスト<!--]--> №919859 <!--[!--><!--]--></h1>
<div class="details-section svelte-ki47ee">
  <div class="info-line svelte-ki47ee"><span class="info-item svelte-ki47ee"><span class="light">最終編集者:</span> <a href="https://anime-pictures.net/profile/204183">Cold_Crime</a></span></div>
  <div class="info-line svelte-ki47ee"><span class="info-item svelte-ki47ee"><span class="light">アップロード日:</span> 2026/06/04 07:31</span></div>
</div></div>
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


def parse_head_info(head_html: str):
    title_match = re.search(r"<h1\b[^>]*>(.*?)</h1>", head_html, flags=re.S)
    title = clean_text(title_match.group(1)) if title_match else ""

    details = []
    details_section = re.search(
        r"<div\b[^>]*class=\"[^\"]*\bdetails-section\b[^\"]*\"[^>]*>(.*?)(?:<button\b[^>]*class=\"[^\"]*\bmetrics-toggle\b|</div>\s*</div>)",
        head_html,
        flags=re.S,
    )
    search_area = details_section.group(1) if details_section else head_html

    for line_match in re.finditer(
        r"<div\b[^>]*class=\"[^\"]*\binfo-line\b[^\"]*\"[^>]*>(.*?)(?=<div\b[^>]*class=\"[^\"]*\binfo-line\b|<button\b[^>]*class=\"[^\"]*\bmetrics-toggle\b|$)",
        search_area,
        flags=re.S,
    ):
        line_html = line_match.group(1)
        if "metrics-toggle" in line_html:
            continue
        parts = re.split(
            r"(?=<span\b[^>]*class=\"[^\"]*\binfo-item\b)", line_html, flags=re.S
        )
        for part in parts:
            if "info-item" not in part:
                continue
            label_match = re.search(
                r"<span\b[^>]*class=\"[^\"]*\blight\b[^\"]*\"[^>]*>(.*?)</span>",
                part,
                flags=re.S,
            )
            label = clean_text(label_match.group(1)) if label_match else ""
            links = [
                {
                    "text": clean_text(text),
                    "url": html.unescape(url),
                }
                for url, text in re.findall(
                    r"<a\b[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>", part, flags=re.S
                )
            ]
            color_match = re.search(r"background-color:\s*([^;\"\']+)", part, flags=re.I)
            text = clean_text(part)
            if not text:
                continue
            item = {"text": text}
            if label:
                item["label"] = label
            if links:
                item["links"] = links
            if color_match:
                item["color"] = color_match.group(1).strip()
            details.append(item)
    return title, details


def main():
    samples = list(extract_legacy_metadata())
    assert samples, "no legacy anime-pictures metadata with headInfoHtml found"
    for sample in samples[:8]:
        title, details = parse_head_info(sample["headInfoHtml"])
        assert title, "title should be parsed from h1"
        assert details, "details should be parsed from info-line/info-item"
        assert not any("<" in item["text"] or ">" in item["text"] for item in details)
    first_title, first_details = parse_head_info(samples[0]["headInfoHtml"])
    print(json.dumps({
        "samples": len(samples),
        "firstTitle": first_title,
        "firstDetails": first_details[:3],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
