// anime-pictures metadata migration v1.
//
// Goal:
// - Convert legacy metadata with raw `headInfoHtml` / `tagsHtml` page fragments
//   into schema 1 JSON consumed by `templates/description.ejs`.
// - Preserve `title`, `author`, `details`, `rating`, and structured `tagGroups`.
// - Leave already-current records unchanged when `schema == 1` and no legacy HTML
//   fields are present.
//
// Tested command:
//   kabegame-cli plugin run migrate --plugin packed/anime-pictures.kgpg --input '<metadata-json>'
//
// Tested results:
// - schema 1 input returned unchanged JSON.
// - legacy HTML input returned schema 1 JSON preserving title/details/rating/tagGroups.
// - migrated output omitted `headInfoHtml` and `tagsHtml`.

fn html_unescape(s) {
    s = re_replace_all("&amp;", "&", s);
    s = re_replace_all("&quot;", "\"", s);
    s = re_replace_all("&#39;", "'", s);
    s = re_replace_all("&lt;", "<", s);
    s = re_replace_all("&gt;", ">", s);
    s
}

fn clean_text(s) {
    s = re_replace_all("(?s)<!--.*?-->", "", s);
    s = re_replace_all("(?s)<svg\\b.*?</svg>", " ", s);
    s = re_replace_all("(?s)<[^>]+>", " ", s);
    s = html_unescape(s);
    s = re_replace_all("\\s+", " ", s);
    s.trim();
    s
}

fn attr(html, name) {
    let matches = re_find_all("\\b" + name + "\\s*=\\s*\"([^\"]*)\"", html);
    if matches.len() > 0 && matches[0]["1"] != () {
        return html_unescape(matches[0]["1"]);
    }
    ""
}

fn declared_schema(m) {
    if m["schema"] == () {
        return "";
    }
    let schema = m["schema"].to_string();
    schema.trim();
    schema
}

fn is_current_schema(m) {
    let schema = declared_schema(m);
    schema == "1" && m["headInfoHtml"] == () && m["tagsHtml"] == ()
}

fn tag_type(class_name) {
    if re_is_match("(^|\\s)copyright(\\s|$)", class_name) {
        return "copyright";
    }
    if re_is_match("(^|\\s)character(\\s|$)", class_name) {
        return "character";
    }
    if re_is_match("(^|\\s)artist(\\s|$)", class_name) {
        return "artist";
    }
    if re_is_match("(^|\\s)object(\\s|$)", class_name) {
        return "object";
    }
    if re_is_match("(^|\\s)reference(\\s|$)", class_name) {
        return "reference";
    }
    ""
}

fn parse_title(head_html) {
    let matches = re_find_all("(?s)<h1\\b[^>]*>(.*?)</h1>", head_html);
    if matches.len() == 0 || matches[0]["1"] == () {
        return "";
    }
    clean_text(matches[0]["1"])
}

