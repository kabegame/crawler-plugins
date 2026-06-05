// anihonet-wallpaper metadata migration v2.
//
// Goal:
// - v1 lumped every tag containing `壁紙` or `画像` into a single `qualityTags`
//   bucket. v2 separates those two senses:
//     * tags containing `画像` are quality labels      -> `qualityTags`
//     * tags containing `壁紙` are the work/series      -> `workTags`
//     * everything else stays as character labels       -> `characterTags`
// - Reclassify from the authoritative flat `tags` array so the result is
//   deterministic regardless of how v1 had split things.
//
// Historical-migration rule: this script is self-contained and must not change
// semantics once shipped. Any later fix is a new v3.rhai.

fn declared_schema(m) {
    if m["schema"] == () {
        return "";
    }
    let schema = m["schema"].to_string();
    schema.trim();
    schema
}

fn is_current_schema(m) {
    declared_schema(m) == "2"
        && m["qualityTags"] != ()
        && m["workTags"] != ()
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
    s.contains("画像")
}

fn is_work_tag(label) {
    if label == () {
        return false;
    }
    let s = label.to_string();
    s.trim();
    s.contains("壁紙")
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
    let work = [];
    let character = [];
    if tags == () || tags.type_of() != "array" {
        return #{ qualityTags: quality, workTags: work, characterTags: character };
    }

    for tag in tags {
        let label = tag_label(tag);
        if label.len() == 0 {
            continue;
        }
        // `画像` wins over `壁紙` when a label somehow contains both, so quality
        // labels are never misfiled as a work.
        if is_quality_tag(label) {
            quality.push(copy_tag(tag));
        } else if is_work_tag(label) {
            work.push(copy_tag(tag));
        } else {
            character.push(copy_tag(tag));
        }
    }

    #{ qualityTags: quality, workTags: work, characterTags: character }
}

fn migrate(metadata) {
    let m = parse_json(metadata);
    if is_current_schema(m) {
        return to_json(m);
    }

    let out = #{ schema: 2 };
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

    let split = split_tags(out["tags"]);
    out["qualityTags"] = split["qualityTags"];
    out["workTags"] = split["workTags"];
    out["characterTags"] = split["characterTags"];

    to_json(out)
}
