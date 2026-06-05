// anihonet-wallpaper metadata migration v1.
//
// Goal:
// - Preserve legacy post metadata (`post_id`, `date`, `tags`).
// - Split flat `tags` into `qualityTags` and `characterTags`.
// - Quality tags are the labels previously filtered from providers: tags that
//   contain `壁紙` or `画像`; other tags are treated as character tags.

fn declared_schema(m) {
    if m["schema"] == () {
        return "";
    }
    let schema = m["schema"].to_string();
    schema.trim();
    schema
}

fn is_current_schema(m) {
    declared_schema(m) == "1"
        && m["qualityTags"] != ()
        && m["characterTags"] != ()
}

fn tag_label(tag) {
    if tag == () {
        return "";
    }
    if tag.type_of() == "map" {
        if tag["name"] != () {
            let name = tag["name"].to_string();
            name.trim();
            if name.len() > 0 {
                return name;
            }
        }
        if tag["href"] != () {
            let href = tag["href"].to_string();
            href.trim();
            return href;
        }
    }
    let text = tag.to_string();
    text.trim();
    text
}

fn is_quality_tag(label) {
    if label == () {
        return false;
    }
    let s = label.to_string();
    s.trim();
    s.contains("壁紙") || s.contains("画像")
}

fn copy_tag(tag) {
    if tag.type_of() == "map" {
        let name = if tag["name"] == () { "" } else { tag["name"].to_string() };
        let href = if tag["href"] == () { "" } else { tag["href"].to_string() };
        name.trim();
        href.trim();
        return #{ name: name, href: href };
    }
    let name = tag.to_string();
    name.trim();
    #{ name: name, href: "" }
}

fn split_tags(tags) {
    let quality = [];
    let character = [];
    if tags == () || tags.type_of() != "array" {
        return #{ qualityTags: quality, characterTags: character };
    }

    for tag in tags {
        let label = tag_label(tag);
        if label.len() == 0 {
            continue;
        }
        if is_quality_tag(label) {
            quality.push(copy_tag(tag));
        } else {
            character.push(copy_tag(tag));
        }
    }

    #{ qualityTags: quality, characterTags: character }
}

fn migrate(metadata) {
    let m = parse_json(metadata);
    if is_current_schema(m) {
        return to_json(m);
    }

    let out = #{ schema: 1 };
    if m["post_id"] != () {
        out["post_id"] = m["post_id"];
    }
    if m["date"] != () {
        out["date"] = m["date"];
    }
    if m["tags"] != () && m["tags"].type_of() == "array" {
        out["tags"] = m["tags"];
    } else {
        out["tags"] = [];
    }

    if m["qualityTags"] != () && m["qualityTags"].type_of() == "array" {
        out["qualityTags"] = m["qualityTags"];
    }
    if m["characterTags"] != () && m["characterTags"].type_of() == "array" {
        out["characterTags"] = m["characterTags"];
    }

    if out["qualityTags"] == () || out["characterTags"] == () {
        let split = split_tags(out["tags"]);
        if out["qualityTags"] == () {
            out["qualityTags"] = split["qualityTags"];
        }
        if out["characterTags"] == () {
            out["characterTags"] = split["characterTags"];
        }
    }

    to_json(out)
}