fn line_details(lines) {
    let details = [];
    if lines == () || lines.type_of() != "array" {
        return details;
    }
    for line in lines {
        let text = line.to_string();
        text.trim();
        if text.len() > 0 {
            details.push(#{ text: text });
        }
    }
    details
}

fn parse_detail_links(item_html) {
    let links = [];
    for anchor_match in re_find_all("(?s)<a\\b[^>]*>.*?</a>", item_html) {
        let anchor_html = anchor_match["0"];
        let url = attr(anchor_html, "href");
        let text = clean_text(anchor_html);
        if text.len() > 0 || url.len() > 0 {
            links.push(#{ text: if text.len() > 0 { text } else { url }, url: url });
        }
    }
    links
}

fn parse_detail_items(head_html) {
    let source = re_replace_all(
        "(?s)<span\\b[^>]*class=\"[^\"]*\\blight\\b[^\"]*\"[^>]*>(.*?)</span>",
        "$1",
        head_html,
    );
    source = re_replace_all(
        "(?s)<span\\b[^>]*class=\"[^\"]*\\bcolor-sample\\b[^\"]*\"[^>]*></span>",
        "",
        source,
    );

    let details = [];
    for item_match in re_find_all("(?s)<span\\b[^>]*class=\"[^\"]*\\binfo-item\\b[^\"]*\"[^>]*>(.*?)</span>", source) {
        let item_html = item_match["0"];
        let text = clean_text(item_html);
        if text.len() == 0 {
            continue;
        }

        let detail = #{ text: text };
        let links = parse_detail_links(item_html);
        if links.len() > 0 {
            detail["links"] = links;
        }

        let color_matches = re_find_all("background-color:\\s*([^;\"']+)", item_html);
        if color_matches.len() > 0 && color_matches[0]["1"] != () {
            let color = color_matches[0]["1"];
            color.trim();
            detail["color"] = color;
        }
        details.push(detail);
    }
    details
}

fn parse_tag_groups(tags_html) {
    let groups = [];
    let current = -1;
    let tokens = re_find_all("(?s)<span\\b[^>]*class=\"[^\"]*\\bsvelte-1ok3vri\\b[^\"]*\"[^>]*>.*?</span>|<li\\b[^>]*>.*?</li>", tags_html);

    for token_match in tokens {
        let token = token_match["0"];
        if re_is_match("^<span\\b", token) {
            let name = clean_text(token);
            if name.len() == 0 {
                continue;
            }
            groups.push(#{ name: name, tags: [] });
            current = groups.len() - 1;
            continue;
        }

        let anchor_matches = re_find_all("(?s)<a\\b[^>]*>.*?</a>", token);
        if anchor_matches.len() == 0 {
            continue;
        }
        if current < 0 {
            groups.push(#{ name: "", tags: [] });
            current = groups.len() - 1;
        }

        let anchor_html = anchor_matches[0]["0"];
        let name = clean_text(anchor_html);
        let url = attr(anchor_html, "href");
        if name.len() == 0 && url.len() == 0 {
            continue;
        }

        let tag = #{
            name: name,
            url: url,
            type: tag_type(attr(anchor_html, "class"))
        };

        let count_matches = re_find_all("(?s)<span\\b[^>]*class=\"[^\"]*\\bedit_tag\\b[^\"]*\"[^>]*>(.*?)</span>", token);
        if count_matches.len() > 0 && count_matches[0]["1"] != () {
            let count = clean_text(count_matches[0]["1"]);
            if count.len() > 0 {
                tag["count"] = count;
            }
        }

        let by_matches = re_find_all("\\btitle=\"by\\s+([^\"]+)\"", token);
        if by_matches.len() > 0 && by_matches[0]["1"] != () {
            let by = html_unescape(by_matches[0]["1"]);
            by.trim();
            tag["by"] = by;
        }

        groups[current]["tags"].push(tag);
    }

    groups
}

fn migrate(metadata) {
    let m = parse_json(metadata);
    if is_current_schema(m) {
        return to_json(m);
    }

    let out = #{ schema: 1 };

    if m["title"] != () {
        out["title"] = m["title"];
    } else if m["headInfoHtml"] != () {
        let title = parse_title(m["headInfoHtml"]);
        if title.len() > 0 {
            out["title"] = title;
        }
    }

    if m["author"] != () {
        out["author"] = m["author"];
    }

    if m["details"] != () {
        out["details"] = m["details"];
    } else if m["lines"] != () {
        out["details"] = line_details(m["lines"]);
    } else if m["headInfoHtml"] != () {
        out["details"] = parse_detail_items(m["headInfoHtml"]);
    } else {
        out["details"] = [];
    }

    if m["rating"] != () {
        out["rating"] = m["rating"];
    }

    if m["tagGroups"] != () && m["tagGroups"].type_of() == "array" && m["tagGroups"].len() > 0 {
        out["tagGroups"] = m["tagGroups"];
    } else if m["tagsHtml"] != () {
        out["tagGroups"] = parse_tag_groups(m["tagsHtml"]);
    } else {
        out["tagGroups"] = [];
    }

    to_json(out)
}
